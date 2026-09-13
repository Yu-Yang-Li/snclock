from django.apps import AppConfig


class CustomCodeConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "custom_code"

    def ready(self):
        from custom_code.plotly_config import configure_external_plotly_bundle

        configure_external_plotly_bundle()
