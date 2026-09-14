import json
from datetime import timedelta
from unittest.mock import Mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from tom_targets.models import Target

from . import service
from .models import Job, Plan
from .tests import PROFILE, specification


@override_settings(TELESCOPE_OPERATIONS_ENABLED=True, TELESCOPE_PROFILES={'test': PROFILE})
class RegistrationTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser('registration-operator', 'test@example.invalid', 'test')
        self.target = Target.objects.create(name='SN2026-registration-test', type='SIDEREAL', ra=15., dec=-0.5)
        self.plan = service.create_plan(self.user, self.target, 'test', specification())
        service.validate_local(self.user, self.plan)
        service.approve(self.user, self.plan, self.plan.sha256)
        self.factory = Mock()
        self.factory.return_value.execute.return_value = {'errors': {}}
        preflight = service.enqueue(self.user, self.plan, 'validate_remote', 'reg-preflight-key', self.plan.sha256)
        service.run_job(preflight.id, self.factory)
        self.factory.return_value.execute.return_value = {'id': 123, 'proposal': 'TEST-ONLY',
            'state': 'PENDING', 'requests': [{'id': 456}]}

    def submit(self):
        job = service.enqueue(self.user, self.plan, 'submit', 'reg-submit-key', self.plan.sha256)
        service.run_job(job.id, self.factory)
        self.plan.refresh_from_db()
        return job

    def test_acceptance_stores_registration_separate_from_execution(self):
        self.submit()
        self.client.force_login(self.user)
        response = self.client.get(f'/telescope-data/operations/api/plans/{self.plan.id}/registration', secure=True)
        self.assertEqual(response.status_code, 200)
        record = response.json()
        self.assertIn('state', record)
        self.assertEqual(record['state'], 'pending')
        self.assertEqual(record['request_group_id'], '123')
        self.assertEqual(record['request_ids'], [456])
        self.assertEqual(record['target']['name'], 'SN2026-registration-test')
        self.assertEqual(record['facility'], 'LCO')
        self.assertEqual(record['proposal'], 'TEST-ONLY')
        self.assertEqual(record['plan_id'], str(self.plan.id))
        self.assertEqual(self.plan.observation_state, 'PENDING')
        self.assertNotIn('token_env', json.dumps(record))

    def test_registration_export_repeats_without_submitting(self):
        self.submit()
        self.client.force_login(self.user)
        url = f'/telescope-data/operations/api/plans/{self.plan.id}/registration'
        first = self.client.get(url, secure=True)
        second = self.client.get(url, secure=True)
        self.assertEqual(first.content, second.content)
        self.assertEqual(second['Content-Type'], 'application/json')
        self.assertIn('Content-Disposition', second.headers)
        self.assertIn('attachment', second['Content-Disposition'])
        self.assertEqual(second['Cache-Control'], 'private, no-store')
        self.assertEqual(Job.objects.filter(action='submit').count(), 1)

    def test_unsubmitted_plan_cannot_export_registration(self):
        self.client.force_login(self.user)
        response = self.client.get(f'/telescope-data/operations/api/plans/{self.plan.id}/registration', secure=True)
        self.assertEqual(response.status_code, 409)

    def test_export_keeps_original_target_and_payload_after_target_edit(self):
        self.submit()
        self.client.force_login(self.user)
        url = f'/telescope-data/operations/api/plans/{self.plan.id}/registration'
        first = self.client.get(url, secure=True).json()
        Target.objects.filter(pk=self.target.pk).update(name='renamed', ra=25.)
        second = self.client.get(url, secure=True).json()
        self.assertEqual(second, first)
        self.assertEqual(second['target']['ra_deg'], 15.)

    def test_registration_export_requires_target_permission(self):
        self.submit()
        outsider = get_user_model().objects.create_user('registration-outsider')
        self.client.force_login(outsider)
        response = self.client.get(f'/telescope-data/operations/api/plans/{self.plan.id}/registration', secure=True)
        self.assertIn(response.status_code, [302, 403])
        self.assertNotIn(b'TEST-ONLY', response.content)

    def test_unconfirmed_receipt_does_not_generate_registration(self):
        self.factory.return_value.execute.return_value = {'id': 123, 'proposal': 'OTHER'}
        self.submit()
        self.client.force_login(self.user)
        response = self.client.get(f'/telescope-data/operations/api/plans/{self.plan.id}/registration', secure=True)
        self.assertEqual(response.status_code, 409)

    def test_stale_status_job_does_not_mutate_submission_unknown(self):
        self.submit()
        job = Job.objects.create(plan=self.plan, actor=self.user, action='status', idempotency_key='reg-status-key',
            state='running', started_at=timezone.now()-timedelta(minutes=11))
        service.recover_stale()
        job.refresh_from_db()
        self.assertEqual(job.state, 'failed')
        self.assertTrue(Job.objects.filter(plan=self.plan, action='submit', state='succeeded').exists())

    def test_workspace_distinguishes_acceptance_from_registration(self):
        self.submit()
        self.client.force_login(self.user)
        response = self.client.get('/telescope-data/operations/', secure=True)
        self.assertContains(response, '尚未登记到下载处理链')
        self.assertContains(response, '导出登记单')

    def test_workspace_hides_submit_after_send_intent(self):
        service.enqueue(self.user, self.plan, 'submit', 'reg-submit-key', self.plan.sha256)
        self.client.force_login(self.user)
        response = self.client.get('/telescope-data/operations/', secure=True)
        self.assertNotContains(response, 'value="submit"')
        self.assertNotContains(response, 'value="approve"')

    def test_trt_cancellation_is_not_advertised_without_receipt_support(self):
        self.assertNotIn('cancel', service.available_actions(dict(PROFILE, facility='TRT', priority=84)))

    def test_rejected_lt_status_does_not_claim_success(self):
        config = dict(PROFILE, facility='LT', binning=[1, 1], instrument='IO:O', contact_user='test')
        with override_settings(TELESCOPE_PROFILES={'test': config}):
            plan = service.create_plan(self.user, self.target, 'test', specification())
            plan.external_id = str(plan.id)
            plan.save()
            job = service.enqueue(self.user, plan, 'status', 'lt-status-key', plan.sha256)
            self.factory.return_value.execute.return_value = {'mode': 'reject', 'uid': str(plan.id), 'proposal': 'TEST-ONLY'}
            service.run_job(job.id, self.factory)
            job.refresh_from_db()
            self.assertEqual(job.state, 'rejected')

    def test_unknown_file_reply_does_not_claim_listing_success(self):
        self.submit()
        job = service.enqueue(self.user, self.plan, 'files', 'reg-files-key', self.plan.sha256)
        self.factory.return_value.frames.return_value = {'errors': 'upstream unavailable'}
        service.run_job(job.id, self.factory)
        job.refresh_from_db()
        self.assertNotEqual(job.state, 'succeeded')

    def test_trt_wcs_file_dictionary_counts_only_listed_wcs_products(self):
        config = dict(PROFILE, facility='TRT', site='SRO', priority=84, binning='1,1')
        with override_settings(TELESCOPE_PROFILES={'test': config}):
            plan = service.create_plan(self.user, self.target, 'test', specification())
            plan.external_id = '260913ABCD_1'
            plan.save()
            job = service.enqueue(self.user, plan, 'files', 'trt-wcs-files-key', plan.sha256)
            self.factory.return_value.execute.return_value = {'file_path': {
                'R': {'wcs': 'https://example.invalid/R.fits', 'raw': 'https://example.invalid/raw.fits'},
                'B': {'raw': 'https://example.invalid/B.fits'}}}
            service.run_job(job.id, self.factory)
            job.refresh_from_db()
            self.assertEqual(job.state, 'succeeded')
            self.assertEqual(job.result, {'data_state': 'listed_only', 'file_count': 1})
            self.assertNotIn('https://', json.dumps(job.result))

    def test_modified_registration_is_rejected(self):
        self.submit()
        corrupted = dict(self.plan.registration_payload, external_id='another-observation')
        Plan.objects.filter(pk=self.plan.pk).update(registration_payload=corrupted)
        self.client.force_login(self.user)
        response = self.client.get(f'/telescope-data/operations/api/plans/{self.plan.id}/registration', secure=True)
        self.assertEqual(response.status_code, 409)

    def test_interrupted_write_never_exposes_resubmit_button(self):
        job = service.enqueue(self.user, self.plan, 'submit', 'reg-submit-key', self.plan.sha256)
        Job.objects.filter(pk=job.pk).update(state='running', started_at=timezone.now()-timedelta(minutes=11))
        service.recover_stale()
        job.refresh_from_db()
        self.assertEqual(job.state, 'unknown')
        self.client.force_login(self.user)
        response = self.client.get('/telescope-data/operations/', secure=True)
        self.assertContains(response, '结果待核对，勿重复提交')
        self.assertNotContains(response, 'value="submit"')
