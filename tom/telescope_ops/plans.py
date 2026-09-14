"""Finite imaging plans; no invented facility/filter mappings or network calls."""
import hashlib
import json
import math
import re
from datetime import datetime, timezone
from xml.etree import ElementTree as ET


class InvalidPlan(ValueError):
    pass


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                    allow_nan=False).encode()).hexdigest()


def number(value, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise InvalidPlan('Numeric value outside supported range')
    return value


def instant(value):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.utcoffset() is None:
            raise ValueError()
        return parsed.astimezone(timezone.utc)
    except (ValueError, TypeError, AttributeError):
        raise InvalidPlan('Time must be timezone-aware ISO 8601') from None


def sexagesimal(degrees, ra=False):
    # Integer ticks carry rounded 60 seconds correctly, including RA wrap at 24h.
    scale = 100000000
    ticks = round(abs(degrees / 15 if ra else degrees) * 3600 * scale)
    if ra:
        ticks %= 24 * 3600 * scale
    whole, rest = divmod(ticks, 3600 * scale)
    minute, second = divmod(rest, 60 * scale)
    sign = '' if ra else ('-' if math.copysign(1, degrees) < 0 else '+')
    return (f'{sign}{whole:02d}', f'{minute:02d}', f'{second / scale:011.8f}')


def compile_plan(spec, target, config, uid, now):
    if not isinstance(spec, dict) or set(spec) != {'epochs'}:
        raise InvalidPlan('Only explicit epochs are accepted; no implicit cadence')
    facility = config.get('facility')
    if facility not in {'LT', 'LCO', 'TRT'}:
        raise InvalidPlan('Facility submission protocol not supported')
    proposal = config.get('proposal')
    if not proposal or not config.get('filter_map'):
        raise InvalidPlan('Administrator must configure proposal and filter mapping')
    ra, dec = float(number(target.ra, 0, 360)), float(number(target.dec, -90, 90))
    if ra == 360 or target.type != 'SIDEREAL':
        raise InvalidPlan('Only registered sidereal targets supported')
    epochs = spec['epochs']
    if not isinstance(epochs, list) or not 1 <= len(epochs) <= 16:
        raise InvalidPlan('Supply 1 to 16 independent epochs')
    normalized = []
    for e in epochs:
        if not isinstance(e, dict) or set(e) != {'start_utc', 'end_utc', 'exposures', 'max_airmass'}:
            raise InvalidPlan('Unknown or missing epoch fields')
        start, end = instant(e['start_utc']), instant(e['end_utc'])
        if start <= now or end <= start or (end-start).total_seconds() > 86400:
            raise InvalidPlan('Window must be future, ordered and at most 24 hours')
        airmass = float(number(e['max_airmass'], 1, 3))
        exposures = e['exposures']
        if not isinstance(exposures, list) or not 1 <= len(exposures) <= 16:
            raise InvalidPlan('Supply 1 to 16 exposure blocks')
        output = []
        for exposure in exposures:
            if not isinstance(exposure, dict) or set(exposure) != {'band', 'count', 'seconds'}:
                raise InvalidPlan('Unknown or missing exposure fields')
            band = exposure['band']
            if not isinstance(band, str) or band not in config['filter_map']:
                raise InvalidPlan('Filter not in administrator capability map (case-sensitive)')
            count = number(exposure['count'], 1, 100)
            if not isinstance(count, int):
                raise InvalidPlan('Exposure count must be an integer')
            output.append({'filter': config['filter_map'][band], 'count': count,
                           'seconds': float(number(exposure['seconds'], 0.1, 3600))})
        if sum(x['count']*x['seconds'] for x in output) > (end-start).total_seconds():
            raise InvalidPlan('Net exposure exceeds window (overheads still require facility validation)')
        if any(start < old['end'] and end > old['start'] for old in normalized):
            raise InvalidPlan('Independent windows must not overlap')
        normalized.append(dict(start=start, end=end, exposures=output, airmass=airmass))
    if facility == 'LCO':
        requests = []
        for e in normalized:
            requests.append({'location': {'telescope_class': config['telescope_class']},
                'windows': [{'start': e['start'].isoformat(), 'end': e['end'].isoformat()}],
                'configurations': [{'type': 'EXPOSE', 'instrument_type': config['instrument'],
                    'target': {'type': 'SIDEREAL', 'name': target.name, 'ra': ra, 'dec': dec},
                    'constraints': {'max_airmass': e['airmass']},
                    'acquisition_config': {}, 'guiding_config': {},
                    'instrument_configs': [{'exposure_time': x['seconds'], 'exposure_count': x['count'],
                        'optical_elements': {'filter': x['filter']}} for x in e['exposures']]}]})
        return {'name': uid, 'proposal': proposal, 'observation_type': 'NORMAL',
                'operator': 'SINGLE' if len(requests) == 1 else 'MANY', 'ipp_value': 1.0, 'requests': requests}
    if facility == 'TRT':
        if type(config.get('priority')) is not int or config['priority'] not in {70, 84, 88}:
            raise InvalidPlan('Configure a distinct TRT priority profile: 70, 84 or 88')
        if config.get('site') not in {'SRO', 'SBO', 'GAO', 'CTO'} or not isinstance(config.get('binning'), str) or not re.fullmatch(r'[1-4],[1-4]', config['binning']):
            raise InvalidPlan('Configure a supported TRT site and binning such as 1,1')
        # One native request per plan: do not risk partially accepted multi-POST batches.
        if len(normalized) != 1:
            raise InvalidPlan('TRT currently requires one independent epoch per plan')
        e = normalized[0]
        return {'script': [{'ObjectName': target.name, 'StationName': config['site'],
            'RA': ':'.join(sexagesimal(ra, ra=True)), 'DEC': ':'.join(sexagesimal(dec)),
            'StartDate': e['start'].strftime('%Y-%m-%d %H:%M:%S'),
            'EndDate': e['end'].strftime('%Y-%m-%d %H:%M:%S'),
            'ExpiryDate': e['end'].strftime('%Y-%m-%d %H:%M:%S'),
            'BinningXY': config['binning'], 'MaxAirmass': format(e['airmass'], 'g'), 'CadenceInterval': '00:00:00',
            'Subframe': '1', 'PA': '', 'Dither': '0', 'ExposuresMode': '1', 'M3Port': '1', 'isQuicklook': '1',
            'Filter': [x['filter'] for x in e['exposures']],
            'Exposure': [str(int(x['seconds'])) if x['seconds'].is_integer() else str(x['seconds']) for x in e['exposures']],
            'Repeat': [str(x['count']) for x in e['exposures']],
            'Suffix': [f'{uid}-{i}' for i, _ in enumerate(e['exposures'])]}]}
    ns = 'http://www.rtml.org/v3.1a'
    def child(parent, tag, text=None, **attrs):
        element = ET.SubElement(parent, '{'+ns+'}'+tag, attrs)
        element.text = text
        return element
    root = ET.Element('{'+ns+'}RTML', version='3.1a', mode='request', uid=uid)
    contact = child(child(root, 'Project', ProjectID=proposal), 'Contact')
    child(contact, 'Username', config['contact_user'])
    for e in normalized:
        for x in e['exposures']:
            schedule = child(root, 'Schedule')
            device = child(schedule, 'Device', name=config['instrument'], type='camera')
            child(device, 'SpectralRegion', 'optical')
            setup = child(device, 'Setup')
            child(setup, 'Filter', type=x['filter'])
            binning = child(child(setup, 'Detector'), 'Binning')
            for axis, value in zip(('X', 'Y'), config['binning']):
                child(binning, axis, str(value), units='pixels')
            child(child(schedule, 'Exposure', count=str(x['count'])), 'Value', str(x['seconds']), units='seconds')
            coords = child(child(schedule, 'Target', name=target.name), 'Coordinates')
            for tag, values, labels in [('RightAscension', sexagesimal(ra, ra=True), ('Hours', 'Minutes', 'Seconds')),
                                        ('Declination', sexagesimal(dec), ('Degrees', 'Arcminutes', 'Arcseconds'))]:
                coord = child(coords, tag)
                for label, value in zip(labels, values):
                    child(coord, label, value)
            child(coords, 'Equinox', 'None')
            child(schedule, 'AirmassConstraint', maximum=str(e['airmass']))
            timing = child(schedule, 'DateTimeConstraint', type='include')
            child(timing, 'DateTimeStart', system='UT', value=e['start'].isoformat())
            child(timing, 'DateTimeEnd', system='UT', value=e['end'].isoformat())
    return {'xml': ET.tostring(root, encoding='unicode')}
