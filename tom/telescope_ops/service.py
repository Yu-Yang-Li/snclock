import uuid
import re
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import PermissionDenied
from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import Event, Job, Plan
from .native import Client, NativeError, public_receipt
from .plans import InvalidPlan, compile_plan, digest, instant


def profile_for(name):
    if not getattr(settings, 'TELESCOPE_OPERATIONS_ENABLED', False):
        raise InvalidPlan('Telescope operations disabled')
    config = getattr(settings, 'TELESCOPE_PROFILES', {}).get(name)
    if not isinstance(config, dict) or not config:
        raise InvalidPlan('Facility profile not configured')
    return config


def authorize(user, target, config):
    if not user.is_authenticated or not user.is_active:
        raise PermissionDenied()
    if user.is_superuser:
        return
    group = config.get('group')
    if not group or not user.groups.filter(name=group).exists() or not user.has_perm('tom_targets.change_target', target):
        raise PermissionDenied('Explicit proposal group and target permission required')


def event(plan, actor, action, **details):
    Event.objects.create(plan=plan, actor=actor, action=action, details=details)


def available_actions(config):
    if not config.get('enabled'):
        return set()
    actions = {'LCO': {'validate_remote', 'status', 'files'}, 'LT': {'status'},
               'TRT': {'status', 'files'}}.get(config.get('facility'), set()).copy()
    if actions and config.get('live_writes') and config.get('protocol_verified'):
        actions.add('submit')
        if config.get('facility') in {'LT', 'LCO'}:
            actions.add('cancel')
    return actions


def plan_digest(target, profile, config, specification):
    payload = compile_plan(specification, target, config, 'plan-identity', timezone.now())
    return digest({'target_id': target.pk, 'profile': profile, 'config': config, 'payload': payload})


def create_plan(user, target, profile, specification):
    config = profile_for(profile)
    authorize(user, target, config)
    uid = uuid.uuid4()
    payload = compile_plan(specification, target, config, str(uid), timezone.now())
    # Exclude random native UID so two equivalent drafts cannot both be submitted.
    sha = plan_digest(target, profile, config, specification)
    try:
        with transaction.atomic():
            plan = Plan.objects.create(id=uid, target=target, owner=user, profile=profile,
                specification=specification, payload=payload, sha256=sha, config_sha256=digest(config),
                expires_at=min(instant(e['start_utc']) for e in specification['epochs']))
            event(plan, user, 'draft_created', sha256=sha)
    except IntegrityError:
        raise InvalidPlan('Equivalent plan already exists; do not duplicate the observation') from None
    return plan


def current(plan):
    config = profile_for(plan.profile)
    if digest(config) != plan.config_sha256 or plan.expires_at <= timezone.now():
        raise InvalidPlan('Plan expired or facility configuration changed; create a fresh draft')
    # Coordinates may be corrected after drafting; an approval cannot silently follow them.
    expected = plan_digest(plan.target, plan.profile, config, plan.specification)
    if expected != plan.sha256:
        raise InvalidPlan('Target changed since draft')
    return config


def validate_local(user, plan):
    config = current(plan)
    authorize(user, plan.target, config)
    # Recompile with original UID; this is validation, not a remote draft creation.
    payload = compile_plan(plan.specification, plan.target, config, str(plan.id), timezone.now())
    if digest(payload) != digest(plan.payload):
        raise InvalidPlan('Stored payload does not match immutable draft')
    plan.validated_at = timezone.now()
    plan.approved_at = None
    plan.approved_by = None
    plan.save(update_fields=['validated_at', 'approved_at', 'approved_by'])
    event(plan, user, 'local_validated', sha256=plan.sha256)


def approve(user, plan, sha256):
    config = current(plan)
    authorize(user, plan.target, config)
    if not user.has_perm('telescope_ops.approve_plan'):
        raise PermissionDenied()
    if not plan.validated_at or sha256 != plan.sha256:
        raise InvalidPlan('Validate first and approve the exact payload hash')
    if plan.jobs.filter(action='submit').exists():
        raise InvalidPlan('A send intent already exists')
    plan.approved_by = user
    plan.approved_at = timezone.now()
    plan.save(update_fields=['approved_by', 'approved_at'])
    event(plan, user, 'approved', sha256=sha256)


