"""Optional Google Routes walking matrix (PRD 8.5).

Default is dry-run. Live calls require ``--allow-network`` and
``GOOGLE_MAPS_API_KEY``. ``manual_override`` entries are preserved unless
``--force``. The server never imports this module.
"""

from __future__ import annotations

import argparse
import math
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import config
from data import walk_key
from models import Building, WalkEntry
from scripts.common import (
    Counts,
    PipelineError,
    dump_json,
    google_api_key,
    load_json,
    model_payload,
)


def verified_codes(buildings: Mapping[str, Building]) -> list[str]:
    return sorted(code for code, item in buildings.items() if item.verified)


def pair_plan(codes: Sequence[str]) -> list[tuple[str, str]]:
    pairs = []
    for index, origin in enumerate(codes):
        for dest in codes[index + 1 :]:
            pairs.append((origin, dest) if origin < dest else (dest, origin))
    return pairs


def chunk_destinations(destinations: Sequence[str], limit: int) -> list[list[str]]:
    if limit < 1:
        raise PipelineError("matrix element limit must be at least 1")
    return [list(destinations[i : i + limit]) for i in range(0, len(destinations), limit)]


def request_plan(codes: Sequence[str], *, element_limit: int) -> list[tuple[str, list[str]]]:
    """One origin per request; destinations are later sorted indexes, chunked."""
    requests: list[tuple[str, list[str]]] = []
    ordered = list(codes)
    for index, origin in enumerate(ordered):
        later = ordered[index + 1 :]
        for chunk in chunk_destinations(later, element_limit):
            if chunk:
                requests.append((origin, chunk))
    return requests


def _route_matrix(
    origin: Building,
    destinations: Sequence[Building],
    key: str,
    timeout: float,
) -> list[dict[str, Any]]:
    import httpx

    body = {
        "origins": [
            {
                "waypoint": {
                    "location": {"latLng": {"latitude": origin.lat, "longitude": origin.lng}}
                }
            }
        ],
        "destinations": [
            {"waypoint": {"location": {"latLng": {"latitude": item.lat, "longitude": item.lng}}}}
            for item in destinations
        ],
        "travelMode": "WALK",
    }
    headers = {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,status",
    }
    last_error: Exception | None = None
    for _attempt in range(config.GOOGLE_HTTP_RETRIES + 1):
        try:
            response = httpx.post(
                config.GOOGLE_ROUTES_MATRIX_URL, json=body, headers=headers, timeout=timeout
            )
            response.raise_for_status()
            payload = response.json()
            return payload if isinstance(payload, list) else payload.get("matches") or []
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    raise PipelineError(f"Routes matrix failed: {last_error}") from last_error


def ceil_minutes(duration_s: float) -> int:
    return math.ceil(duration_s / 60.0)


def parse_only(raw: str) -> tuple[str, str]:
    parts = [part.strip().upper() for part in raw.split(",") if part.strip()]
    if len(parts) != 2:
        raise PipelineError("--only expects exactly two building codes, e.g. MCB,WHI")
    first, second = sorted(parts)
    if first == second:
        raise PipelineError("--only codes must be two distinct buildings")
    return first, second


def fetch_walk_matrix(
    buildings_path: Path,
    output_path: Path,
    *,
    fetch_all: bool,
    only: str | None,
    allow_network: bool,
    dry_run: bool,
    force: bool,
    timeout: float,
    environ: Mapping[str, str] | None = None,
) -> Counts:
    counts = Counts()
    buildings = {
        code: Building.model_validate(raw) for code, raw in load_json(buildings_path).items()
    }
    existing_raw = load_json(output_path) if output_path.exists() else {}
    existing = {key: WalkEntry.model_validate(raw) for key, raw in existing_raw.items()}
    if only:
        pair = parse_only(only)
        wanted = [pair]
        codes = sorted(pair)
        requests = [(codes[0], [codes[1]])]
    elif fetch_all:
        codes = verified_codes(buildings)
        wanted = pair_plan(codes)
        requests = request_plan(codes, element_limit=config.ROUTES_MATRIX_MAX_ELEMENTS)
    else:
        raise PipelineError("specify --all or --only CODEA,CODEB")

    element_count = sum(len(dests) for _, dests in requests)
    print(
        f"request count={len(requests)} route-matrix elements={element_count} pairs={len(wanted)}"
    )
    if dry_run or not allow_network:
        print("dry-run: no network, no write")
        counts.read = len(wanted)
        counts.warned = len(requests)
        return counts

    key = google_api_key(environ)
    if key is None:
        raise PipelineError(
            f"{config.ENV_GOOGLE_MAPS_API_KEY} is not set; "
            "export it in the process environment (the server never reads it)"
        )
    incoming = dict(existing)
    for origin_code, dest_codes in requests:
        origin = buildings[origin_code]
        dest_buildings = [buildings[code] for code in dest_codes]
        print(f"Routes matrix origin={origin_code} destinations={','.join(dest_codes)}")
        rows = _route_matrix(origin, dest_buildings, key, timeout)
        by_dest: dict[int, dict[str, Any]] = {}
        for row in rows:
            dest_index = int(row.get("destinationIndex", 0))
            by_dest[dest_index] = row
        for dest_index, dest_code in enumerate(dest_codes):
            key_name = walk_key(origin_code, dest_code)
            current = incoming.get(key_name)
            if current is not None and current.source == "manual_override" and not force:
                continue
            if current is not None and not force:
                continue
            row = by_dest.get(dest_index)
            if row is None or row.get("status") not in (None, {}, "OK"):
                print(f"failed element {key_name}; leaving absent")
                counts.warned += 1
                continue
            duration = row.get("duration") or {}
            seconds = float(str(duration.get("seconds", duration) or 0).rstrip("s"))
            meters = int(row.get("distanceMeters") or 0)
            incoming[key_name] = WalkEntry.model_validate(
                {
                    "minutes": ceil_minutes(seconds),
                    "meters": meters,
                    "source": "google_routes",
                    "fetched_at": None,
                }
            )
            counts.written += 1
    dump_json(
        output_path,
        {key_name: model_payload(item) for key_name, item in sorted(incoming.items())},
    )
    counts.read = len(wanted)
    counts.files = 1
    return counts


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Optional Google Routes walking matrix")
    parser.add_argument(
        "--buildings",
        type=Path,
        default=config.DEFAULT_DATA_DIR / config.BUILDINGS_FILE,
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=config.DEFAULT_DATA_DIR / config.WALK_MATRIX_FILE,
    )
    parser.add_argument("--all", action="store_true", dest="fetch_all")
    parser.add_argument("--only", default=None, help="exactly one pair, e.g. MCB,WHI")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--allow-network", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--timeout", type=float, default=config.GOOGLE_HTTP_TIMEOUT_SEC)
    args = parser.parse_args(list(argv) if argv is not None else None)
    dry_run = args.dry_run or not args.allow_network
    try:
        counts = fetch_walk_matrix(
            args.buildings,
            args.output,
            fetch_all=args.fetch_all,
            only=args.only,
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
