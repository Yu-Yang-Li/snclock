from django.core.management.base import BaseCommand
from telescope_ops.models import Job
from telescope_ops.service import recover_stale, run_job


class Command(BaseCommand):
    help = 'Run a bounded batch of queued telescope operations; no implicit retry'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=10)
        parser.add_argument('--recover-stale', action='store_true')

    def handle(self, *args, **options):
        if options['recover_stale']:
            self.stdout.write(f"Recovered stale jobs without retry: {recover_stale()}")
        for pk in list(Job.objects.filter(state='queued').order_by('created_at').values_list('pk', flat=True)[:max(0, min(options['limit'], 100))]):
            run_job(pk)
