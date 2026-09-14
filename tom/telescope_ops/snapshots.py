"""Publish one report and exactly its referenced raster assets as an immutable version."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import uuid

from telescope_data.vendor.snapshot_reader import SnapshotReader


def publish(report, destination):
    report = Path(report)
    if report.is_symlink() or not report.is_file():
        raise ValueError('Use an immutable regular source report')
    root = Path(destination).resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = root / '.publish.lock'
    descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    stage = Path(tempfile.mkdtemp(prefix='.stage-', dir=root))
    try:
        reader = SnapshotReader(report)
        manifest = {'report': reader.sha256, 'assets': {}}
        for row in reader.qa():
            if row.get('path_error') not in {None, 'missing_src'}:
                raise ValueError('Unsafe report asset')
            if not row.get('src'):
                continue
            name, exists, issue = reader.safe_asset(row['src'])
            if issue:
                raise ValueError('Unsafe report asset')
            if not exists:
                continue  # retain the report's missing-asset indication
            source = report.parent / name
            if any(p.is_symlink() for p in [source, *source.parents] if p != report.parent.parent):
                raise ValueError('Symlink source assets are not accepted')
            if source.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp'} or source.stat().st_size > 32*1024*1024:
                raise ValueError('Unsupported or oversized QA image')
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            manifest['assets'][name] = hashlib.sha256(target.read_bytes()).hexdigest()
            if hashlib.sha256(source.read_bytes()).hexdigest() != manifest['assets'][name]:
                raise ValueError('Source assets changed during copying')
        if hashlib.sha256(report.read_bytes()).hexdigest() != reader.sha256:
            raise ValueError('Source report changed during copying')
        # Normalize both input formats; asset content participates in reader/API identity.
        data = dict(reader.data, _snclock_asset_sha256=manifest['assets'])
        (stage / 'report.json').write_text(json.dumps(data, sort_keys=True, allow_nan=False), encoding='utf-8')
        version = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
        (stage / 'manifest.json').write_text(json.dumps(manifest, sort_keys=True), encoding='utf-8')
        final = root / version
        if not final.exists():
            os.replace(stage, final)
        link = root / ('.next-' + uuid.uuid4().hex)
        try:
            link.symlink_to(final.name, target_is_directory=True)
            os.replace(link, root / 'current')
        finally:
            if link.is_symlink():
                link.unlink()
        return {'version': version, 'report_sha256': reader.sha256, 'asset_count': len(manifest['assets']),
                'path': str(root / 'current' / 'report.json')}
    finally:
        if stage.exists() and stage.parent == root and stage.name.startswith('.stage-'):
            shutil.rmtree(stage)
        os.close(descriptor)
        lock.unlink()
