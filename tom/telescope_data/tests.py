import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse

from .views import access_error, cached_reader


FIXTURE = Path(__file__).parent / 'fixtures' / 'snapshot.synthetic.json'
BASE = '/telescope-data/api/v1/'
TARGET = BASE + 'targets/2099demo/'


@override_settings(TELESCOPE_SNAPSHOT_PATH=str(FIXTURE), TELESCOPE_SNAPSHOT_SYNTHETIC=True)
class TelescopeDataTests(TestCase):
    def setUp(self):
        self.staff = get_user_model().objects.create_user(username='staff', is_staff=True)
        self.client.force_login(self.staff)
        cached_reader.cache_clear()

    def get(self, path, params=None):
        return self.client.get(path, params or {}, secure=True)

    def test_anonymous_and_unmapped_users_cannot_read_data(self):
        self.client.logout()
        for path in [BASE + 'targets', BASE + 'capabilities', TARGET + 'photometry', '/telescope-data/assets/unknown']:
            response = self.get(path)
            self.assertIn(response.status_code, [401, 302])
            self.assertNotIn(b'2099demo', response.content)
        user = get_user_model().objects.create_user(username='reader', is_staff=False)
        self.client.force_login(user)
        # TOM Toolkit's Raise403Middleware redirects denied users to login.
        response = self.get(BASE + 'targets')
        self.assertEqual(response.status_code, 302)
        self.assertIn('/accounts/login/', response['Location'])
        self.assertNotIn(b'2099demo', response.content)
        request = RequestFactory().get(BASE + 'targets')
        request.user = user
        self.assertEqual(access_error(request).status_code, 403)

    def test_read_only_and_capabilities_not_permissions(self):
        response = self.client.post(TARGET + 'photometry', secure=True)
        self.assertEqual(response.status_code, 405)
        payload = self.get(BASE + 'capabilities').json()
        self.assertFalse(payload['live_permissions_verified'])
        for row in payload['facilities']:
            self.assertFalse(row['submit'])
            self.assertFalse(row['cancel'])
            self.assertFalse(row['sync'])

    def test_aliases_raw_magnitude_and_non_detection_preserved(self):
        response = self.get(BASE + 'targets/SN2099demo/photometry')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['items'][0]['mag'], 19.1)
        self.assertEqual(data['items'][0]['plotMag'], 20.1)
        self.assertFalse(data['items'][1]['detected'])
        self.assertIsNone(data['items'][1]['mag'])
        self.assertTrue(data['synthetic'])
        self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_case_sensitive_band_and_pagination(self):
        for band, telescope in [('r', 'LT'), ('R', 'TRT')]:
            data = self.get(TARGET + 'photometry', {'band': band}).json()
            self.assertEqual(data['total'], 1)
            self.assertEqual(data['items'][0]['telescope'], telescope)
        page = self.get(TARGET + 'photometry', {'limit': 1}).json()
        self.assertEqual(page['next_offset'], 1)
        self.assertEqual(page['total'], 3)
        self.assertEqual(self.get(TARGET + 'photometry', {'telescope': 'REM'}).json()['total'], 0)

    def test_unknown_target_is_not_empty_known_target(self):
        self.assertEqual(self.get(BASE + 'targets/unknown/photometry').status_code, 404)

    def test_invalid_filters(self):
        for params in [{'offset': -1}, {'limit': 1001}, {'limit': 'nan'}, {'date_from': '2099-99-01'},
                       {'date_from': '2099-01-02', 'date_to': '2099-01-01'}, {'path': '../private'}]:
            with self.subTest(params=params):
                self.assertEqual(self.get(TARGET + 'photometry', params).status_code, 400)

    def test_conflicting_request_states_remain_separate(self):
        row = self.get(TARGET + 'requests').json()['items'][0]
        self.assertEqual(row['facility_status'], 'PENDING')
        self.assertEqual(row['reported_status'], 'processed')
        self.assertEqual(row['raw_files'], 0)
        self.assertEqual(len(row['consistency_warnings']), 2)

    def test_missing_qa_never_exposes_raw_path(self):
        rows = self.get(TARGET + 'qa').json()['items']
        for row in rows:
            self.assertNotIn('src', row)
            self.assertIsNone(row['asset_url'])

    def test_unconfigured_and_malformed_report_fail_closed(self):
        with override_settings(TELESCOPE_SNAPSHOT_PATH=''):
            self.assertEqual(self.get(BASE + 'targets').status_code, 503)
        with patch('telescope_data.views.reader', side_effect=ValueError('private-location')):
            response = self.get(BASE + 'targets')
            self.assertEqual(response.status_code, 503)
            self.assertNotIn(b'private-location', response.content)

    def test_workspace_marks_fixture_and_keeps_target_context(self):
        self.assertContains(self.get('/telescope-data/'), '合成演示数据')
        response = self.get('/telescope-data/', {'target': 'AT2099demo'})
        self.assertContains(response, 'value="2099demo" selected')
        response = self.get('/telescope-data/', {'target': 'unknown'})
        self.assertContains(response, '尚未包含该目标')
        self.assertNotContains(response, 'id="telescope-filters"')

    def test_assets_reject_traversal_and_allow_only_raster(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'assets').mkdir()
            (root / 'assets' / 'plot.png').write_bytes(b'png-test-fixture')
            (root / 'assets' / 'script.svg').write_text('<svg/>', encoding='utf-8')
            data = json.loads(FIXTURE.read_text(encoding='utf-8'))
            items = data['sourceData']['2099demo']['remMedia'][0]['items']
            items[:] = [{'src': src, 'stage': str(i)} for i, src in enumerate([
                'assets/plot.png', 'assets/script.svg', 'assets/../../private.png',
                'assets/%252e%252e/private.png', 'https://example.org/image.png'])]
            report = root / 'report.json'
            report.write_text(json.dumps(data), encoding='utf-8')
            with override_settings(TELESCOPE_SNAPSHOT_PATH=str(report)):
                rows = self.get(TARGET + 'qa').json()['items']
                response = self.get(rows[0]['asset_url'])
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response['X-Content-Type-Options'], 'nosniff')
                response.close()
                self.assertEqual(self.get(rows[1]['asset_url']).status_code, 415)
                for row in rows[2:]:
                    self.assertIsNone(row['asset_url'])
                data['generatedAt'] = '2099-02-02T00:00:00Z'
                report.write_text(json.dumps(data) + ' ', encoding='utf-8')
                self.assertEqual(self.get(BASE + 'targets').json()['generated_at'], data['generatedAt'])


class UnifiedHomeTests(TestCase):
    def test_frontend_navigation_contract_matches_tom_routes(self):
        for route, expected in [('targets:list', '/targets/'),
                                ('tom_observations:list', '/observations/list/'),
                                ('tom_dataproducts:list', '/dataproducts/data/'),
                                ('telescope-workspace', '/telescope-data/')]:
            self.assertEqual(reverse(route), expected)

    def test_home_and_source_use_same_frontend_not_redirect(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'index.html').write_text('<html>SN Clock test</html>', encoding='utf-8')
            with override_settings(SNCLOCK_FRONTEND_DIST=directory):
                for url in ['/', '/source/AT%202099demo']:
                    response = self.client.get(url, secure=True)
                    self.assertEqual(response.status_code, 200)
                    self.assertIn(b'SN Clock test', b''.join(response.streaming_content))
                    response.close()
                self.assertEqual(self.client.post('/', secure=True).status_code, 405)

    def test_missing_build_does_not_fall_back_to_different_homepage(self):
        with tempfile.TemporaryDirectory() as directory:
            with override_settings(SNCLOCK_FRONTEND_DIST=directory):
                self.assertEqual(self.client.get('/', secure=True).status_code, 503)
