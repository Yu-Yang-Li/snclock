from django.urls import include, path
from custom_code.home import snclock_home

from custom_code.views import (
    ProtectedObservationTemplateCreateView,
    ProtectedObservationTemplateListView,
    stdweb_target,
    system_status,
    target_from_snclock,
)


urlpatterns = [
    path('', snclock_home, name='snclock-home'),
    path('source/<path:name>', snclock_home, name='snclock-source'),
    path('telescope-data/', include('telescope_data.urls')),
    path(
        "from-snclock/<path:name>/",
        target_from_snclock,
        name="target-from-snclock",
    ),
    path(
        "stdweb/targets/<int:pk>/",
        stdweb_target,
        name="stdweb-target",
    ),
    path("system-status/", system_status, name="system-status"),
    path(
        "observations/template/list/",
        ProtectedObservationTemplateListView.as_view(),
        name="protected-observation-template-list",
    ),
    path(
        "observations/template/<str:facility>/create/",
        ProtectedObservationTemplateCreateView.as_view(),
        name="protected-observation-template-create",
    ),
    path("", include("tom_common.urls")),
]
