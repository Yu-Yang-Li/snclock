from django.urls import path
from . import views

urlpatterns = [
    path('', views.workspace, name='telescope-operations'),
    path('api/plans', views.api),
    path('api/plans/<uuid:plan_id>', views.api),
    path('api/plans/<uuid:plan_id>/<str:action>', views.api),
    path('api/jobs/<uuid:job_id>', views.api),
]
