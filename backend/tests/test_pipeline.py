"""Focused pipeline tests (PRD 8). Sample inputs are committed and offline."""

from __future__ import annotations

import ast
import json
import sys
from pathlib import Path

import config
from data import load_data_context
from models import GradeRecord, RmpEntry, Section
from risk import professor_vibes
from scripts.build_rmp import main as rmp_main
from scripts.build_rmp import merge_rmp, parse_rmp_text
from scripts.build_sections import (
    build_sections,
    parse_clock,
    parse_days,
)
from scripts.build_sections import (
    main as sections_main,
)
from scripts.common import PipelineError
from scripts.fetch_buildings import main as buildings_main
from scripts.fetch_walk_matrix import main as walk_main
from scripts.fetch_walk_matrix import request_plan
from scripts.parse_udc import main as udc_main
from scripts.parse_udc import parse_udc_dir, parse_udc_text, write_grade_records
from tests.conftest import Dataset

PIPELINE = config.DEFAULT_FIXTURES_DIR / "pipeline"


def test_scripts_import_is_inert() -> None:
    assert "dotenv" not in sys.modules
    import scripts.build_rmp as _build_rmp
    import scripts.build_sections as _build_sections
    import scripts.fetch_buildings as _fetch_buildings
    import scripts.fetch_walk_matrix as _fetch_walk
    import scripts.parse_udc as _parse_udc

    assert _build_rmp.__name__ and _build_sections.__name__
    assert _fetch_buildings.__name__ and _fetch_walk.__name__ and _parse_udc.__name__
    assert "dotenv" not in sys.modules


def test_parse_udc_happy_path_and_byte_stable(tmp_path: Path) -> None:
    from scripts.common import Counts

    counts = Counts()
    text = (PIPELINE / "udc" / "grades.txt").read_text(encoding="utf-8")
    records = parse_udc_text(text, filename="grades.txt", synthetic=True, counts=counts)
    assert len(records) == 2
    assert {rec.instructor for rec in records} == {"lovelace"}
    assert {rec.academic_year for rec in records} == {"2025-26", "2024-25"}
    assert records[0].meta.source == config.SYNTHETIC_SOURCE
    first = tmp_path / "a.json"
    second = tmp_path / "b.json"
    write_grade_records(first, records)
    write_grade_records(second, records)
    assert first.read_bytes() == second.read_bytes()
    GradeRecord.model_validate(json.loads(first.read_text(encoding="utf-8"))[0])


def test_parse_udc_skips_malformed_and_is_deterministic(tmp_path: Path) -> None:
    src = tmp_path / "udc"
    src.mkdir()
    (src / "malformed.txt").write_text(
        (PIPELINE / "udc" / "malformed.txt").read_text(encoding="utf-8"), encoding="utf-8"
    )
    records, counts = parse_udc_dir(src, synthetic=False)
    assert len(records) == 1
    assert records[0].instructor == "turing"
    assert records[0].meta.source == config.UDC_SOURCE
    assert counts.extras.get("malformed", 0) >= 1
    out1 = tmp_path / "one.json"
    out2 = tmp_path / "two.json"
    assert udc_main(["--input-dir", str(src), "--output", str(out1)]) == 0
    assert udc_main(["--input-dir", str(src), "--output", str(out2)]) == 0
    assert out1.read_bytes() == out2.read_bytes()


def test_parse_udc_conflicting_duplicate_is_fatal(tmp_path: Path) -> None:
    src = tmp_path / "udc"
    src.mkdir()
    row = (
        "2025-26\tFall\tCS\t3114\tData Structures and Algorithms\tAda Lovelace\t3.20\t"
        "30\t15\t12\t18\t8\t6\t5\t3\t1\t1\t0.5\t0.5\t4\t80\t83111\t3\n"
    )
    conflict = row.replace("3.20", "2.00")
    (src / "dup.txt").write_text(row + conflict, encoding="utf-8")
    assert udc_main(["--input-dir", str(src), "--output", str(tmp_path / "out.json")]) == 1