def enqueue(user, plan, action, key, sha256):
    if action not in {'submit', 'cancel', 'status', 'validate_remote', 'files'}:
        raise InvalidPlan('Unknown action')
    config = profile_for(plan.profile)
    authorize(user, plan.target, config)
    if action not in available_actions(config):
        raise InvalidPlan('Operation unavailable for this facility configuration')
    if not isinstance(key, str) or not 8 <= len(key) <= 100 or sha256 != plan.sha256:
        raise InvalidPlan('Idempotency key and exact plan hash required')
    existing = Job.objects.filter(idempotency_key=key).first()
    if existing:
        if existing.plan_id != plan.id or existing.action != action or existing.actor_id != user.pk:
            raise InvalidPlan('Idempotency key conflicts with another operation')
        return existing
    if action in {'submit', 'validate_remote'}:
        current(plan)
    if action == 'submit':
        if not plan.approved_at or not plan.approved_by or timezone.now()-plan.approved_at > timedelta(minutes=30):
            raise InvalidPlan('Unexpired server approval required')
        require_preflight(plan, config)
    if action in {'submit', 'cancel'}:
        if not config.get('live_writes') or not config.get('protocol_verified'):
            raise InvalidPlan('Live writes disabled until protocol and proposal verification')
        if not user.has_perm('telescope_ops.approve_plan'):
            raise PermissionDenied()
    if action in {'cancel', 'status', 'files'} and not plan.external_id:
        raise InvalidPlan('No confirmed external request ID; reconcile unknown submissions manually')
    if not config.get('enabled'):
        raise InvalidPlan('Facility transport disabled')
    try:
        with transaction.atomic():
            job = Job.objects.create(plan=plan, actor=user, action=action, idempotency_key=key)
            event(plan, user, 'queued', job_id=str(job.id), operation=action)
    except IntegrityError:
        raise InvalidPlan('Write already queued/sent, including unknown outcomes; never resend blindly') from None
    return job


def require_preflight(plan, config):
    if config['facility'] == 'LCO' and not plan.jobs.filter(action='validate_remote', state='succeeded',
            finished_at__gte=timezone.now()-timedelta(minutes=30)).exists():
        raise InvalidPlan('Successful recent LCO preflight required')


def registration_record(plan, config):
    # Freeze the accepted identity, not a later renamed target or changed profile.
    record = {'schema_version': 1, 'state': 'pending', 'plan_id': str(plan.id),
        'idempotency_key': 'registration:'+str(plan.id), 'facility': config['facility'],
        'proposal': config['proposal'], 'priority': config.get('priority'),
        'target': {'id': plan.target_id, 'name': plan.target.name,
                   'ra_deg': plan.target.ra, 'dec_deg': plan.target.dec},
        'external_id': plan.external_id, 'request_ids': plan.request_ids,
        'request_group_id': plan.external_id if config['facility'] == 'LCO' else None,
        'rtml_uid': plan.external_id if config['facility'] == 'LT' else None,
        'obs_id': plan.external_id if config['facility'] == 'TRT' else None,
        'plan_sha256': plan.sha256, 'native_payload_sha256': digest(plan.payload),
        'specification': plan.specification, 'native_payload': plan.payload}
    record['record_sha256'] = digest(record)
    return record


