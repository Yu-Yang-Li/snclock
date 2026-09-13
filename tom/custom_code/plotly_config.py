from functools import wraps

from plotly import offline


def configure_external_plotly_bundle():
    """Keep Plotly figures inline while loading the library once per page."""
    current_plot = offline.plot
    if getattr(current_plot, "_snclock_external_bundle", False):
        return

    @wraps(current_plot)
    def plot_with_external_bundle(*args, **kwargs):
        kwargs.setdefault("include_plotlyjs", False)
        return current_plot(*args, **kwargs)

    plot_with_external_bundle._snclock_external_bundle = True
    offline.plot = plot_with_external_bundle
