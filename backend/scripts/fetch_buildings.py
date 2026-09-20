"""Optional Google Places lookup for ``buildings.json`` (PRD 8.4).

Default is dry-run: no network, no writes. Live calls require ``--allow-network``
and ``GOOGLE_MAPS_API_KEY`` in the process environment. This module never loads
``.env`` and never prints the key.
"""

from __future__ import annotations

import argparse
import math
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import config
from models import Building
from scripts.common import (
    Counts,
    PipelineError,
    dump_json,
    google_api_key,
    load_json,
    model_payload,
)


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def first_search_word(search: str) -> str:
    return "".join(ch for ch in search.split()[0].casefold() if ch.isalnum())


def should_flag_candidate(search: str, name: str, lat: float, lng: float) -> bool:
    word = first_search_word(search)
    name_ok = word in name.casefold() if word else True
    distance = haversine_km(lat, lng, config.CAMPUS_CENTER_LAT, config.CAMPUS_CENTER_LNG)
    return (not name_ok) or distance > config.BUILDING_FLAG_RADIUS_KM


def load_seed(path: Path) -> list[dict[str, str]]:
    payload = load_json(path)
    if not isinstance(payload, list):
        raise PipelineError(f"{path}: seed root must be a list of {{code, search}} objects")
    rows = []
    for index, item in enumerate(payload):
        if not isinstance(item, dict) or "code" not in item or "search" not in item:
            raise PipelineError(f"{path}: item {index} must have code and search")
        rows.append(
            {"code": str(item["code"]).strip().upper(), "search": str(item["search"]).strip()}
        )
    return rows


def _places_query(search: str, key: str, timeout: float) -> dict[str, Any]:
    import httpx

    params = {
        "input": f"{search}{config.BLACKSBURG_QUERY_SUFFIX}",
        "inputtype": "textquery",
        "fields": "place_id,name,geometry,formatted_address",
        "key": key,
    }
    last_error: Exception | None = None
    for _attempt in range(config.GOOGLE_HTTP_RETRIES + 1):
        try:
            response = httpx.get(config.GOOGLE_PLACES_FIND_URL, params=params, timeout=timeout)
            response.raise_for_status()
            return response.json()
        except Exception as exc:  # noqa: BLE001 — retried, then wrapped
            last_error = exc
    raise PipelineError(f"Places request failed for {search!r}: {last_error}") from last_error


def candidate_from_places(code: str, search: str, payload: Mapping[str, Any]) -> Building:
    candidates = payload.get("candidates") or []
    if not candidates:
        raise PipelineError(f"no Places candidate for {code} ({search!r})")
    hit = candidates[0]
    location = ((hit.get("geometry") or {}).get("location")) or {}
    lat = float(location["lat"])
    lng = float(location["lng"])
    name = str(hit.get("name") or search)
    return Building.model_validate(
        {
            "name": name,
            "place_id": hit.get("place_id"),
            "lat": lat,
            "lng": lng,
            "address": hit.get("formatted_address"),
            "verified": False,
            "source": "google_places",
            "fetched_at": None,
        }
    )


def merge_buildings(
    existing: dict[str, Building],
    incoming: dict[str, Building],
    *,
    force: bool,
) -> dict[str, Building]:
    merged = dict(existing)
    for code, building in incoming.items():
        current = merged.get(code)
        if current is not None and current.source == "manual_fix" and not force:
            continue
        if current is not None and not force and current.source != "google_places":
            continue
        merged[code] = building
    return dict(sorted(merged.items()))


def fetch_buildings(
    seed_path: Path,
    output_path: Path,
    *,
    allow_network: bool,
    dry_run: bool,
    force: bool,
    timeout: float,
    environ: Mapping[str, str] | None = None,
) -> Counts:
    counts = Counts()
    seed = load_seed(seed_path)
    counts.read = len(seed)
    existing_raw = load_json(output_path) if output_path.exists() else {}
    existing = {code: Building.model_validate(raw) for code, raw in existing_raw.items()}
    if dry_run or not allow_network:
        for row in seed:
            print(f"dry-run: would query Places for {row['code']} ({row['search']})")
        counts.warned = len(seed)
        print("dry-run: no network, no write")
        return counts
    key = google_api_key(environ)
    if key is None:
        raise PipelineError(
            f"{config.ENV_GOOGLE_MAPS_API_KEY} is not set; "
            "export it in the process environment (the server never reads it)"
        )
    incoming: dict[str, Building] = {}
    for row in seed:
        print(f"Places lookup {row['code']} input={row['search']}{config.BLACKSBURG_QUERY_SUFFIX}")
        payload = _places_query(row["search"], key, timeout)
        building = candidate_from_places(row["code"], row["search"], payload)
        if should_flag_candidate(row["search"], building.name, building.lat, building.lng):
            print(f"flag: {row['code']} name={building.name!r} may need review")
            counts.warned += 1
        incoming[row["code"]] = building
    merged = merge_buildings(existing, incoming, force=force)
    dump_json(output_path, {code: model_payload(item) for code, item in merged.items()})
    counts.written = len(merged)
    counts.files = 1
    return counts


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Optional Google Places building lookup")
    parser.add_argument(
        "--seed",
        type=Path,
        default=config.RAW_SEED_DIR / config.BUILDINGS_SEED_FILE,
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=config.DEFAULT_DATA_DIR / config.BUILDINGS_FILE,
    )
    parser.add_argument("--dry-run", action="store_true", help="print queries; write nothing")
    parser.add_argument(
        "--allow-network",
        action="store_true",
        help="permit live Places calls (requires GOOGLE_MAPS_API_KEY)",
    )
    parser.add_argument(
        "--force", action="store_true", help="replace existing non-preserved entries"
    )
    parser.add_argument("--timeout", type=float, default=config.GOOGLE_HTTP_TIMEOUT_SEC)
    args = parser.parse_args(list(argv) if argv is not None else None)
    dry_run = args.dry_run or not args.allow_network
    try:
        counts = fetch_buildings(
            args.seed,
            args.output,
            allow_network=args.allow_network,
            dry_run=dry_run,
            force=args.force,
            timeout=args.timeout,
        )
    except PipelineError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(counts.line())
    return 0


if __name__ == "__main__":
    sys.exit(main())
