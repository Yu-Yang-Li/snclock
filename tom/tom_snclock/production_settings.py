"""Opt-in production settings. Existing deployments retain their local settings."""
import os
from django.core.exceptions import ImproperlyConfigured
from .settings import *  # noqa: F403

SECRET_KEY = os.environ.get('TOM_SECRET_KEY', '')
if len(SECRET_KEY) < 50 or SECRET_KEY == 'development-only-not-for-production':
    raise ImproperlyConfigured('Set TOM_SECRET_KEY to a securely generated value of at least 50 characters.')
DEBUG = False
ALLOWED_HOSTS = os.environ.get('TOM_ALLOWED_HOSTS', 'tom.snclock.com').split(',')
TOM_NAME = 'SN Clock 观测管理'
CSRF_TRUSTED_ORIGINS = ['https://' + host for host in ALLOWED_HOSTS if host not in ['localhost', '127.0.0.1']]
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_SECURE = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_HSTS_SECONDS = 3600
STATIC_ROOT = os.environ.get('TOM_STATIC_ROOT', os.path.join(BASE_DIR, '_static'))
DATABASES['default']['NAME'] = os.environ.get('TOM_DATABASE_PATH', os.path.join(BASE_DIR, 'db.sqlite3'))
EXTRA_FIELDS = [
    {'name': name, 'type': kind} for name, kind in [
        ('discovery_date', 'datetime'), ('discovery_mag', 'number'), ('discovery_filter', 'string'),
        ('object_type', 'string'), ('redshift', 'number'), ('host_redshift', 'number'),
        ('sn_clock_texp', 'number'), ('sn_clock_ci_lower', 'number'), ('sn_clock_ci_upper', 'number'),
        ('data_source', 'string'), ('snclock_url', 'string'), ('last_update', 'datetime'),
    ]
]