def run_job(job_id, client_factory=Client):
    # CAS works on SQLite too; no long transaction across the network.
    if not Job.objects.filter(pk=job_id, state='queued').update(state='running', started_at=timezone.now()):
        return False
    job = Job.objects.select_related('plan__target', 'actor', 'plan__approved_by').get(pk=job_id)
    plan = job.plan
    sent = False
    try:
        config = profile_for(plan.profile)
        authorize(job.actor, plan.target, config)
        if job.action not in available_actions(config):
            raise NativeError('operation_disabled')
        if job.action in {'submit', 'validate_remote'}:
            current(plan)
        if job.action in {'submit', 'cancel'}:
            if not config.get('live_writes') or not config.get('protocol_verified') or digest(config) != plan.config_sha256:
                raise NativeError('writes_disabled_or_config_changed')
            if not job.actor.has_perm('telescope_ops.approve_plan'):
                raise PermissionDenied()
        if job.action == 'submit':
            require_preflight(plan, config)
            if not plan.approved_at or timezone.now()-plan.approved_at > timedelta(minutes=30):
                raise NativeError('approval_expired')
            authorize(plan.approved_by, plan.target, config)
            if not plan.approved_by.has_perm('telescope_ops.approve_plan'):
                raise PermissionDenied()
            if digest(compile_plan(plan.specification, plan.target, config, str(plan.id), timezone.now())) != digest(plan.payload):
                raise NativeError('payload_changed')
        if job.action == 'validate_remote':
            if digest(compile_plan(plan.specification, plan.target, config, str(plan.id), timezone.now())) != digest(plan.payload):
                raise NativeError('payload_changed')
        client = client_factory(config)
        event(plan, job.actor, 'send_intent', job_id=str(job.id), operation=job.action, sha256=plan.sha256)
        sent = True
        if job.action == 'files':
            raw = client.frames(plan.request_ids) if config['facility'] == 'LCO' else client.execute('files', plan)
            if config['facility'] == 'TRT':
                if not isinstance(raw, dict) or raw.get('error') or raw.get('errors') or not isinstance(raw.get('file_path'), dict):
                    raise NativeError('unrecognized_file_listing')
                products = list(raw['file_path'].values())
                if any(not isinstance(product, dict) or (
                        product.get('wcs') is not None and not isinstance(product['wcs'], str)) for product in products):
                    raise NativeError('unrecognized_file_listing')
                file_count = sum(bool(product.get('wcs', '').strip()) for product in products if product.get('wcs') is not None)
            elif isinstance(raw, list):
                file_count = len(raw)
            else:
                raise NativeError('unrecognized_file_listing')
            # Listing is not a download and neither implies processing completion.
            job.result = {'data_state': 'listed_only', 'file_count': file_count}
            job.state = 'succeeded'
        else:
            raw = client.execute('validate' if job.action == 'validate_remote' else job.action, plan)
            if not isinstance(raw, dict):
                raise NativeError('invalid_receipt_shape')
            job.result = public_receipt(raw)
            job.state = 'unknown'
            facility = config['facility']
            if job.action == 'validate_remote':
                job.state = 'succeeded' if isinstance(raw, dict) and raw.get('errors') == {} else 'rejected'
            elif job.action == 'submit':
                if facility == 'LCO' and isinstance(raw, dict) and raw.get('proposal') == config['proposal'] and isinstance(raw.get('id'), int) and raw['id'] > 0:
                    requests = raw.get('requests')
                    if type(raw['id']) is not int or not isinstance(requests, list) or not requests or any(
                            not isinstance(r, dict) or type(r.get('id')) is not int or r['id'] <= 0 for r in requests):
                        raise NativeError('invalid_request_ids')
                    plan.external_id = str(raw['id'])
                    plan.request_ids = [r['id'] for r in requests]
                    plan.observation_state = str(raw.get('state', 'unknown'))[:80]
                    job.state = 'succeeded'
                elif facility == 'LT' and raw.get('mode') == 'reject':
                    job.state = 'rejected'
                elif facility == 'LT' and raw.get('mode') == 'confirm' and raw.get('schedule_match'):
                    plan.external_id = raw['uid']
                    job.state = 'succeeded'
                elif facility == 'TRT' and not raw.get('error') and not raw.get('errors') and raw.get('status') in {None, 'success'} and isinstance(raw.get('obs_id'), str) and re.fullmatch(r'[0-9]{6}[A-Za-z0-9]{4}_[1-9][0-9]*', raw['obs_id']):
                    plan.external_id = raw['obs_id']
                    job.state = 'succeeded'
                # Unrecognized/partial receipts stay UNKNOWN, including a confirm without schedule evidence.
            elif job.action == 'status':
                if facility == 'LCO' and str(raw.get('id')) == plan.external_id and raw.get('proposal') == config['proposal']:
                    plan.observation_state = str(raw.get('state', 'unknown'))[:80]
                    job.state = 'succeeded'
                elif facility == 'LT':
                    job.state = 'rejected' if raw.get('mode') == 'reject' else 'unknown'
                    plan.observation_state = 'unknown'  # update alone is not execution evidence
            elif job.action == 'cancel' and facility == 'LCO':
                if str(raw.get('id')) == plan.external_id and raw.get('proposal') == config['proposal'] and raw.get('state') == 'CANCELED':
                    plan.observation_state = 'CANCELED'
                    job.state = 'succeeded'
            elif job.action == 'cancel' and facility == 'LT' and raw.get('cancel_confirmed'):
                # Independent update receipt must retain matching identity; no history != cancelled.
                followup = client.execute('status', plan)
                if followup.get('cancel_confirmed'):
                    plan.observation_state = 'cancelled'
                    job.state = 'succeeded'
            plan.checked_at = timezone.now()
            if job.action == 'submit' and job.state == 'succeeded':
                plan.registration_payload = registration_record(plan, config)
            # One database update persists both confirmed ID and its pending registration.
            plan.save(update_fields=['external_id', 'request_ids', 'observation_state', 'checked_at', 'registration_payload'])
    except (NativeError, InvalidPlan, PermissionDenied, KeyError, ValueError, TypeError):
        job.state = 'unknown' if sent and job.action in {'submit', 'cancel'} else 'failed'
        job.error_code = 'uncertain_remote_outcome' if job.state == 'unknown' else 'configuration_or_validation_failed'
    job.finished_at = timezone.now()
    job.save(update_fields=['state', 'finished_at', 'result', 'error_code'])
    event(plan, job.actor, 'job_finished', job_id=str(job.id), state=job.state, error_code=job.error_code)
    return True


def recover_stale(age_minutes=10):
    # A dead worker may have sent its request. Never requeue a stale send intent.
    jobs = Job.objects.filter(state='running', started_at__lt=timezone.now()-timedelta(minutes=age_minutes))
    with transaction.atomic():
        count = jobs.filter(action__in=['submit', 'cancel']).update(
            state='unknown', error_code='worker_interrupted', finished_at=timezone.now())
        count += jobs.exclude(action__in=['submit', 'cancel']).update(
            state='failed', error_code='worker_interrupted', finished_at=timezone.now())
    return count