def test_parse_udc_output_loads_strict(dataset: Dataset, tmp_path: Path) -> None:
    out = tmp_path / "grade_records.json"
    assert (
        udc_main(
            [
                "--input-dir",
                str(PIPELINE / "udc"),
                "--output",
                str(out),
                "--synthetic",
            ]
        )
        == 0
    )
    (dataset.data_dir / config.GRADE_RECORDS_FILE).write_bytes(out.read_bytes())
    ctx = load_data_context(dataset.settings())
    assert ctx.stats.grade_records >= 1


def test_day_and_time_normalization() -> None:
    assert parse_days("TTh") == ["T", "R"]
    assert parse_days("MWF") == ["M", "W", "F"]
    assert parse_days("Th") == ["R"]
    assert parse_clock("10:10 AM") == 610
    assert parse_clock("1:00 PM") == 780
    assert parse_clock("14:30") == 870
    try:
        parse_clock("10:10")
        raise AssertionError("ambiguous 12-hour time must fail")
    except ValueError as exc:
        assert "ambiguous" in str(exc)


def test_build_sections_happy_path_strict_loader(dataset: Dataset, tmp_path: Path) -> None:
    out = tmp_path / "sections.json"
    assert (
        sections_main(
            [
                "--input-dir",
                str(PIPELINE / "sections"),
                "--output",
                str(out),
                "--buildings",
                str(dataset.data_dir / config.BUILDINGS_FILE),
                "--term-id",
                config.DEFAULT_CATALOG_TERM_ID,
            ]
        )
        == 0
    )
    again = tmp_path / "sections2.json"
    assert (
        sections_main(
            [
                "--input-dir",
                str(PIPELINE / "sections"),
                "--output",
                str(again),
                "--buildings",
                str(dataset.data_dir / config.BUILDINGS_FILE),
            ]
        )
        == 0
    )
    assert out.read_bytes() == again.read_bytes()
    payload = json.loads(out.read_text(encoding="utf-8"))
    assert [item["crn"] for item in payload] == ["91001", "91002", "91003"]
    assert payload[1]["meetings"][0]["days"] == ["T", "R"]
    assert payload[1]["meetings"][0]["building"] is None
    assert payload[2]["meetings"] == []
    Section.model_validate(payload[0])

    (dataset.data_dir / config.SECTIONS_FILE).write_bytes(out.read_bytes())
    crns = ["91001", "91002", "91003"]
    dataset.save_fixture("schedule_easy.json", {"crns": crns[:2], "label": "pipeline easy"})
    dataset.save_fixture("schedule_brutal.json", {"crns": crns, "label": "pipeline brutal"})
    dataset.save_fixture(
        "swap_demo.json",
        {"current_crns": crns[:2], "drop_crn": crns[0], "add_crn": crns[2]},
    )
    ctx = load_data_context(dataset.settings())
    assert set(ctx.sections_by_crn) == set(crns)


def test_build_sections_duplicate_crn_and_unknown_building(
    dataset: Dataset, tmp_path: Path
) -> None:
    src = tmp_path / "sections"
    src.mkdir()
    sample = (PIPELINE / "sections" / "sample.yaml").read_text(encoding="utf-8")
    (src / "dup.yaml").write_text(sample + sample, encoding="utf-8")
    assert (
        sections_main(
            [
                "--input-dir",
                str(src),
                "--output",
                str(tmp_path / "out.json"),
                "--buildings",
                str(dataset.data_dir / config.BUILDINGS_FILE),
            ]
        )
        == 1
    )
    bad = tmp_path / "bad"
    bad.mkdir()
    (bad / "unknown.yaml").write_text(
        """
- crn: "91009"
  course_id: "CS 1114"
  title: "X"
  credits: 3
  instructor_names: ["Ada Lovelace"]
  modality: f2f
  seats_max: 10
  seats_available: 1
  meetings:
    - days: M
      start: "9:00 AM"
      end: "10:00 AM"
      building: ZZZ
      start_date: "2026-08-24"
      end_date: "2026-12-09"
""",
        encoding="utf-8",
    )
    assert (
        sections_main(
            [
                "--input-dir",
                str(bad),
                "--output",
                str(tmp_path / "out2.json"),
                "--buildings",
                str(dataset.data_dir / config.BUILDINGS_FILE),
            ]
        )
        == 1
    )


