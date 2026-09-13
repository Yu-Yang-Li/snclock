from django.conf import settings
from django.conf.urls.static import static
from .urls import urlpatterns

urlpatterns += static('/assets/', document_root=settings.SNCLOCK_FRONTEND_DIST + '/assets')
