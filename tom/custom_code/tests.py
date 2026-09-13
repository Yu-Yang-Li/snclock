import json
from unittest.mock import Mock, patch

import requests
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils.timezone import is_aware
from tom_dataproducts.models import DataProduct
from tom_targets.models import Target, TargetExtra


class UnifiedHeaderTests(TestCase):
    def test_shared_pages_keep_snclock_identity_and_navigation(self):
        for path in ['/accounts/login/', '/telescope-data/']:
            response = self.client.get(path, secure=True)
            self.assertContains(response, '<title>SN Clock |')
            self.assertContains(response, 'snclock-logo')
            self.assertNotContains(response, 'logo-color-cropped.png')
            self.assertNotContains(response, 'navbar-dark bg-dark')
            for link in ['/', '/targets/', '/observations/list/', '/telescope-data/', '/dataproducts/data/', '/users/profile/']:
                # Target and observation destinations remain in their existing dropdowns.
                self.assertContains(response, f'href="{link}"')


class SyncSnclockTests(TestCase):
    def test_report_name_resolves_unique_tns_prefix(self):
        target = Target.objects.create(name='AT 2099demo', type=Target.SIDEREAL,
                                       ra=10, dec=20, permissions='OPEN')
        response = self.client.get('/from-snclock/2099demo/', secure=True)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], f'/targets/{target.pk}/')

    def test_ambiguous_tns_alias_does_not_choose_an_arbitrary_target(self):
        for name in ['AT 2099demo', 'SN 2099demo']:
            Target.objects.create(name=name, type=Target.SIDEREAL, ra=10, dec=20, permissions='OPEN')
        response = self.client.get('/from-snclock/2099demo/', secure=True)
        self.assertEqual(response['Location'], '/targets/?query=2099demo')

    def test_target_detail_renders_sky_context(self):
        target = Target.objects.create(
            name="AT 2026sky",
            type=Target.SIDEREAL,
            ra=12.5,
            dec=-33.1,
            permissions="OPEN",
        )

        response = self.client.get(f"/targets/{target.pk}/", secure=True)

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "天区与宿主核验")
        self.assertContains(response, 'class="sky-context"')
        self.assertContains(response, 'data-ra="12.5"')
        self.assertContains(response, 'data-dec="-33.1"')
        self.assertContains(response, "target-sky-context.js")
        self.assertContains(response, "SIMBAD")
        self.assertContains(response, "NED")
        self.assertContains(response, "Gaia DR3")
        self.assertContains(
            response,
            "/static/vendor/plotly/plotly-basic-2.35.2.min.js",
            count=1,
        )
        self.assertNotContains(response, "plotly.js v2.35.2")
        self.assertLess(len(response.content), 250_000)

    def test_anonymous_web_write_redirects_to_login(self):
        response = self.client.post(
            "/targets/create/",
            {
                "name": "AT web forbidden",
                "type": "SIDEREAL",
                "ra": 12.5,
                "dec": -33.1,
            },
            secure=True,
        )

        self.assertEqual(response.status_code, 302)
        self.assertIn("/accounts/login/", response["Location"])
        self.assertFalse(Target.objects.filter(name="AT web forbidden").exists())

    def test_anonymous_api_write_is_forbidden(self):
        response = self.client.post(
            "/api/targets/",
            {
                "name": "AT forbidden",
                "type": "SIDEREAL",
                "ra": 12.5,
                "dec": -33.1,
            },
            secure=True,
        )

        self.assertIn(response.status_code, {401, 403})
        self.assertFalse(Target.objects.filter(name="AT forbidden").exists())

    def test_snclock_target_link_redirects_to_exact_target(self):
        target = Target.objects.create(
            name="AT 2026abc",
            type=Target.SIDEREAL,
            ra=12.5,
            dec=-33.1,
            permissions="OPEN",
        )

        response = self.client.get(
            "/from-snclock/AT%202026abc/",
            secure=True,
        )

        self.assertRedirects(
            response,
            f"/targets/{target.pk}/",
            fetch_redirect_response=False,
        )

    def test_unknown_snclock_target_falls_back_to_filtered_list(self):
        response = self.client.get(
            "/from-snclock/AT%202026missing/",
            secure=True,
        )

        self.assertRedirects(
            response,
            "/targets/?query=AT+2026missing",
            fetch_redirect_response=False,
        )

    def test_stdweb_workspace_requires_login(self):
        target = Target.objects.create(
            name="AT 2026fits",
            type=Target.SIDEREAL,
            ra=12.5,
            dec=-33.1,
            permissions="OPEN",
        )

        response = self.client.get(
            f"/stdweb/targets/{target.pk}/",
            secure=True,
        )

        self.assertEqual(response.status_code, 302)
        self.assertIn("/accounts/login/", response["Location"])

    @override_settings(
        STDWEB_API_URL="http://127.0.0.1:8021/api/",
        STDWEB_PUBLIC_URL="https://reduce.snclock.com",
        STDWEB_API_TOKEN="test-token",
    )
    @patch("custom_code.views.StdWebClient.create_task")
    def test_submits_target_fits_to_stdweb(self, create_task):
        create_task.return_value = {"id": 42, "state": "uploaded"}
        target = Target.objects.create(
            name="AT 2026fits",
            type=Target.SIDEREAL,
            ra=12.5,
            dec=-33.1,
            permissions="OPEN",
        )
        product = DataProduct.objects.create(
            target=target,
            data_product_type="fits_file",
            data=SimpleUploadedFile("science.fits", b"SIMPLE  = T"),
        )
        user = get_user_model().objects.create_user(
            username="observer",
            password="safe-password",
        )
        self.client.force_login(user)

        response = self.client.post(
            f"/stdweb/targets/{target.pk}/",
            {"data_product_id": product.pk},
            secure=True,
        )

        self.assertRedirects(
            response,
            f"/stdweb/targets/{target.pk}/",
            fetch_redirect_response=False,
        )
        config = create_task.call_args.args[2]
        self.assertEqual(config["target_ra"], 12.5)
        self.assertEqual(config["target_dec"], -33.1)
        product.refresh_from_db()
        self.assertEqual(
            json.loads(product.extra_data)["stdweb"]["task_id"],
            42,
        )

    @patch("custom_code.views.get_stack_status")
    def test_system_status_renders_all_modules(self, get_status):
        get_status.return_value = {
            "ok": True,
            "rows": [
                {
                    "name": name,
                    "ok": True,
                    "purpose": "test",
                    "detail": "ready",
                    "url": "https://example.test/",
                }
                for name in ("SN Clock", "TOM", "STDWeb")
            ],
        }
        user = get_user_model().objects.create_user(
            username="operator",
            password="safe-password",
        )
        self.client.force_login(user)

        response = self.client.get("/system-status/", secure=True)

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "SN Clock")
        self.assertContains(response, "TOM")
        self.assertContains(response, "STDWeb")

    @patch("custom_code.management.commands.sync_snclock.time.sleep")
    @patch("custom_code.management.commands.sync_snclock.requests.get")
    def test_retries_transient_connection_failure(self, get, sleep):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"data": []}
        get.side_effect = [requests.ConnectionError("temporary"), response]

        call_command("sync_snclock")

        self.assertEqual(get.call_count, 2)
        sleep.assert_called_once_with(5)

    @patch("custom_code.management.commands.sync_snclock.requests.get")
    def test_imports_valid_candidate_and_skips_invalid_coordinates(self, get):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "data": [
                {
                    "tns_name": "AT 2026abc",
                    "ra": 12.5,
                    "dec": -33.1,
                    "discovery_date": "2026-07-28T15:30:34.272",
                    "discovery_mag": 18.2,
                    "sn_clock": {"texp": -1.25},
                },
                {"tns_name": "AT invalid", "ra": 400, "dec": 0},
            ]
        }
        get.return_value = response

        call_command("sync_snclock")

        target = Target.objects.get(name="AT 2026abc")
        self.assertEqual(target.type, Target.SIDEREAL)
        self.assertEqual(target.permissions, "OPEN")
        self.assertEqual(Target.objects.count(), 1)
        self.assertEqual(
            TargetExtra.objects.get(target=target, key="sn_clock_texp").float_value,
            -1.25,
        )
        self.assertTrue(
            is_aware(
                TargetExtra.objects.get(
                    target=target,
                    key="discovery_date",
                ).time_value
            )
        )

    @patch("custom_code.management.commands.sync_snclock.requests.get")
    def test_empty_response_does_not_delete_existing_targets(self, get):
        Target.objects.create(
            name="AT historical",
            type=Target.SIDEREAL,
            ra=10,
            dec=20,
            permissions="OPEN",
        )
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"data": []}
        get.return_value = response

        call_command("sync_snclock")

        self.assertTrue(Target.objects.filter(name="AT historical").exists())


class ObservationTemplateRouteTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="template-operator",
            password="safe-password",
        )

    def test_anonymous_template_list_redirects_to_login(self):
        response = self.client.get(
            "/observations/template/list/",
            secure=True,
        )

        self.assertEqual(response.status_code, 302)
        self.assertIn("/accounts/login/", response["Location"])

    def test_anonymous_template_create_redirects_to_login(self):
        response = self.client.get(
            "/observations/template/GEM/create/",
            secure=True,
        )

        self.assertEqual(response.status_code, 302)
        self.assertIn("/accounts/login/", response["Location"])

    def test_authenticated_template_list_omits_redirect_facilities(self):
        self.client.force_login(self.user)

        response = self.client.get(
            "/observations/template/list/",
            secure=True,
        )

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "/observations/template/GEM/create/")
        self.assertNotContains(
            response,
            "/observations/template/LCORedirect/create/",
        )

    def test_authenticated_redirect_facility_template_create_returns_404(self):
        self.client.force_login(self.user)
        self.client.raise_request_exception = False

        response = self.client.get(
            "/observations/template/LCORedirect/create/",
            secure=True,
        )

        self.assertEqual(response.status_code, 404)

    def test_authenticated_form_facility_template_create_still_renders(self):
        self.client.force_login(self.user)

        response = self.client.get(
            "/observations/template/GEM/create/",
            secure=True,
        )

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "<form", html=False)
