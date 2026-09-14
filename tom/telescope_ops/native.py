"""Native transport. No retries, redirected credentials or implicit submissions."""
import json
import os
import base64
import math
import re
from urllib.parse import urlsplit, quote
from xml.etree import ElementTree as ET

import requests
from django.utils import timezone
from .plans import instant


class NativeError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def https_origin(url):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise NativeError('invalid_endpoint')
    return parsed.scheme + '://' + parsed.netloc


def check_trt_claims(token, priority, payload=None):
    """Local consistency gate only. JWT signature/authorization belong to TRT."""
    try:
        if type(priority) is not int or priority not in {70, 84, 88} or not re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', token):
            raise ValueError()
        segment = token.split('.')[1]
        claims = json.loads(base64.b64decode(segment+'='*(-len(segment)%4), altchars=b'-_', validate=True))
        if not isinstance(claims, dict) or type(claims.get('priority')) is not int or claims['priority'] != priority:
            raise ValueError()
        start, end = instant(claims['startDate']), instant(claims['expireDate'])
        exp = claims['exp']
        now = timezone.now()
        if type(exp) not in {int, float} or not math.isfinite(exp) or now.timestamp() >= exp or not start <= now < end:
            raise ValueError()
        if payload is not None:
            rows = payload['script']
            if not isinstance(rows, list) or not rows:
                raise ValueError()
            for row in rows:
                left, right = instant(row['StartDate']+'Z'), instant(row['EndDate']+'Z')
                expiry = instant(row['ExpiryDate']+'Z')
                if not start <= left < right <= expiry <= end or expiry.timestamp() > exp:
                    raise ValueError()
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
        raise NativeError('trt_credential_priority_or_window_invalid') from None


