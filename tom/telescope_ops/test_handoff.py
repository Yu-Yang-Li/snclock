"""Contract regressions derived from the 2026-09-13 submission handoff, no real tokens."""
import base64
import json
from datetime import datetime, timezone
from unittest.mock import Mock, patch
from xml.etree import ElementTree as ET

from django.test import SimpleTestCase

from .native import Client, NativeError
from .plans import InvalidPlan, compile_plan


NOW = datetime(2026, 9, 13, tzinfo=timezone.utc)
SPEC = {'epochs': [{'start_utc': '2026-09-14T01:00:00Z', 'end_utc': '2026-09-14T02:00:00Z',
    'max_airmass': 2, 'exposures': [{'band': 'R', 'count': 3, 'seconds': 60}]}]}
TRT = {'facility': 'TRT', 'proposal': 'TEST', 'priority': 84, 'site': 'SRO', 'binning': '1,1',
    'filter_map': {'R': 'R'}, 'enabled': True, 'token_env': 'TEST_TRT_ONLY'}


def target():
    result = Mock(type='SIDEREAL', ra=15., dec=-0.5)
    result.name = 'SN2026test'
    return result


def fake_token(priority=84, expire='2026-12-31T23:59:00Z', exp=1798677200):
    claims = {'priority': priority, 'startDate': '2026-09-01T00:00:00Z', 'expireDate': expire, 'exp': exp}
    segment = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')
    return 'eyJhbGciOiJIUzI1NiJ9.'+segment+'.TEST_NOT_A_REAL_SIGNATURE'


class HandoffContractTests(SimpleTestCase):
    def setUp(self):
        clock = patch('telescope_ops.native.timezone.now', return_value=NOW)
        clock.start()
        self.addCleanup(clock.stop)

    def test_trt_native_wire_fields_and_types(self):
        row = compile_plan(SPEC, target(), TRT, 'test-uid', NOW)['script'][0]
        self.assertEqual(row['Exposure'], ['60'])
        self.assertEqual(row['Repeat'], ['3'])
        self.assertEqual(row['MaxAirmass'], '2')
        for key, value in {'Subframe': '1', 'PA': '', 'Dither': '0', 'ExposuresMode': '1',
                           'M3Port': '1', 'isQuicklook': '1', 'BinningXY': '1,1'}.items():
            self.assertEqual(row[key], value)

    def test_trt_priority_and_binning_must_be_explicit_valid_configuration(self):
        for delta in [{'priority': 99}, {'priority': None}, {'binning': 1}, {'site': 'UNKNOWN'}]:
            with self.subTest(delta=delta), self.assertRaises(InvalidPlan):
                compile_plan(SPEC, target(), dict(TRT, **delta), 'test-uid', NOW)

    def test_priority_mismatch_never_reaches_transport(self):
        client = Client(TRT)
        client.json = Mock(side_effect=AssertionError('Network must not be reached'))
        with patch.dict('os.environ', {'TEST_TRT_ONLY': fake_token(priority=88)}), self.assertRaises(NativeError):
            client.trt('status', external_id='260913ABCD_1')

    def test_invalid_or_expired_credentials_never_reach_transport(self):
        for token in [fake_token(exp=1), fake_token(expire='2026-09-01T00:00:00Z'), 'bad\\_token']:
            client = Client(TRT)
            client.json = Mock(side_effect=AssertionError('Network must not be reached'))
            with self.subTest(token_kind=len(token)), patch.dict('os.environ', {'TEST_TRT_ONLY': token}), self.assertRaises(NativeError):
                client.trt('status', external_id='260913ABCD_1')

    def test_plan_window_cannot_outlive_token_allocation(self):
        client = Client(TRT)
        client.json = Mock(side_effect=AssertionError('Network must not be reached'))
        payload = compile_plan(SPEC, target(), TRT, 'test-uid', NOW)
        payload['script'][0]['EndDate'] = '2027-01-01 00:00:00'
        with patch.dict('os.environ', {'TEST_TRT_ONLY': fake_token()}), self.assertRaises(NativeError):
            client.trt('submit', payload)

    def test_lt_ambiguous_return_fault_and_wrong_root_are_not_accepted(self):
        config = dict(TRT, facility='LT', instrument='IO:O', binning=[1, 1], contact_user='test',
                      endpoint='https://example.invalid', username_env='TEST_LT_USER', password_env='TEST_LT_PASS')
        payload = compile_plan(SPEC, target(), config, 'test-uid', NOW)
        inner = payload['xml'].replace('mode="request"', 'mode="confirm"')
        for kind in ['duplicate', 'fault', 'wrong_root']:
            soap = ET.Element('Envelope')
            ET.SubElement(soap, 'return').text = inner if kind != 'wrong_root' else inner.replace('RTML', 'NotRTML')
            if kind == 'duplicate':
                ET.SubElement(soap, 'return').text = inner
            if kind == 'fault':
                ET.SubElement(soap, 'Fault')
            client = Client(config)
            client.send = Mock(return_value=ET.tostring(soap))
            with self.subTest(kind=kind), patch.dict('os.environ', {'TEST_LT_USER': 'test', 'TEST_LT_PASS': 'test'}), self.assertRaises(NativeError):
                client.lt('submit', payload)
