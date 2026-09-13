import math
import os
import time
from datetime import UTC

import requests
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils.dateparse import parse_datetime
from django.utils.timezone import is_naive, make_aware
from tom_targets.models import Target, TargetExtra


DEFAULT_API_URL = "http://127.0.0.1:8000/api/v1/candidates"
NUMBER_FIELDS = {
    "discovery_mag",
    "redshift",
    "host_redshift",
    "sn_clock_texp",
    "sn_clock_ci_lower",
    "sn_clock_ci_upper",
}


def _finite_number(value):
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _utc_datetime(value):
    if not value:
        return None
    parsed = parse_datetime(str(value))
    if parsed is None:
        return None
    return make_aware(parsed, UTC) if is_naive(parsed) else parsed


def _extra_values(candidate):
    sn_clock = candidate.get("sn_clock") or {}
    name = candidate["tns_name"]
    return {
        "discovery_date": _utc_datetime(candidate.get("discovery_date")),
        "discovery_mag": candidate.get("discovery_mag"),
        "discovery_filter": candidate.get("discovery_filter"),
        "object_type": candidate.get("object_type"),
        "redshift": candidate.get("redshift"),
        "host_redshift": candidate.get("host_redshift"),
        "sn_clock_texp": sn_clock.get("texp"),
        "sn_clock_ci_lower": sn_clock.get("ci_lower"),
        "sn_clock_ci_upper": sn_clock.get("ci_upper"),
        "data_source": candidate.get("data_source"),
        "snclock_url": f"https://snclock.com/source/{name.replace(' ', '%20')}",
        "last_update": _utc_datetime(candidate.get("last_update")),
    }


def _fetch_candidates(api_url, timeout, attempts=3):
    last_error = None
    for attempt in range(attempts):
        try:
            response = requests.get(api_url, timeout=timeout)
            response.raise_for_status()
            payload = response.json()
            candidates = payload.get("data")
            if not isinstance(candidates, list):
                raise ValueError("response does not contain a candidate list")
            return candidates
        except (requests.RequestException, ValueError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(5 * (attempt + 1))
    raise CommandError(f"SN Clock request failed after {attempts} attempts: {last_error}")


class Command(BaseCommand):
    help = "Import the current SN Clock candidates into TOM Toolkit."

    def add_arguments(self, parser):
        parser.add_argument(
            "--api-url",
            default=os.getenv("SNCLOCK_CANDIDATES_URL", DEFAULT_API_URL),
        )
        parser.add_argument("--timeout", type=float, default=30.0)

    def handle(self, *args, **options):
        candidates = _fetch_candidates(options["api_url"], options["timeout"])

        created = updated = skipped = 0
        with transaction.atomic():
            for candidate in candidates:
                name = str(candidate.get("tns_name") or "").strip()
                ra = _finite_number(candidate.get("ra"))
                dec = _finite_number(candidate.get("dec"))
                if not name or ra is None or dec is None:
                    skipped += 1
                    continue
                if not 0 <= ra < 360 or not -90 <= dec <= 90:
                    skipped += 1
                    continue

                target, was_created = Target.objects.update_or_create(
                    name=name,
                    defaults={
                        "type": Target.SIDEREAL,
                        "ra": ra,
                        "dec": dec,
                        "epoch": 2000.0,
                        "permissions": "OPEN",
                    },
                )
                created += int(was_created)
                updated += int(not was_created)

                for key, value in _extra_values(candidate).items():
                    if value is None:
                        TargetExtra.objects.filter(target=target, key=key).delete()
                        continue
                    if key in NUMBER_FIELDS:
                        value = _finite_number(value)
                        if value is None:
                            TargetExtra.objects.filter(target=target, key=key).delete()
                            continue
                    TargetExtra.objects.update_or_create(
                        target=target,
                        key=key,
                        defaults={"value": value},
                    )

        self.stdout.write(
            self.style.SUCCESS(
                f"SN Clock sync complete: fetched={len(candidates)} "
                f"created={created} updated={updated} skipped={skipped}"
            )
        )