def test_build_sections_instructor_collision_is_fatal(dataset: Dataset, tmp_path: Path) -> None:
    src = tmp_path / "sections"
    src.mkdir()
    (src / "collision.yaml").write_text(
        """
- crn: "91011"
  course_id: "CS 1114"
  title: "A"
  credits: 3
  instructor_names: ["Ada Lovelace"]
  modality: online_async
  seats_max: 10
  seats_available: 1
  meetings: []
- crn: "91012"
  course_id: "CS 2114"
  title: "B"
  credits: 3
  instructor_names: ["Linda Lovelace"]
  modality: online_async
  seats_max: 10
  seats_available: 1
  meetings: []
""",
        encoding="utf-8",
    )
    try:
        build_sections(
            src,
            buildings_path=dataset.data_dir / config.BUILDINGS_FILE,
            term_id=config.DEFAULT_CATALOG_TERM_ID,
        )
        raise AssertionError("collision must be fatal in the pipeline")
    except PipelineError as exc:
        assert "lovelace" in str(exc)


def test_build_rmp_happy_path_collision_and_vibes(dataset: Dataset, tmp_path: Path) -> None:
    out = tmp_path / "rmp.json"
    assert rmp_main(["--input-dir", str(PIPELINE / "rmp"), "--output", str(out)]) == 0
    again = tmp_path / "rmp2.json"
    assert rmp_main(["--input-dir", str(PIPELINE / "rmp"), "--output", str(again)]) == 0
    assert out.read_bytes() == again.read_bytes()
    payload = json.loads(out.read_text(encoding="utf-8"))
    assert list(payload) == ["hopper", "lovelace"]
    RmpEntry.model_validate(payload["lovelace"])
    (dataset.data_dir / config.RMP_FILE).write_bytes(out.read_bytes())
    ctx = load_data_context(dataset.settings())
    vibes = professor_vibes(ctx, "Ada Lovelace")
    assert vibes is not None
    assert vibes.instructor == "lovelace"
    assert vibes.rmp is not None
    assert vibes.rmp.difficulty == payload["lovelace"]["difficulty"]

    same = parse_rmp_text(
        (PIPELINE / "rmp" / "sample.txt").read_text(encoding="utf-8"),
        filename="sample.txt",
        synthetic=False,
    )
    merged = merge_rmp(list(same) + list(same))
    assert set(merged) == {"hopper", "lovelace"}


def test_build_rmp_conflicting_key_is_fatal(tmp_path: Path) -> None:
    src = tmp_path / "rmp"
    src.mkdir()
    (src / "a.txt").write_text(
        "NAME: Ada Lovelace\nscore: 4.4\ndifficulty: 3.6\nn_reviews: 1\n",
        encoding="utf-8",
    )
    (src / "b.txt").write_text(
        "NAME: Linda Lovelace\nscore: 1.0\ndifficulty: 1.0\nn_reviews: 1\n",
        encoding="utf-8",
    )
    assert rmp_main(["--input-dir", str(src), "--output", str(tmp_path / "out.json")]) == 1


