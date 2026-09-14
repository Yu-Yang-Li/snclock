import json
import uuid

from django.conf import settings
from django.core.exceptions import PermissionDenied
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render, redirect
from django.views.decorators.http import require_http_methods
from tom_targets.models import Target

from .models import Plan, Job
from .plans import InvalidPlan, digest
from . import service


def enabled(request):
    if not request.user.is_authenticated or not request.user.is_active:
        raise PermissionDenied('Login required')
    if not getattr(settings, 'TELESCOPE_OPERATIONS_ENABLED', False):
        raise InvalidPlan('观测操作尚未启用；需要管理员配置设施和完成协议验收')


def json_response(data, status=200):
    response = JsonResponse(data, status=status)
    response['Cache-Control'] = 'private, no-store'
    return response


def representation(plan):
    return {'id': str(plan.id), 'target_id': plan.target_id, 'target': plan.target.name,
            'profile': plan.profile, 'plan_sha256': plan.sha256, 'payload': plan.payload,
            'validated_at': plan.validated_at, 'approved_at': plan.approved_at,
            'expires_at': plan.expires_at, 'external_id': plan.external_id,
            'observation_state': plan.observation_state, 'checked_at': plan.checked_at}


@require_http_methods(['GET', 'POST'])
def api(request, plan_id=None, action=None, job_id=None):
    try:
        enabled(request)
        if request.method == 'GET':
            if job_id:
                job = get_object_or_404(Job.objects.select_related('plan__target'), pk=job_id)
                service.authorize(request.user, job.plan.target, service.profile_for(job.plan.profile))
                return json_response({'id': str(job.id), 'state': job.state, 'action': job.action,
                    'result': job.result, 'error_code': job.error_code, 'finished_at': job.finished_at})
            plan = get_object_or_404(Plan.objects.select_related('target'), pk=plan_id)
            service.authorize(request.user, plan.target, service.profile_for(plan.profile))
            if action == 'registration':
                record = plan.registration_payload
                if not record or not plan.external_id:
                    return json_response({'error': {'code': 'registration_unavailable'}}, 409)
                if record.get('record_sha256') != digest({k: v for k, v in record.items() if k != 'record_sha256'}):
                    return json_response({'error': {'code': 'registration_integrity_error'}}, 409)
                response = json_response(record)
                response['Content-Disposition'] = f'attachment; filename="registration-{plan.id}.json"'
                return response
            return json_response(representation(plan))
        if request.content_type != 'application/json' or len(request.body) > 65536:
            raise InvalidPlan('Expected JSON body up to 64 KiB')
        data = json.loads(request.body)
        if not isinstance(data, dict):
            raise InvalidPlan('Expected object')
        if plan_id is None:
            if set(data) != {'target_id', 'profile', 'specification'}:
                raise InvalidPlan('Invalid draft fields')
            target = get_object_or_404(Target, pk=data['target_id'])
            plan = service.create_plan(request.user, target, data['profile'], data['specification'])
            return json_response(representation(plan), 201)
        plan = get_object_or_404(Plan.objects.select_related('target'), pk=plan_id)
        service.authorize(request.user, plan.target, service.profile_for(plan.profile))
        if action == 'validate':
            service.validate_local(request.user, plan)
        elif action == 'approve':
            service.approve(request.user, plan, data.get('plan_sha256'))
        else:
            if action == 'cancel' and data.get('confirmation') != 'CANCEL '+plan.external_id:
                raise InvalidPlan('Exact cancellation confirmation required')
            job = service.enqueue(request.user, plan, action, request.headers.get('Idempotency-Key'), data.get('plan_sha256'))
            return json_response({'job_id': str(job.id), 'state': job.state}, 202)
        return json_response(representation(plan))
    except PermissionDenied:
        return json_response({'error': {'code': 'permission_denied', 'message': '需要设施申请和目标权限'}}, 403)
    except (InvalidPlan, ValueError, TypeError, KeyError):
        return json_response({'error': {'code': 'invalid_operation', 'message': '操作被拒绝：检查配置、参数、有效期、审批及重复请求'}}, 400)


@require_http_methods(['GET', 'POST'])
def workspace(request):
    notice = ''
    plans = []
    targets = []
    profiles = getattr(settings, 'TELESCOPE_PROFILES', {})
    try:
        enabled(request)
        profiles = {name: config for name, config in profiles.items() if request.user.is_superuser or
                    (config.get('group') and request.user.groups.filter(name=config['group']).exists())}
        targets = [target for target in Target.objects.all() if any(_authorized(request.user, target, c) for c in profiles.values())]
        plans = [p for p in Plan.objects.select_related('target').prefetch_related('jobs').order_by('-created_at')[:100]
                 if _authorized(request.user, p.target, profiles.get(p.profile, {}))]
        for plan in plans:
            plan.available_actions = service.available_actions(profiles.get(plan.profile, {}))
            plan.send_intent = any(job.action == 'submit' for job in plan.jobs.all())
            for job in plan.jobs.all():
                job.display_state = {'queued': '待执行', 'running': '正在执行', 'succeeded': '本次操作已完成',
                    'failed': '本次操作失败', 'rejected': '已拒绝', 'unknown': '结果待核对，勿重复提交'}.get(job.state, '待核对')
                job.display_action = {'submit': '提交观测', 'cancel': '取消观测', 'status': '查询状态',
                    'files': '查询文件', 'validate_remote': '设施预检'}.get(job.action, '操作')
        if request.method == 'POST':
            action = request.POST.get('action')
            if action == 'create':
                target = get_object_or_404(Target, pk=request.POST.get('target_id'))
                if request.POST.get('specification'):
                    specification = json.loads(request.POST['specification'])
                else:
                    specification = {'epochs': [{'start_utc': request.POST.get('start_utc', '')+'Z',
                        'end_utc': request.POST.get('end_utc', '')+'Z',
                        'max_airmass': float(request.POST.get('max_airmass', '')),
                        'exposures': [{'band': request.POST.get('band'), 'count': int(request.POST.get('count', '')),
                                       'seconds': float(request.POST.get('seconds', ''))}]}]}
                service.create_plan(request.user, target, request.POST.get('profile'), specification)
            else:
                plan = get_object_or_404(Plan, pk=request.POST.get('plan_id'))
                if action == 'validate':
                    service.validate_local(request.user, plan)
                elif action == 'approve':
                    service.approve(request.user, plan, request.POST.get('sha256'))
                else:
                    if action == 'cancel' and request.POST.get('confirmation') != 'CANCEL '+plan.external_id:
                        raise InvalidPlan('请填写精确取消确认语句')
                    service.enqueue(request.user, plan, action, request.POST.get('key'), request.POST.get('sha256'))
            return redirect('telescope-operations')
    except (PermissionDenied, InvalidPlan, ValueError, TypeError, KeyError):
        notice = '操作未执行：请检查登录、设施及目标授权、草案格式、审批状态和重复请求。未配置的设施不会调用远端。'
    response = render(request, 'telescope_data/operations.html', {'notice': notice, 'plans': plans,
        'targets': targets, 'profiles': profiles.keys(), 'key': str(uuid.uuid4())})
    response['Cache-Control'] = 'private, no-store'
    return response


def _authorized(user, target, config):
    try:
        service.authorize(user, target, config)
        return True
    except PermissionDenied:
        return False
