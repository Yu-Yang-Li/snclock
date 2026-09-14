import uuid

from django.conf import settings
from django.db import models
from tom_targets.models import Target


class Plan(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    target = models.ForeignKey(Target, on_delete=models.PROTECT)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    profile = models.CharField(max_length=100)
    specification = models.JSONField()
    payload = models.JSONField()
    sha256 = models.CharField(max_length=64, unique=True)
    config_sha256 = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)
    validated_at = models.DateTimeField(null=True)
    approved_at = models.DateTimeField(null=True)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True,
                                    on_delete=models.PROTECT, related_name='+')
    expires_at = models.DateTimeField()
    external_id = models.CharField(max_length=200, blank=True)
    request_ids = models.JSONField(default=list)
    registration_payload = models.JSONField(default=dict)
    observation_state = models.CharField(max_length=80, default='unknown')
    checked_at = models.DateTimeField(null=True)

    class Meta:
        permissions = [('approve_plan', 'Approve exact telescope payloads')]


class Job(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name='jobs')
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    action = models.CharField(max_length=20)
    idempotency_key = models.CharField(max_length=100, unique=True)
    state = models.CharField(max_length=20, default='queued')
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True)
    finished_at = models.DateTimeField(null=True)
    result = models.JSONField(default=dict)
    error_code = models.CharField(max_length=80, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['plan', 'action'],
                       condition=models.Q(action__in=['submit', 'cancel']),
                       name='one_facility_write_per_plan_action')]


class Event(models.Model):
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name='events')
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT)
    action = models.CharField(max_length=40)
    at = models.DateTimeField(auto_now_add=True)
    details = models.JSONField(default=dict)
