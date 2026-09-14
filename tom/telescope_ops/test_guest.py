from django.test import TestCase, override_settings


class GuestPresentationTests(TestCase):
    def test_guest_telescope_pages_hide_login_without_exposing_controls(self):
        for path in ['/telescope-data/', '/telescope-data/operations/']:
            with self.subTest(path=path):
                response = self.client.get(path, secure=True)
                self.assertEqual(response.status_code, 200)
                self.assertNotContains(response, '/accounts/login/')
                self.assertNotContains(response, '操作未执行')
                self.assertNotContains(response, 'name="specification"')
                self.assertNotContains(response, 'id="telescope-points"')

    @override_settings(TELESCOPE_OPERATIONS_ENABLED=True)
    def test_hidden_login_does_not_allow_anonymous_api_or_disable_signin(self):
        self.assertEqual(self.client.get('/telescope-data/api/v1/targets', secure=True).status_code, 401)
        response = self.client.post('/telescope-data/operations/api/plans', data={},
            content_type='application/json', secure=True)
        self.assertIn(response.status_code, (302, 403))
        if response.status_code == 302:
            self.assertIn('/accounts/login/', response['Location'])
        self.assertEqual(self.client.get('/accounts/login/', secure=True).status_code, 200)
