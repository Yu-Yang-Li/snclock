"""Authenticated, read-only bridge for the supplied telescope snapshot format."""
import mimetypes
from functools import lru_cache
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, JsonResponse
from django.shortcuts import render
from django.urls import reverse
from django.views.decorators.http import require_GET

from .vendor.snapshot_reader import SnapshotError, SnapshotReader


def error(code, message, status):
    response = JsonResponse({'error': {'code': code, 'message': message}}, status=status)
    response['Cache-Control'] = 'private, no-store'
    return response


def access_error(request):
    if not request.user.is_authenticated:
        return error('authentication_required', '请先登录观测工作台。', 401)
    # Report rows have no TOM object-permission mapping yet. Fail closed.
    if not request.user.is_staff:
        return error('permission_denied', '日报数据目前仅向获授权的管理人员开放。', 403)
    return None


@lru_cache(maxsize=1)
def cached_reader(path, mtime_ns, size):
    return SnapshotReader(path)


def reader():
    configured = getattr(settings, 'TELESCOPE_SNAPSHOT_PATH', '')
    if not configured:
        raise FileNotFoundError('snapshot not configured')
    path = Path(configured).resolve()
    stat = path.stat()
    return cached_reader(str(path), stat.st_mtime_ns, stat.st_size)


def snapshot_response(request, section, target=None):
    denied = access_error(request)
    if denied is not None:
        return denied
    allowed = {'telescope', 'band', 'date_from', 'date_to', 'limit', 'offset'}
    if set(request.GET) - allowed:
        return error('invalid_filter', '包含不支持的筛选字段。', 400)
    try:
        source = reader()
    except FileNotFoundError:
        return error('snapshot_unavailable', '尚未配置可读取的望远镜日报。', 503)
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return error('snapshot_invalid', '日报暂不可读取，请联系管理员检查数据。', 503)
    try:
        if target is not None:
            source.resolve_target(target)
    except SnapshotError:
        return error('target_unknown', '日报中没有这个目标。', 404)
    try:
        params = request.GET.dict()
        params['limit'] = int(params.get('limit', 100))
        params['offset'] = int(params.get('offset', 0))
        if not 1 <= params['limit'] <= 1000:
            raise ValueError('limit')
        result = source.read(section, target=target, **params)
    except (ValueError, TypeError):
        return error('invalid_filter', '请检查日期、波段和分页参数；每页最多 1000 条。', 400)
    except (OSError, KeyError, AttributeError):
        return error('snapshot_invalid', '日报字段不完整，请联系管理员检查数据。', 503)
    if section == 'qa':
        for row in result['items']:
            row.pop('src', None)
            row['asset_url'] = reverse('telescope-asset', args=[row['asset_id']]) if row['file_exists'] else None
    result['synthetic'] = bool(getattr(settings, 'TELESCOPE_SNAPSHOT_SYNTHETIC', False))
    response = JsonResponse(result, json_dumps_params={'allow_nan': False})
    response['Cache-Control'] = 'private, no-store'
    return response


@require_GET
def targets(request):
    return snapshot_response(request, 'targets')


@require_GET
def photometry(request, target):
    return snapshot_response(request, 'photometry', target)


@require_GET
def qa(request, target):
    return snapshot_response(request, 'qa', target)


@require_GET
def requests_list(request, target):
    return snapshot_response(request, 'requests', target)


@require_GET
def daily(request, target):
    return snapshot_response(request, 'daily', target)


@require_GET
def capabilities(request):
    denied = access_error(request)
    if denied is not None:
        return denied
    response = JsonResponse({
        'mode': 'snapshot_only',
        'snapshot_configured': bool(getattr(settings, 'TELESCOPE_SNAPSHOT_PATH', '')),
        'live_permissions_verified': False,
        'facilities': [{'facility': facility, 'submit': False, 'cancel': False,
                        'sync': False, 'reason': 'not_integrated'}
                       for facility in ['LT', 'REM', 'LCO', 'TRT']],
    })
    response['Cache-Control'] = 'private, no-store'
    return response


@require_GET
def asset(request, asset_id):
    denied = access_error(request)
    if denied is not None:
        return denied
    try:
        source = reader()
        row = next((row for row in source.qa() if row['asset_id'] == asset_id), None)
        if not row or not row['file_exists']:
            return error('asset_missing', '该质控图未提供或暂不可读取。', 404)
        src, exists, issue = source.safe_asset(row['src'])
        if not exists or issue:
            return error('asset_missing', '该质控图未提供或暂不可读取。', 404)
        path = (source.report.parent / src).resolve()
        if path.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp'}:
            return error('unsupported_asset', '仅支持静态质控图片。', 415)
        response = FileResponse(path.open('rb'), content_type=mimetypes.guess_type(path.name)[0])
        response['Cache-Control'] = 'private, no-store'
        response['X-Content-Type-Options'] = 'nosniff'
        return response
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return error('asset_missing', '该质控图暂不可读取。', 404)


@require_GET
def workspace(request):
    context = {'synthetic': bool(getattr(settings, 'TELESCOPE_SNAPSHOT_SYNTHETIC', False))}
    if not request.user.is_authenticated:
        context['notice'] = '请登录后查看望远镜数据。'
    elif not request.user.is_staff:
        context['notice'] = '日报数据目前仅向获授权的管理人员开放。'
    else:
        try:
            source = reader()
            context.update(summary=source.read('summary'), targets=source.targets())
            if request.GET.get('target'):
                try:
                    context['selected_target'] = source.resolve_target(request.GET['target'])
                except SnapshotError:
                    context.pop('summary', None)
                    context['notice'] = '这份日报尚未包含该目标，不会显示其他目标的数据。'
        except (OSError, ValueError, TypeError, KeyError, AttributeError):
            context['notice'] = '尚未接入真实日报。请由管理员配置日报与质控图片目录。'
    response = render(request, 'telescope_data/workspace.html', context)
    response['Cache-Control'] = 'private, no-store'
    return response