class Client:
    def __init__(self, config, session=None):
        self.config = config
        self.facility = config['facility']
        self.session = session or requests.Session()
        if not config.get('enabled'):
            raise NativeError('facility_disabled')

    def secret(self, key):
        value = os.environ.get(self.config.get(key, ''), '')
        if not value:
            raise NativeError('credentials_missing')
        return value

    def send(self, method, url, *, headers=None, data=None, body=None):
        https_origin(url)
        try:
            response = self.session.request(method, url, headers=headers, data=data, json=body,
                                            timeout=(5, 30), allow_redirects=False, stream=True)
            with response:
                if not 200 <= response.status_code < 300:
                    # Even 4xx/5xx is not automatically proof a mutation did not take place.
                    raise NativeError('upstream_http_' + str(response.status_code))
                raw = bytearray()
                for chunk in response.iter_content(65536):
                    raw.extend(chunk)
                    if len(raw) > 4*1024*1024:
                        raise NativeError('response_too_large')
                return bytes(raw)
        except requests.RequestException:
            raise NativeError('transport_unknown') from None

    def json(self, method, url, **kwargs):
        try:
            return json.loads(self.send(method, url, **kwargs))
        except (ValueError, UnicodeError):
            raise NativeError('invalid_response') from None

    def lco(self, operation, payload=None, external_id=None):
        base = 'https://observe.lco.global/api/requestgroups/'
        headers = {'Authorization': 'Token ' + self.secret('token_env')}
        if operation == 'validate':
            return self.json('POST', base+'validate/', headers=headers, body=payload)
        if operation == 'submit':
            return self.json('POST', base, headers=headers, body=payload)
        identifier = quote(str(external_id), safe='')
        if not identifier.isdigit():
            raise NativeError('invalid_external_id')
        if operation == 'cancel':
            self.send('POST', base+identifier+'/cancel/', headers=headers)
        return self.json('GET', base+identifier+'/', headers=headers)

    def trt(self, operation, payload=None, external_id=None):
        commands = {'submit': 'newobservation', 'status': 'checkobservation',
                    'cancel': 'cancelobservation', 'files': 'getfilepath'}
        if operation not in commands:
            raise NativeError('remote_validation_not_supported')
        token = self.secret('token_env')
        check_trt_claims(token, self.config.get('priority'), payload if operation == 'submit' else None)
        body = payload if operation == 'submit' else {'obs_id': external_id if operation == 'files' else [external_id]}
        return self.json('POST', 'https://trt.narit.or.th/hub/api/'+commands[operation],
                         headers={'TRT': token}, body=body)

    def lt(self, operation, payload, external_id=None):
        if operation not in {'submit', 'status', 'cancel'}:
            raise NativeError('remote_validation_not_supported')
        xml = payload['xml']
        if '<!DOCTYPE' in xml.upper() or '<!ENTITY' in xml.upper():
            raise NativeError('invalid_xml')
        root = ET.fromstring(xml)
        ns = '{http://www.rtml.org/v3.1a}'
        if root.tag != ns+'RTML' or not root.get('uid') or len(root.findall(ns+'Project')) != 1:
            raise NativeError('invalid_rtml_identity')
        if root.find(ns+'Project').get('ProjectID') != self.config['proposal']:
            raise NativeError('proposal_mismatch')
        root.set('mode', {'submit': 'request', 'status': 'update', 'cancel': 'abort'}[operation])
        if external_id and root.get('uid') != external_id:
            raise NativeError('uid_mismatch')
        envelope = ET.Element('{http://schemas.xmlsoap.org/soap/envelope/}Envelope')
        body = ET.SubElement(envelope, '{http://schemas.xmlsoap.org/soap/envelope/}Body')
        call = ET.SubElement(body, '{http://node_agent2.estar.org/}handle_rtml')
        ET.SubElement(call, 'arg0').text = ET.tostring(root, encoding='unicode')
        raw = self.send('POST', self.config['endpoint'],
            headers={'Username': self.secret('username_env'), 'Password': self.secret('password_env'),
                     'SOAPAction': '""', 'Content-Type': 'text/xml; charset=utf-8'},
            data=ET.tostring(envelope, encoding='utf-8'))
        if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
            raise NativeError('invalid_xml')
        try:
            soap = ET.fromstring(raw)
            returns = [e for e in soap.iter() if e.tag.split('}')[-1] == 'return']
            if len(returns) != 1 or any(e.tag.split('}')[-1] == 'Fault' for e in soap.iter()):
                raise ValueError()
            inner = returns[0].text
            if not inner or '<!DOCTYPE' in inner.upper() or '<!ENTITY' in inner.upper():
                raise ValueError()
            result = ET.fromstring(inner)
            if result.tag != ns+'RTML' or len(result.findall(ns+'Project')) != 1:
                raise ValueError()
            project = result.find(ns+'Project').get('ProjectID')
            if result.get('uid') != root.get('uid') or project != self.config['proposal']:
                raise NativeError('receipt_identity_mismatch')
            def shape(e):
                return (e.tag, (e.text or '').strip(), sorted(e.attrib.items()), [shape(c) for c in e])
            wanted = [shape(e) for e in root if e.tag.split('}')[-1] == 'Schedule']
            received = [shape(e) for e in result if e.tag.split('}')[-1] == 'Schedule']
            history = [' '.join(e.itertext()) for e in result.iter() if e.tag.split('}')[-1] == 'History']
            return {'mode': result.get('mode'), 'uid': result.get('uid'), 'proposal': project,
                    'schedule_match': bool(wanted) and wanted == received,
                    'cancel_confirmed': result.get('mode') == 'confirm' and any('Document aborted.' in h for h in history)}
        except (ET.ParseError, StopIteration, ValueError):
            raise NativeError('invalid_xml_response') from None

    def execute(self, operation, plan):
        if self.facility == 'LCO':
            return self.lco(operation, plan.payload, plan.external_id)
        if self.facility == 'TRT':
            return self.trt(operation, plan.payload, plan.external_id)
        if self.facility == 'LT':
            return self.lt(operation, plan.payload, plan.external_id)
        raise NativeError('facility_not_supported')

    def frames(self, request_ids):
        if self.facility != 'LCO':
            raise NativeError('frame_listing_not_supported')
        if not isinstance(request_ids, list) or not request_ids:
            raise NativeError('confirmed_request_ids_required')
        headers = {'Authorization': 'Token ' + self.secret('archive_token_env')}
        items = []
        for request_id in request_ids:
            if not str(request_id).isdigit():
                raise NativeError('invalid_request_id')
            url = f'https://archive-api.lco.global/frames/?request_id={request_id}&reduction_level=91&limit=1000'
            seen = set()
            while url:
                parsed = urlsplit(url)
                if https_origin(url) != 'https://archive-api.lco.global' or parsed.path != '/frames/' or url in seen or len(seen) >= 100:
                    raise NativeError('invalid_pagination')
                seen.add(url)
                page = self.json('GET', url, headers=headers)
                if not isinstance(page, dict) or not isinstance(page.get('results'), list):
                    raise NativeError('invalid_frame_list')
                for item in page['results']:
                    if not isinstance(item, dict) or str(item.get('request_id')) != str(request_id):
                        raise NativeError('frame_request_mismatch')
                    items.append(item)
                url = page.get('next')
        return items


def public_receipt(raw):
    """Do not persist arbitrary upstream text/URLs that may echo a token."""
    allowed = {'id', 'state', 'mode', 'requests', 'errors', 'schedule_match', 'cancel_confirmed'}
    states = {'PENDING', 'WINDOW_EXPIRED', 'COMPLETED', 'CANCELED', 'unknown'}
    if not isinstance(raw, dict):
        return {'shape': type(raw).__name__}
    result = {}
    for key in allowed & raw.keys():
        if key == 'requests' and isinstance(raw[key], list):
            result[key] = [{'id': r['id'], 'state': r.get('state') if r.get('state') in states else 'unknown'}
                           for r in raw[key] if isinstance(r, dict) and type(r.get('id')) is int]
        elif key == 'errors':
            result['has_errors'] = bool(raw[key])
        elif key == 'id' and type(raw[key]) is int:
            result[key] = raw[key]
        elif key == 'state' and isinstance(raw[key], str) and raw[key] in states:
            result[key] = raw[key]
        elif key == 'mode' and raw[key] in ['confirm', 'reject', 'update', 'abort']:
            result[key] = raw[key]
        elif key in {'schedule_match', 'cancel_confirmed'} and type(raw[key]) is bool:
            result[key] = raw[key]
    return result
