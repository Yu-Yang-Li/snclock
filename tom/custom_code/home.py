"""Serve the SN Clock frontend as the TOM homepage, without an iframe."""
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, HttpResponse
from django.views.decorators.http import require_GET


@require_GET
def snclock_home(request, name=None):
    root = Path(settings.SNCLOCK_FRONTEND_DIST)
    try:
        response = FileResponse((root / 'index.html').open('rb'), content_type='text/html')
    except OSError:
        return HttpResponse('SN Clock 首页资源尚未部署，请联系管理员。', status=503)
    response['Cache-Control'] = 'no-cache'
    return response
