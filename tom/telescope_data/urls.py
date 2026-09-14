from django.urls import include, path
from . import views

urlpatterns = [
    path('operations/', include('telescope_ops.urls')),
    path('', views.workspace, name='telescope-workspace'),
    path('api/v1/capabilities', views.capabilities, name='telescope-capabilities'),
    path('api/v1/targets', views.targets, name='telescope-targets'),
    path('api/v1/targets/<str:target>/photometry', views.photometry, name='telescope-photometry'),
    path('api/v1/targets/<str:target>/qa', views.qa, name='telescope-qa'),
    path('api/v1/targets/<str:target>/requests', views.requests_list, name='telescope-requests'),
    path('api/v1/targets/<str:target>/daily', views.daily, name='telescope-daily'),
    path('assets/<str:asset_id>', views.asset, name='telescope-asset'),
]
