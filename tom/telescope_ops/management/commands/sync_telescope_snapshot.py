import json
from pathlib import Path
import re
import subprocess
import tempfile

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from telescope_ops.snapshots import publish
from telescope_data.vendor.snapshot_reader import SnapshotReader


class Command(BaseCommand):
    help = 'Copy a configured report/assets source and atomically publish it; no photometry/submission'

    def handle(self, *args, **options):
        config = getattr(settings, 'TELESCOPE_REPORT_SYNC', {})
        if not config.get('enabled'):
            raise CommandError('Report sync disabled')
        destination = Path(config['destination']).resolve()
        for name in ['STATIC_ROOT', 'MEDIA_ROOT']:
            public = Path(getattr(settings, name)).resolve()
            if destination == public or public in destination.parents:
                raise CommandError('Report store must not be a public directory')
        source = config.get('source')
        if config.get('mode') == 'local':
            result = publish(source, destination)
        elif config.get('mode') == 'ssh':
            alias, directory, name = config.get('ssh_alias', ''), source, config.get('report_name', '')
            if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', alias) or not re.fullmatch(r'/[A-Za-z0-9_./-]+', directory or '') or '..' in directory.split('/') or not re.fullmatch(r'[A-Za-z0-9_-]+\.(html|json)', name):
                raise CommandError('Configure a safe SSH alias, absolute report directory and report filename')
            with tempfile.TemporaryDirectory(prefix='snclock-report-') as stage:
                # Fetch the report first, then only its explicitly referenced raster assets.
                command = ['rsync', '-rt', '--safe-links', '--protect-args', '--max-size=128m',
                    '-e', 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10',
                    '--from0', '--files-from=-', '--',
                    alias+':'+directory.rstrip('/')+'/', stage+'/']
                completed = subprocess.run(command, input=(name+'\0').encode(), timeout=60, capture_output=True)
                if completed.returncode:
                    raise CommandError('Report transfer failed; active report unchanged')
                reader = SnapshotReader(Path(stage)/name)
                assets = set()
                for row in reader.qa():
                    if row.get('path_error') not in {None, 'missing_src'}:
                        raise CommandError('Unsafe report asset; active report unchanged')
                    if row.get('src'):
                        if Path(row['src']).suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp'}:
                            raise CommandError('Only raster QA assets may be synced')
                        assets.add(row['src'])
                if len(assets) > 256:
                    raise CommandError('Report exceeds 256-asset transfer bound')
                if assets:
                    command[4] = '--max-size=32m'
                    completed = subprocess.run(command, input=('\0'.join(sorted(assets))+'\0').encode(),
                                               timeout=300, capture_output=True)
                    if completed.returncode:
                        raise CommandError('Asset transfer failed; active report unchanged')
                result = publish(Path(stage)/name, destination)
        else:
            raise CommandError('Sync mode must be local or ssh')
        self.stdout.write(json.dumps(result))