def test_google_scripts_default_to_dry_run(tmp_path: Path, monkeypatch, capsys) -> None:
    monkeypatch.setenv(config.ENV_GOOGLE_MAPS_API_KEY, "super-secret-key")
    seed = PIPELINE / "seed" / "buildings_seed.json"
    out = tmp_path / "buildings.json"
    assert buildings_main(["--seed", str(seed), "--output", str(out)]) == 0
    assert not out.exists()
    captured = capsys.readouterr()
    assert "dry-run" in captured.out
    assert "super-secret-key" not in captured.out
    assert "super-secret-key" not in captured.err

    monkeypatch.delenv(config.ENV_GOOGLE_MAPS_API_KEY, raising=False)
    assert buildings_main(["--allow-network", "--seed", str(seed), "--output", str(out)]) == 1
    err = capsys.readouterr().err
    assert config.ENV_GOOGLE_MAPS_API_KEY in err
    assert not out.exists()

    buildings = tmp_path / "b.json"
    buildings.write_text(
        json.dumps(
            {
                "MCB": {
                    "name": "McBryde Hall",
                    "lat": 37.2293,
                    "lng": -80.4232,
                    "verified": True,
                    "source": "manual_fix",
                    "place_id": None,
                    "address": None,
                    "fetched_at": None,
                },
                "WHI": {
                    "name": "Whittemore Hall",
                    "lat": 37.2311,
                    "lng": -80.4245,
                    "verified": True,
                    "source": "manual_fix",
                    "place_id": None,
                    "address": None,
                    "fetched_at": None,
                },
            }
        ),
        encoding="utf-8",
    )
    walk_out = tmp_path / "walk.json"
    assert walk_main(["--buildings", str(buildings), "--output", str(walk_out), "--all"]) == 0
    assert not walk_out.exists()
    assert "request count=" in capsys.readouterr().out
    plan = request_plan(["MCB", "TORG", "WHI"], element_limit=1)
    assert plan[0][0] == "MCB"
    assert all(len(dests) == 1 for _, dests in plan)


def test_server_does_not_import_scripts() -> None:
    import config as config_mod
    import data as data_mod
    import main
    import models as models_mod
    import risk as risk_mod
    import schedule as schedule_mod
    import stub_analyze as stub_mod

    blocked = ("scripts", "dotenv", "httpx", "requests", "urllib.request")
    for module in (main, data_mod, risk_mod, schedule_mod, stub_mod, models_mod, config_mod):
        tree = ast.parse(Path(module.__file__).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            names: list[str] = []
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            for name in names:
                assert not any(
                    name == banned or name.startswith(f"{banned}.") for banned in blocked
                ), f"{module.__file__} imports {name}"


def test_committed_catalog_is_reproduced_by_pipeline(tmp_path: Path) -> None:
    grades_out = tmp_path / "grade_records.json"
    sections_out = tmp_path / "sections.json"
    rmp_out = tmp_path / "rmp.json"
    assert (
        udc_main(
            ["--input-dir", str(config.RAW_UDC_DIR), "--output", str(grades_out), "--synthetic"]
        )
        == 0
    )
    assert (
        sections_main(
            [
                "--input-dir",
                str(config.RAW_SECTIONS_DIR),
                "--buildings",
                str(config.DEFAULT_DATA_DIR / config.BUILDINGS_FILE),
                "--term-id",
                config.DEFAULT_CATALOG_TERM_ID,
                "--output",
                str(sections_out),
            ]
        )
        == 0
    )
    assert (
        rmp_main(
            [
                "--input-dir",
                str(config.RAW_RMP_DIR),
                "--output",
                str(rmp_out),
                "--synthetic",
                "--force",
            ]
        )
        == 0
    )

    def lf(path: Path) -> bytes:
        return path.read_bytes().replace(b"\r\n", b"\n")

    assert lf(grades_out) == lf(config.DEFAULT_DATA_DIR / config.GRADE_RECORDS_FILE)
    assert lf(sections_out) == lf(config.DEFAULT_DATA_DIR / config.SECTIONS_FILE)
    assert lf(rmp_out) == lf(config.DEFAULT_DATA_DIR / config.RMP_FILE)
