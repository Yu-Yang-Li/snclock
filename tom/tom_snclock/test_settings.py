"""Isolated regression settings: no production DB, secret or shared cache."""
from .settings import *  # noqa: F403

SECRET_KEY = 'test-only-not-valid-for-any-deployment'
SECRET_KEY_FALLBACKS = []
DEBUG = False
ALLOWED_HOSTS = ['testserver', 'localhost', '127.0.0.1']
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
SECURE_SSL_REDIRECT = False
STDWEB_API_TOKEN = ''
TELESCOPE_SNAPSHOT_PATH = ''
TELESCOPE_SNAPSHOT_SYNTHETIC = False
REST_FRAMEWORK['DEFAULT_PERMISSION_CLASSES'] = ['rest_framework.permissions.IsAuthenticatedOrReadOnly']
