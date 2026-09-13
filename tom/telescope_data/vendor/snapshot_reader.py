#!/usr/bin/env python3
"""Read existing SN dashboard snapshots. No network, subprocess, or file writes."""
from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
import math
from pathlib import Path, PurePosixPath
import re
from typing import Any
from urllib.parse import unquote


VERSION = '0.1.0'
CORE = {'LT', 'REM', 'LCO', 'TRT'}


class SnapshotError(ValueError):
    pass


class DataScript(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.active = False
        self.matches = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script' and attrs.get('id') == 'sn-data':
            if attrs.get('type') != 'application/json':
                raise SnapshotError('sn-data must have application/json type')
            self.active = True
            self.matches += 1

    def handle_data(self, data):
        if self.active:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if tag == 'script':
            self.active = False


def canonical(value):
    text = re.sub(r'\s+', '', str(value or '')).lower()
    return re.sub(r'^(?:sn|at)(?=\d{4})', '', text)


def telescope_name(value):
    text = str(value or '').strip()
    upper = text.upper()
    if upper in {'REMIR', 'ROSS', 'ROSS2'}:
        return 'REM'
    for name in CORE:
        if upper == name or upper.startswith(name + ' '):
            return name
    return text


def strict_json(value):
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {k: strict_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [strict_json(v) for v in value]
    return value


def content_id(prefix, value):
    encoded = json.dumps(strict_json(value), sort_keys=True, ensure_ascii=False, separators=(',', ':'))
    return prefix + hashlib.sha256(encoded.encode()).hexdigest()[:24]


def date_only(value):
    text = str(value or '')
    if re.fullmatch(r'\d{8}', text):
        return text[:4] + '-' + text[4:6] + '-' + text[6:8]
    if not re.match(r'^\d{4}-\d{2}-\d{2}', text):
        return ''
    try:
        timestamp = datetime.fromisoformat(text.replace('Z', '+00:00'))
        if timestamp.tzinfo is not None:
            return timestamp.astimezone(timezone.utc).date().isoformat()
    except ValueError:
        return ''
    # Legacy report photometry dates are already UTC; daily dates are date-only.
    return text[:10]


def numeric_coordinate(value, lower, upper, upper_inclusive=True):
    try:
        number = float(value)
        if math.isfinite(number) and lower <= number and (number <= upper if upper_inclusive else number < upper):
            return number
    except (TypeError, ValueError):
        pass
    return None


class SnapshotReader:
    def __init__(self, report):
        self.report = Path(report).resolve()
        if self.report.stat().st_size > 128 * 1024 * 1024:
            raise SnapshotError('Snapshot exceeds 128 MiB reader limit')
        raw = self.report.read_bytes()
        self.sha256 = hashlib.sha256(raw).hexdigest()
        text = raw.decode('utf-8-sig')
        if self.report.suffix.lower() != '.json':
            parser = DataScript()
            parser.feed(text)
            parser.close()
            if parser.matches != 1 or parser.active:
                raise SnapshotError('Expected exactly one complete sn-data JSON script')
            text = ''.join(parser.parts)
        self.data = strict_json(json.loads(text))
        if not isinstance(self.data, dict) or not isinstance(self.data.get('sources'), list):
            raise SnapshotError('Expected sources list')
        if not isinstance(self.data.get('sourceData'), dict):
            raise SnapshotError('Expected sourceData object')
        self.aliases = {}
        self.sources = {}
        for source in self.data['sources']:
            if not isinstance(source, dict) or not source.get('name'):
                raise SnapshotError('Invalid source entry')
            key = canonical(source['name'])
            if key in self.sources:
                raise SnapshotError('Duplicate canonical target: ' + key)
            self.sources[key] = source
            for alias in [source['name'], *source.get('aliases', [])]:
                label = canonical(alias)
                if label in self.aliases and self.aliases[label] != key:
                    raise SnapshotError('Ambiguous alias: ' + label)
                self.aliases[label] = key

    def resolve_target(self, target):
        if target is None:
            return None
        key = self.aliases.get(canonical(target))
        if key is None:
            raise SnapshotError('Unknown target: ' + str(target))
        return key

    def envelope(self):
        return {
            'schema_version': VERSION,
            'generated_at': self.data.get('generatedAt'),
            'snapshot_sha256': self.sha256,
            'freshness': 'snapshot_only',
        }

    def targets(self):
        lifecycle = self.data.get('targetLifecycle', {})
        return [
            {**row, 'target_id': key, 'lifecycle': lifecycle.get(key),
             'ra_deg': numeric_coordinate(row.get('ra'), 0, 360, False),
             'dec_deg': numeric_coordinate(row.get('dec'), -90, 90),
             'status': lifecycle.get(key, {}).get('status', row.get('status', 'unknown'))}
            for key, row in self.sources.items()
        ]

    def photometry(self):
        rows = []
        for name, entry in self.data['sourceData'].items():
            key = canonical(name)
            if key not in self.sources:
                continue
            for row in entry.get('photometry', []):
                rows.append({**row, 'target_id': key, 'telescope': telescope_name(row.get('tel')),
                             'point_id': content_id('point-', [key, row])})
        return rows

    def safe_asset(self, src):
        if not isinstance(src, str) or not src:
            return None, False, 'missing_src'
        decoded = src
        for _ in range(5):
            changed = unquote(decoded)
            if changed == decoded:
                break
            decoded = changed
        path = PurePosixPath(decoded)
        if (not path.parts or path.parts[0] != 'assets' or path.is_absolute()
                or '..' in path.parts or '\\' in decoded or '\x00' in decoded
                or '?' in decoded or '#' in decoded or ':' in decoded):
            return None, False, 'unsafe_asset_path'
        full = (self.report.parent / str(path)).resolve()
        try:
            full.relative_to((self.report.parent / 'assets').resolve())
            full.relative_to(self.report.parent)
        except ValueError:
            return None, False, 'asset_path_escape'
        return str(path), full.is_file(), None

    def qa(self):
        rows = []
        for name, entry in self.data['sourceData'].items():
            key = canonical(name)
            if key not in self.sources:
                continue
            for group in entry.get('remMedia', []):
                for item in group.get('items', []):
                    src, exists, error = self.safe_asset(item.get('src'))
                    rows.append({
                        'asset_id': content_id('asset-', [key, group.get('date'), group.get('band'), item]),
                        'target_id': key,
                        'telescope': telescope_name(group.get('telescope')),
                        'instrument': group.get('instrument'), 'band': group.get('band'),
                        'date': date_only(group.get('date')), 'archive_date_label': group.get('date'),
                        'raw_count': group.get('rawCount'), 'stage': item.get('stage'),
                        'label': item.get('label'), 'caption': item.get('caption'), 'src': src,
                        'report_declared_available': item.get('available'), 'file_exists': exists,
                        'path_error': error,
                    })
        return rows

    def requests(self):
        rows = []
        monitor = self.data.get('submissionMonitor', {})
        for name, entry in monitor.get('targets', {}).items():
            key = canonical(name)
            for row in entry.get('submissions', []):
                warnings = []
                facility = row.get('group_state')
                reported = row.get('status')
                if facility in {'PENDING', 'WINDOW_EXPIRED', 'CANCELED', 'FAILURE'} and reported == 'processed':
                    warnings.append('reported_processed_conflicts_with_facility_status')
                if row.get('raw_files') == 0 and reported == 'processed':
                    warnings.append('reported_processed_without_files_for_this_request')
                # Keep the native report record; no inferred execution or QA state.
                rows.append({**row, 'target_id': key,
                             'telescope': telescope_name(row.get('telescope')),
                             'reported_status': reported, 'facility_status': facility,
                             'consistency_warnings': warnings,
                             'state_evidence': 'dashboard_snapshot_not_live_facility',
                             'monitor_generated_at': monitor.get('generated_at')})
        return rows

    def daily(self):
        rows = []
        for day in self.data.get('dailyHistory', []):
            for row in day.get('entries', []):
                rows.append({**row, 'target_id': canonical(row.get('target')),
                             'telescope': telescope_name(row.get('telescope')),
                             'date': day.get('date'), 'report_timezone': 'Asia/Shanghai',
                             'day_generated_at': day.get('generated_at')})
        return rows

    def read(self, kind, *, target=None, telescope=None, band=None, date_from=None,
             date_to=None, limit=100, offset=0):
        if kind == 'summary':
            points = self.photometry()
            counts = {}
            for row in points:
                counts[row['telescope']] = counts.get(row['telescope'], 0) + 1
            return {**self.envelope(), 'target_count': len(self.sources),
                    'photometry_count': len(points), 'photometry_by_telescope': counts,
                    'readable_sections': ['targets', 'photometry', 'qa', 'requests', 'daily'],
                    'requests_complete': False,
                    'warnings': ['Snapshot may omit unregistered facility requests and raw/rejected measurements.']}
        if kind not in {'targets', 'photometry', 'qa', 'requests', 'daily'}:
            raise SnapshotError('Unknown section')
        if not 1 <= limit <= 10000 or offset < 0:
            raise SnapshotError('limit must be 1..10000 and offset >= 0')
        key = self.resolve_target(target)
        for value in (date_from, date_to):
            if value:
                date.fromisoformat(value)
        if date_from and date_to and date_from > date_to:
            raise SnapshotError('date_from must be <= date_to')
        if kind == 'targets' and any((telescope, band, date_from, date_to)):
            raise SnapshotError('targets supports only target and pagination filters')
        if kind in {'requests', 'daily'} and band:
            raise SnapshotError('band filter is supported only for photometry/qa')
        selected = []
        for row in getattr(self, kind)():
            if key and row['target_id'] != key:
                continue
            if telescope and row.get('telescope') != telescope_name(telescope):
                continue
            if band and row.get('band') != band:
                continue
            row_date = date_only(row.get('submitted_at') if kind == 'requests' else row.get('date'))
            if (date_from or date_to) and not row_date:
                continue
            if date_from and row_date < date_from:
                continue
            if date_to and row_date > date_to:
                continue
            selected.append(row)
        page = selected[offset:offset + limit]
        return {**self.envelope(), 'section': kind, 'items': page, 'count': len(page),
                'total': len(selected), 'limit': limit, 'offset': offset,
                'next_offset': offset + limit if offset + limit < len(selected) else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', required=True, type=Path)
    sub = parser.add_subparsers(dest='kind', required=True)
    sub.add_parser('summary')
    for kind in ('targets', 'photometry', 'qa', 'requests', 'daily'):
        command = sub.add_parser(kind)
        command.add_argument('--target')
        if kind != 'targets':
            command.add_argument('--telescope')
            command.add_argument('--date-from')
            command.add_argument('--date-to')
        if kind in {'photometry', 'qa'}:
            command.add_argument('--band')
        command.add_argument('--limit', type=int, default=100)
        command.add_argument('--offset', type=int, default=0)
    args = vars(parser.parse_args())
    report, kind = args.pop('report'), args.pop('kind')
    try:
        result = SnapshotReader(report).read(kind, **args)
        print(json.dumps(strict_json(result), ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (SnapshotError, OSError, ValueError) as exc:
        print(json.dumps({'error': {'code': 'snapshot_read_error', 'message': str(exc)}}, ensure_ascii=False))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
