import requests


CAPABILITY_LABELS = {
    "source_extraction": "测源",
    "astrometric_refinement": "星表精化",
    "psf_photometry": "PSF 测光",
    "image_resampling": "图像重采样",
    "blind_astrometry": "盲解天测",
    "template_subtraction": "模板差分",
}


def _fetch(url):
    try:
        response = requests.get(url, timeout=(2, 4))
        response.raise_for_status()
        return response.json()
    except (requests.RequestException, ValueError):
        return None


def get_stack_status(target_count):
    snclock = _fetch("http://127.0.0.1:8000/health")
    stdweb = _fetch("http://127.0.0.1:8021/healthz/")

    candidate_state = (snclock or {}).get("runtime", {}).get(
        "candidate_state",
        {},
    )
    model_check = (snclock or {}).get("checks", {}).get(
        "sn_clock_models",
        {},
    )
    models = [
        item["model_id"]
        for item in model_check.get("models", [])
        if item.get("enabled")
    ]
    capabilities = (stdweb or {}).get("capabilities", {})
    enabled_capabilities = sum(bool(value) for value in capabilities.values())
    unavailable = [
        CAPABILITY_LABELS.get(name, name)
        for name, enabled in capabilities.items()
        if not enabled
    ]

    rows = [
        {
            "name": "SN Clock",
            "ok": bool(snclock and snclock.get("status") == "ok"),
            "purpose": "发现、筛选和爆发时刻预测",
            "detail": (
                f"当前展示 {candidate_state.get('displayed_count', 0)} 个候选；"
                f"启用模型：{', '.join(models) or '无'}"
            ),
            "url": "https://snclock.com/",
        },
        {
            "name": "TOM",
            "ok": True,
            "purpose": "目标、观测计划和数据管理",
            "detail": f"目标库共 {target_count} 个目标；当前页面服务正常",
            "url": "https://tom.snclock.com/",
        },
        {
            "name": "STDWeb",
            "ok": bool(stdweb and stdweb.get("status") == "ready"),
            "purpose": "FITS 检查、标定和测光",
            "detail": (
                f"可用能力 {enabled_capabilities}/{len(capabilities)}；"
                f"暂不可用：{', '.join(unavailable) or '无'}"
            ),
            "url": "https://tom.snclock.com/reduce/",
        },
    ]
    return {
        "ok": all(row["ok"] for row in rows),
        "rows": rows,
    }
