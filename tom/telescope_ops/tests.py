import copy
import json
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch
from xml.etree import ElementTree as ET

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from tom_targets.models import Target

from telescope_data.vendor.snapshot_reader import SnapshotReader
from . import service
from .models import Job
from .native import Client, NativeError
from .plans import InvalidPlan, compile_plan
from .snapshots import publish


PROFILE = {'facility': 'LCO', 'proposal': 'TEST-ONLY', 'filter_map': {'r': 'rp'},
           'instrument': '1M0-SCICAM-SINISTRO', 'telescope_class': '1m0',
           'enabled': True, 'live_writes': True, 'protocol_verified': True,
           'token_env': 'TEST_LCO_TOKEN', 'archive_token_env': 'TEST_ARCHIVE_TOKEN'}


def specification():
    now = timezone.now()
    return {'epochs': [{'start_utc': (now+timedelta(hours=2)).isoformat(),
        'end_utc': (now+timedelta(hours=3)).isoformat(), 'max_airmass': 2,
        'exposures': [{'band': 'r', 'count': 3, 'seconds': 60}]}]}


@override_settings(TELESCOPE_OPERATIONS_ENABLED=True, TELESCOPE_PROFILES={'test': PROFILE})
class OperationsTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser('operator', 'test@example.invalid', 'test')
        self.target = Target.objects.create(name='SN-test-only', type='SIDEREAL', ra=15., dec=-0.5)
        self.plan = service.create_plan(self.user, self.target, 'test', specification())
        service.validate_local(self.user, self.plan)
        service.approve(self.user, self.plan, self.plan.sha256)
        self.factory = Mock()
        self.factory.return_value.execute.return_value = {'errors': {}}

    def preflight(self):
        job = service.enqueue(self.user, self.plan, 'validate_remote', 'preflight-key', self.plan.sha256)
        service.run_job(job.id, self.factory)
        self.factory.reset_mock()

    def submit(self):
        return service.enqueue(self.user, self.plan, 'submit', 'submit-key', self.plan.sha256)

    def test_disabled_worker_never_calls_transport(self):
        self.preflight()
        job = self.submit()
        with override_settings(TELESCOPE_OPERATIONS_ENABLED=False):
            service.run_job(job.id, self.factory)
        self.factory.assert_not_called()
        job.refresh_from_db()
        self.assertEqual(job.state, 'failed')

    def test_disabled_enqueue(self):
        with override_settings(TELESCOPE_OPERATIONS_ENABLED=False), self.assertRaises(InvalidPlan):
            service.enqueue(self.user, self.plan, 'validate_remote', 'disabled-key', self.plan.sha256)

    def test_lco_requires_recent_remote_preflight(self):
        with self.assertRaises(InvalidPlan):
            self.submit()
        self.preflight()
        Job.objects.filter(action='validate_remote').update(finished_at=timezone.now()-timedelta(hours=1))
        with self.assertRaises(InvalidPlan):
            self.submit()

    def test_timeout_is_unknown_and_never_retried(self):
        self.preflight()
        job = self.submit()
        self.factory.return_value.execute.side_effect = NativeError('transport_unknown')
        service.run_job(job.id, self.factory)
        self.assertFalse(service.run_job(job.id, self.factory))
        job.refresh_from_db()
        self.assertEqual(job.state, 'unknown')
        self.factory.return_value.execute.assert_called_once()
        self.assertEqual(self.submit().id, job.id)
        with self.assertRaises(InvalidPlan):
            service.enqueue(self.user, self.plan, 'submit', 'different-key', self.plan.sha256)

    def test_confirmed_group_preserves_request_ids(self):
        self.preflight()
        job = self.submit()
        self.factory.return_value.execute.return_value = {'id': 123, 'proposal': 'TEST-ONLY',
            'state': 'PENDING', 'requests': [{'id': 456}]}
        service.run_job(job.id, self.factory)
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.external_id, '123')
        self.assertEqual(self.plan.request_ids, [456])
        self.assertEqual(self.plan.observation_state, 'PENDING')

    def test_malformed_receipt_cannot_leave_running_job(self):
        self.preflight()
        job = self.submit()
        self.factory.return_value.execute.return_value = {'id': 123, 'proposal': 'TEST-ONLY', 'requests': [None]}
        service.run_job(job.id, self.factory)
        job.refresh_from_db()
        self.plan.refresh_from_db()
        self.assertEqual(job.state, 'unknown')
        self.assertEqual(self.plan.external_id, '')

    def test_wrong_proposal_does_not_confirm_submission(self):
        self.preflight()
        job = self.submit()
        self.factory.return_value.execute.return_value = {'id': 123, 'proposal': 'OTHER', 'requests': [{'id': 456}]}
        service.run_job(job.id, self.factory)
        job.refresh_from_db()
        self.assertEqual(job.state, 'unknown')

    def test_trt_native_obs_id_without_invented_success_field(self):
        config = dict(PROFILE, facility='TRT', site='SRO', priority=84, binning='1,1')
        with override_settings(TELESCOPE_PROFILES={'test': config}):
            plan = service.create_plan(self.user, self.target, 'test', specification())
            service.validate_local(self.user, plan)
            service.approve(self.user, plan, plan.sha256)
            job = service.enqueue(self.user, plan, 'submit', 'trt-submit-key', plan.sha256)
            self.factory.return_value.execute.return_value = {'obs_id': '260913ABCD_1'}
            service.run_job(job.id, self.factory)
            job.refresh_from_db()
            plan.refresh_from_db()
            self.assertEqual(job.state, 'succeeded')
            self.assertEqual(plan.external_id, '260913ABCD_1')
            self.assertEqual(plan.observation_state, 'unknown')

    def test_trt_rejected_or_ambiguous_receipt_does_not_confirm(self):
        config = dict(PROFILE, facility='TRT', site='SRO', priority=84, binning='1,1')
        for index, raw in enumerate([{'error': 'denied', 'obs_id': '260913ABCD_1'},
                    {'obs_id': ['260913ABCD_1', '260913ABCD_2']},
                    {'status': 'failed', 'obs_id': '260913ABCD_1'}]):
            with self.subTest(raw=raw), override_settings(TELESCOPE_PROFILES={'test': config}):
                spec = specification()
                spec['epochs'][0]['exposures'][0]['count'] = index+1
                plan = service.create_plan(self.user, self.target, 'test', spec)
                service.validate_local(self.user, plan)
                service.approve(self.user, plan, plan.sha256)
                job = service.enqueue(self.user, plan, 'submit', str(plan.id), plan.sha256)
                self.factory.return_value.execute.return_value = raw
                service.run_job(job.id, self.factory)
                job.refresh_from_db()
                plan.refresh_from_db()
                self.assertNotEqual(job.state, 'succeeded')
                self.assertEqual(plan.external_id, '')

    def test_changed_coordinates_block_transport(self):
        self.preflight()
        job = self.submit()
        Target.objects.filter(pk=self.target.pk).update(ra=20.)
        service.run_job(job.id, self.factory)
        self.factory.assert_not_called()

    def test_revoked_approval_blocks_transport(self):
        self.preflight()
        job = self.submit()
        service.validate_local(self.user, self.plan)
        service.run_job(job.id, self.factory)
        self.factory.assert_not_called()

    def test_permission_and_hash_enforced(self):
        outsider = get_user_model().objects.create_user('outsider')
        with self.assertRaises(PermissionDenied):
            service.create_plan(outsider, self.target, 'test', specification())
        with self.assertRaises(InvalidPlan):
            service.approve(self.user, self.plan, 'bad-hash')

    def test_duplicate_draft_blocked(self):
        with self.assertRaises(InvalidPlan):
            service.create_plan(self.user, self.target, 'test', self.plan.specification)

    def test_equivalent_timezone_draft_cannot_bypass_duplicate_guard(self):
        spec = copy.deepcopy(self.plan.specification)
        for key in ['start_utc', 'end_utc']:
            spec['epochs'][0][key] = spec['epochs'][0][key].replace('+00:00', 'Z')
        with self.assertRaises(InvalidPlan):
            service.create_plan(self.user, self.target, 'test', spec)

    def test_group_and_object_permissions_are_both_required(self):
        from django.contrib.auth.models import Group
        from guardian.shortcuts import assign_perm
        user = get_user_model().objects.create_user('observer-authorized')
        group = Group.objects.create(name='test-proposal')
        user.groups.add(group)
        config = dict(PROFILE, group=group.name)
        with self.assertRaises(PermissionDenied):
            service.authorize(user, self.target, config)
        assign_perm('tom_targets.change_target', user, self.target)
        service.authorize(user, self.target, config)
        user.groups.clear()
        with self.assertRaises(PermissionDenied):
            service.authorize(user, self.target, config)

    def test_api_and_workspace(self):
        self.client.force_login(self.user)
        response = self.client.get('/telescope-data/operations/', secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'SN-test-only')
        self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_simple_form_creates_local_draft_without_network(self):
        self.client.force_login(self.user)
        with patch('requests.sessions.Session.request') as network:
            response = self.client.post('/telescope-data/operations/', {'action': 'create',
                'target_id': self.target.pk, 'profile': 'test', 'start_utc': '2099-01-01T01:00',
                'end_utc': '2099-01-01T02:00', 'band': 'r', 'count': '3', 'seconds': '60', 'max_airmass': '2'}, secure=True)
        self.assertEqual(response.status_code, 302)
        network.assert_not_called()
        self.assertEqual(self.target.plan_set.count(), 2)

    def test_api_draft_and_exact_hash_approval(self):
        self.client.force_login(self.user)
        root = '/telescope-data/operations/api/plans'
        response = self.client.post(root, json.dumps({'target_id': self.target.pk, 'profile': 'test',
            'specification': specification()}), content_type='application/json', secure=True)
        self.assertEqual(response.status_code, 201)
        plan = response.json()
        url = root+'/'+plan['id']
        self.assertEqual(self.client.post(url+'/validate', '{}', content_type='application/json', secure=True).status_code, 200)
        response = self.client.post(url+'/approve', json.dumps({'plan_sha256': plan['plan_sha256']}),
                                    content_type='application/json', secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json()['approved_at'])
        self.client.logout()
        self.assertIn(self.client.get(url, secure=True).status_code, [302, 403])

    def test_csrf_and_cancellation_confirmation_required(self):
        from django.test import Client as WebClient
        web = WebClient(enforce_csrf_checks=True)
        web.force_login(self.user)
        url = f'/telescope-data/operations/api/plans/{self.plan.id}/cancel'
        self.assertIn(web.post(url, '{}', content_type='application/json', secure=True).status_code, [302, 403])
        self.client.force_login(self.user)
        self.assertEqual(self.client.post(url, json.dumps({'plan_sha256': self.plan.sha256}),
            content_type='application/json', secure=True).status_code, 400)
        self.assertFalse(Job.objects.filter(action='cancel').exists())

    def test_interrupted_worker_is_not_requeued(self):
        job = Job.objects.create(plan=self.plan, actor=self.user, action='submit',
            idempotency_key='interrupted-key', state='running', started_at=timezone.now()-timedelta(minutes=11))
        self.assertEqual(service.recover_stale(), 1)
        job.refresh_from_db()
        self.assertEqual(job.state, 'unknown')
        self.assertFalse(service.run_job(job.id, self.factory))
        self.factory.assert_not_called()

    def test_inactive_actor_cannot_send(self):
        self.preflight()
        job = self.submit()
        self.user.is_active = False
        self.user.save(update_fields=['is_active'])
        service.run_job(job.id, self.factory)
        self.factory.assert_not_called()

    def test_non_detection_history_does_not_complete_new_job(self):
        self.plan.external_id = '123'
        self.plan.request_ids = [456]
        self.plan.save()
        job = service.enqueue(self.user, self.plan, 'files', 'file-list-key', self.plan.sha256)
        self.factory.return_value.frames.return_value = []
        service.run_job(job.id, self.factory)
        job.refresh_from_db()
        self.plan.refresh_from_db()
        self.assertEqual(job.result, {'data_state': 'listed_only', 'file_count': 0})
        self.assertEqual(self.plan.observation_state, 'unknown')


