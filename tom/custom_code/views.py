import json
from urllib.parse import urlencode

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.contrib.auth.mixins import LoginRequiredMixin
from django.http import Http404
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.http import require_http_methods
from tom_dataproducts.models import DataProduct
from tom_observations.facility import get_service_class
from tom_observations.views import (
    ObservationTemplateCreateView,
    ObservationTemplateListView,
)
from tom_targets.models import Target

from custom_code.stack_status import get_stack_status
from custom_code.stdweb_client import StdWebClient, StdWebError


STATE_LABELS = {
    "uploaded": "已上传，等待检查",
    "inspect": "正在检查 FITS",
    "inspect_done": "检查完成",
    "photometry": "正在测光",
    "photometry_done": "测光完成",
    "failed": "处理失败",
    "unavailable": "暂时无法读取状态",
}


class ProtectedObservationTemplateListView(
    LoginRequiredMixin,
    ObservationTemplateListView,
):
    def get_context_data(self, *args, **kwargs):
        context = super().get_context_data(*args, **kwargs)
        context["installed_facilities"] = {
            name: facility_class
            for name, facility_class in context["installed_facilities"].items()
            if not getattr(facility_class, "is_redirect", False)
        }
        return context


class ProtectedObservationTemplateCreateView(
    LoginRequiredMixin,
    ObservationTemplateCreateView,
):
    def get_form_class(self):
        facility = get_service_class(self.get_facility_name())()
        if getattr(facility, "is_redirect", False):
            raise Http404("Redirect facilities do not provide observation templates")
        return super().get_form_class()


def target_from_snclock(request, name):
    target_name = name.strip()
    target = Target.objects.filter(name__iexact=target_name).only("pk").first()
    if target:
        return redirect("targets:detail", pk=target.pk)

    query = urlencode({"query": target_name})
    return redirect(f"{reverse('targets:list')}?{query}")


def _stdweb_metadata(data_product):
    try:
        extra = json.loads(data_product.extra_data or "{}")
    except (TypeError, ValueError):
        return {}
    return extra.get("stdweb", {}) if isinstance(extra, dict) else {}


def _save_stdweb_metadata(data_product, task):
    try:
        extra = json.loads(data_product.extra_data or "{}")
    except (TypeError, ValueError):
        extra = {"legacy_extra_data": data_product.extra_data}
    if not isinstance(extra, dict):
        extra = {}
    extra["stdweb"] = {
        "task_id": task["id"],
        "state": task.get("state", "uploaded"),
    }
    data_product.extra_data = json.dumps(extra, ensure_ascii=False)
    data_product.save(update_fields=["extra_data", "modified"])


@login_required
@require_http_methods(["GET", "POST"])
def stdweb_target(request, pk):
    target = get_object_or_404(Target, pk=pk)
    products = list(
        DataProduct.objects.filter(
            target=target,
            data_product_type="fits_file",
        ).order_by("-created")
    )
    client = StdWebClient()

    if request.method == "POST":
        product = get_object_or_404(
            DataProduct,
            pk=request.POST.get("data_product_id"),
            target=target,
            data_product_type="fits_file",
        )
        config = {
            "target_ra": float(target.ra),
            "target_dec": float(target.dec),
            "targets": [
                {
                    "name": target.name,
                    "ra": float(target.ra),
                    "dec": float(target.dec),
                }
            ],
            "blind_match_wcs": False,
            "centroid_targets": False,
        }
        try:
            task = client.create_task(
                product.data.path,
                f"{target.name} / {product.data.name}",
                config,
            )
        except StdWebError as exc:
            messages.error(request, str(exc))
        else:
            _save_stdweb_metadata(product, task)
            messages.success(
                request,
                f"已提交到 STDWeb，任务号 {task['id']}。请先核对参数再运行处理。",
            )
        return redirect("stdweb-target", pk=target.pk)

    rows = []
    for product in products:
        metadata = _stdweb_metadata(product)
        task_id = metadata.get("task_id")
        state = client.task_state(task_id) if task_id else None
        rows.append(
            {
                "product": product,
                "task_id": task_id,
                "state": state,
                "state_label": STATE_LABELS.get(state, state or "尚未提交"),
                "task_url": client.task_url(task_id) if task_id else None,
            }
        )
    return render(
        request,
        "custom_code/stdweb_target.html",
        {"target": target, "rows": rows},
    )


@login_required
@require_http_methods(["GET"])
def system_status(request):
    status = get_stack_status(Target.objects.count())
    return render(
        request,
        "custom_code/system_status.html",
        {"stack": status},
    )
