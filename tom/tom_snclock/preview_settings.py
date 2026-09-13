"""Local-only synthetic acceptance environment, never a deployment configuration."""
import os
from django.core.exceptions import ImproperlyConfigured
from .test_settings import *  # noqa: F403

if os.environ.get('TOM_ALLOW_SYNTHETIC_PREVIEW') != '1':
    raise ImproperlyConfigured('Synthetic preview requires explicit opt-in.')
DEBUG = True
DATABASES['default']['NAME'] = os.path.join(BASE_DIR, 'preview.sqlite3')
ROOT_URLCONF = 'tom_snclock.preview_urls'
TELESCOPE_SNAPSHOT_PATH = os.path.join(BASE_DIR, 'telescope_data', 'fixtures', 'snapshot.synthetic.json')
TELESCOPE_SNAPSHOT_SYNTHETIC = True
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
TOM_NAME = 'SN Clock · 合成验收环境'