class PlanTests(SimpleTestCase):
    def setUp(self):
        self.target = Mock(ra=359.99999999999, dec=-0.5, type='SIDEREAL')
        self.target.name = 'test'

    def test_invalid_exposure_inputs(self):
        for field, value in [('band', 'R'), ('band', []), ('count', True), ('count', 1.5), ('seconds', float('nan'))]:
            spec = specification()
            spec['epochs'][0]['exposures'][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(InvalidPlan):
                compile_plan(spec, self.target, PROFILE, 'test', timezone.now())

    def test_naive_time_and_overlapping_windows(self):
        spec = specification()
        spec['epochs'].append(copy.deepcopy(spec['epochs'][0]))
        with self.assertRaises(InvalidPlan):
            compile_plan(spec, self.target, PROFILE, 'test', timezone.now())
        spec = specification()
        spec['epochs'][0]['start_utc'] = '2099-01-01T00:00:00'
        with self.assertRaises(InvalidPlan):
            compile_plan(spec, self.target, PROFILE, 'test', timezone.now())

    def test_trt_coordinates_are_sexagesimal_and_wrap_ra(self):
        config = dict(PROFILE, facility='TRT', site='SRO', binning='1,1', priority=84)
        payload = compile_plan(specification(), self.target, config, 'test', timezone.now())['script'][0]
        self.assertEqual(payload['RA'], '00:00:00.00000000')
        self.assertEqual(payload['DEC'], '-00:30:00.00000000')


class NativeTests(SimpleTestCase):
    @patch.dict('os.environ', {'TEST_LCO_TOKEN': 'test-only'})
    def test_lco_cancel_independently_reads_back(self):
        client = Client(PROFILE)
        client.send = Mock(return_value=b'{}')
        client.lco('cancel', external_id='123')
        self.assertEqual([call.args[0] for call in client.send.call_args_list], ['POST', 'GET'])
        self.assertTrue(client.send.call_args_list[0].args[1].endswith('/123/cancel/'))
        self.assertTrue(client.send.call_args_list[1].args[1].endswith('/123/'))

    def test_trt_scalar_file_id_and_list_status_id(self):
        from .test_handoff import fake_token, NOW
        token = fake_token()
        credentials = patch.dict('os.environ', {'TEST_LCO_TOKEN': token})
        clock = patch('telescope_ops.native.timezone.now', return_value=NOW)
        credentials.start()
        clock.start()
        self.addCleanup(credentials.stop)
        self.addCleanup(clock.stop)
        client = Client(dict(PROFILE, facility='TRT', priority=84))
        client.json = Mock(return_value={})
        client.trt('files', external_id='test-id')
        self.assertEqual(client.json.call_args.kwargs['body'], {'obs_id': 'test-id'})
        self.assertEqual(client.json.call_args.kwargs['headers'], {'TRT': token})
        client.trt('status', external_id='test-id')
        self.assertEqual(client.json.call_args.kwargs['body'], {'obs_id': ['test-id']})

    @patch.dict('os.environ', {'TEST_LT_USER': 'test', 'TEST_LT_PASSWORD': 'test-only'})
    def test_lt_receipt_identity_schedule_and_rejection(self):
        config = dict(PROFILE, facility='LT', contact_user='test', binning=[1, 1], instrument='IO:O',
                      endpoint='https://example.invalid/soap', username_env='TEST_LT_USER', password_env='TEST_LT_PASSWORD')
        target = Mock(ra=15., dec=-0.5, type='SIDEREAL')
        target.name = 'test'
        payload = compile_plan(specification(), target, config, 'test-uid', timezone.now())
        client = Client(config)
        root = ET.fromstring(payload['xml'])
        root.set('mode', 'confirm')
        def response():
            soap = ET.Element('Envelope')
            ET.SubElement(soap, 'return').text = ET.tostring(root, encoding='unicode')
            return ET.tostring(soap)
        client.send = Mock(side_effect=lambda *args, **kwargs: response())
        self.assertTrue(client.lt('submit', payload)['schedule_match'])
        root.set('mode', 'reject')
        self.assertEqual(client.lt('submit', payload)['mode'], 'reject')
        root.set('uid', 'wrong-uid')
        with self.assertRaises(NativeError):
            client.lt('submit', payload)
        root.set('uid', 'test-uid')
        root.set('mode', 'confirm')
        root.remove(next(e for e in root if e.tag.endswith('Schedule')))
        self.assertFalse(client.lt('submit', payload)['schedule_match'])

    def test_unsupported_facilities_have_no_write_actions(self):
        self.assertEqual(service.available_actions(dict(PROFILE, facility='REM')), set())
        self.assertNotIn('validate_remote', service.available_actions(dict(PROFILE, facility='LT')))
        self.assertEqual(service.available_actions(dict(PROFILE, enabled=False)), set())

    @patch.dict('os.environ', {'TEST_ARCHIVE_TOKEN': 'test-only'})
    def test_archive_pagination_cannot_forward_token_to_other_origin(self):
        client = Client(PROFILE)
        client.json = Mock(return_value={'results': [], 'next': 'https://example.invalid/frames/'})
        with self.assertRaises(NativeError):
            client.frames([123])
        client.json.assert_called_once()

    @patch.dict('os.environ', {'TEST_LCO_TOKEN': 'test-only'})
    def test_redirects_disabled_and_no_http_retry(self):
        session = MagicMock()
        response = session.request.return_value
        response.status_code = 302
        with self.assertRaises(NativeError):
            Client(PROFILE, session).lco('submit', {})
        session.request.assert_called_once()
        self.assertFalse(session.request.call_args.kwargs['allow_redirects'])


class SnapshotTests(SimpleTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.report = self.root / 'input.json'
        self.fixture = Path(__file__).parents[1] / 'telescope_data/fixtures/snapshot.synthetic.json'
        self.report.write_bytes(self.fixture.read_bytes())
        self.destination = self.root / 'published'

    def test_json_publication_remains_readable(self):
        result = publish(self.report, self.destination)
        self.assertTrue(SnapshotReader(result['path']).targets())

    def test_html_publication_and_idempotent_sync(self):
        html = self.root/'input.html'
        html.write_text('<script id="sn-data" type="application/json">'+self.report.read_text()+'</script>')
        first = publish(html, self.destination)
        second = publish(html, self.destination)
        self.assertEqual(first['version'], second['version'])
        self.assertTrue(SnapshotReader(second['path']).targets())

    def test_local_sync_command_and_disabled_gate(self):
        with override_settings(TELESCOPE_REPORT_SYNC={'enabled': True, 'mode': 'local',
                'source': str(self.report), 'destination': str(self.destination)}):
            call_command('sync_telescope_snapshot', stdout=Mock())
        self.assertTrue((self.destination/'current/report.json').is_file())
        with override_settings(TELESCOPE_REPORT_SYNC={}), self.assertRaises(CommandError):
            call_command('sync_telescope_snapshot')

    def test_ssh_sync_uses_referenced_assets_not_whole_tree(self):
        seen = []
        def transfer(command, **kwargs):
            seen.append(kwargs['input'])
            stage = Path(command[-1])
            if len(seen) == 1:
                (stage/'report.json').write_bytes(self.fixture.read_bytes())
            return Mock(returncode=0)
        with override_settings(TELESCOPE_REPORT_SYNC={'enabled': True, 'mode': 'ssh',
                'ssh_alias': 'test-only', 'source': '/reports', 'report_name': 'report.json',
                'destination': str(self.destination)}), patch('telescope_ops.management.commands.sync_telescope_snapshot.subprocess.run', side_effect=transfer):
            call_command('sync_telescope_snapshot', stdout=Mock())
        self.assertEqual(seen[0], b'report.json\0')
        self.assertEqual(seen[1], b'assets/LT/2099demo/20990101/raw.jpg\0')

    def test_asset_changes_invalidate_report_fingerprint(self):
        # Use the actual QA location in the handoff fixture.
        row = next(iter(SnapshotReader(self.report).qa()))
        asset = self.root / row['src']
        asset.parent.mkdir(parents=True, exist_ok=True)
        asset.write_bytes(b'first')
        first = publish(self.report, self.destination)
        first_hash = SnapshotReader(first['path']).sha256
        asset.write_bytes(b'second')
        second = publish(self.report, self.destination)
        self.assertNotEqual(first_hash, SnapshotReader(second['path']).sha256)

    def test_unsafe_asset_preserves_previous_snapshot(self):
        first = publish(self.report, self.destination)
        previous = (self.destination/'current').resolve()
        raw = self.report.read_text()
        row = next(iter(SnapshotReader(self.report).qa()))
        self.report.write_text(raw.replace(row['src'], '../private.png'))
        with self.assertRaises(ValueError):
            publish(self.report, self.destination)
        self.assertEqual(previous, (self.destination/'current').resolve())
        self.assertTrue(Path(first['path']).is_file())
