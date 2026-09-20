"""Export calibrated HokieLens analyses as tables for a Databricks demo.

Uses the same ``risk.analyze`` path as the API. Does not recompute scores.
Writes CSV + JSON under ``sponsors/databricks/``. Offline; no Spark required.
"""

from __future__ import annotations

import argparse
import csv
import json
from io import StringIO
from pathlib import Path
from typing import Any

from config import Settings
from data import load_data_context
from models import AnalyzeResponse, Section
from risk import analyze as analyze_schedule
from risk import miss_week_stress
from sponsors import configure_stdio

DATABRICKS_DIR = Path(__file__).resolve().parent / "databricks"
SCHEDULES_CSV = DATABRICKS_DIR / "schedules.csv"
FACTORS_CSV = DATABRICKS_DIR / "factors.csv"
WARNINGS_CSV = DATABRICKS_DIR / "commute_warnings.csv"
IMPACT_JSON = DATABRICKS_DIR / "impact.json"

SCHEDULE_COLUMNS = [
    "schedule_id",
    "label",
    "scenario",
    "risk_score",
    "stressed_risk",
    "delta",
    "gpa_mean",
    "gpa_lo",
    "gpa_hi",
    "n_sections",
    "n_tight",
    "n_impossible",
    "credits",
]
FACTOR_COLUMNS = [
    "schedule_id",
    "scenario",
    "factor_type",
    "severity",
    "max_severity",
    "detail",
    "affected_crns",
]
WARNING_COLUMNS = [
    "schedule_id",
    "scenario",
    "day",
    "from_crn",
    "to_crn",
    "from_building",
    "to_building",
    "walk_min",
    "gap_min",
    "verdict",
]


def _gpa_fields(analysis: AnalyzeResponse) -> tuple[str, str, str]:
    gpa = analysis.expected_gpa
    mean = "" if gpa.mean is None else f"{gpa.mean:.2f}"
    if gpa.range is None:
        return mean, "", ""
    return mean, f"{gpa.range[0]:.2f}", f"{gpa.range[1]:.2f}"


def _credits(sections: list[Section]) -> str:
    total = sum(section.credits for section in sections)
    if float(total).is_integer():
        return str(int(total))
    return f"{total:.1f}"


def _schedule_row(
    schedule_id: str,
    label: str,
    scenario: str,
    analysis: AnalyzeResponse,
    sections: list[Section],
    *,
    stressed_risk: int | None = None,
    delta: int | None = None,
) -> dict[str, Any]:
    mean, lo, hi = _gpa_fields(analysis)
    tight = sum(1 for item in analysis.commute_warnings if item.verdict == "tight")
    impossible = sum(1 for item in analysis.commute_warnings if item.verdict == "impossible")
    score = analysis.risk_score
    stressed = score if stressed_risk is None else stressed_risk
    dlt = 0 if delta is None else delta
    return {
        "schedule_id": schedule_id,
        "label": label,
        "scenario": scenario,
        "risk_score": score,
        "stressed_risk": stressed,
        "delta": dlt,
        "gpa_mean": mean,
        "gpa_lo": lo,
        "gpa_hi": hi,
        "n_sections": len(sections),
        "n_tight": tight,
        "n_impossible": impossible,
        "credits": _credits(sections),
    }


def _factor_rows(
    schedule_id: str, scenario: str, analysis: AnalyzeResponse
) -> list[dict[str, Any]]:
    rows = []
    for factor in analysis.factors:
        rows.append(
            {
                "schedule_id": schedule_id,
                "scenario": scenario,
                "factor_type": factor.type,
                "severity": f"{factor.severity:.1f}",
                "max_severity": f"{factor.max_severity:.1f}",
                "detail": factor.detail,
                "affected_crns": "|".join(factor.affected_crns),
            }
        )
    return rows


def _warning_rows(
    schedule_id: str, scenario: str, analysis: AnalyzeResponse
) -> list[dict[str, Any]]:
    rows = []
    for item in analysis.commute_warnings:
        rows.append(
            {
                "schedule_id": schedule_id,
                "scenario": scenario,
                "day": item.day,
                "from_crn": item.from_.crn,
                "to_crn": item.to.crn,
                "from_building": item.from_.building,
                "to_building": item.to.building,
                "walk_min": item.walk_min,
                "gap_min": item.gap_min,
                "verdict": item.verdict,
            }
        )
    return rows


def build_impact(settings: Settings | None = None) -> dict[str, Any]:
    ctx = load_data_context(settings or Settings())
    demo = ctx.demo_schedules
    schedules: list[dict[str, Any]] = []
    factors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    def add(
        schedule_id: str,
        label: str,
        scenario: str,
        crns: list[str],
        *,
        stress_week: int | None = None,
    ) -> AnalyzeResponse:
        sections = [ctx.sections_by_crn[crn] for crn in crns]
        analysis = analyze_schedule(sections, ctx)
        stressed_risk = None
        delta = None
        if stress_week is not None:
            stressed = miss_week_stress(analysis, sections, ctx, stress_week)
            stressed_risk = stressed.stressed_risk
            delta = stressed.delta
        schedules.append(
            _schedule_row(
                schedule_id,
                label,
                scenario,
                analysis,
                sections,
                stressed_risk=stressed_risk,
                delta=delta,
            )
        )
        factors.extend(_factor_rows(schedule_id, scenario, analysis))
        warnings.extend(_warning_rows(schedule_id, scenario, analysis))
        return analysis

    add("easy", demo.easy.label, "analyze", list(demo.easy.crns))
    add("brutal", demo.brutal.label, "analyze", list(demo.brutal.crns))
    add(
        "easy",
        demo.easy.label,
        "miss_week_8",
        list(demo.easy.crns),
        stress_week=8,
    )

    swap = demo.swap_demo
    before_crns = list(swap.current_crns)
    after_crns = [swap.add_crn if crn == swap.drop_crn else crn for crn in before_crns]
    before = add("swap", "swap_demo before", "swap_before", before_crns)
    after = add("swap", "swap_demo after", "swap_after", after_crns)
    # Overlay the true swap delta on the after row (after - before).
    schedules[-1]["delta"] = after.risk_score - before.risk_score
    schedules[-1]["stressed_risk"] = after.risk_score

    return {"schedules": schedules, "factors": factors, "warnings": warnings}


def _csv_text(rows: list[dict[str, Any]], columns: list[str]) -> str:
    buf = StringIO()
    writer = csv.DictWriter(buf, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: row[key] for key in columns})
    return buf.getvalue()


def write_impact(payload: dict[str, Any] | None = None) -> dict[str, Path]:
    data = payload if payload is not None else build_impact()
    DATABRICKS_DIR.mkdir(parents=True, exist_ok=True)
    files = {
        "schedules": SCHEDULES_CSV,
        "factors": FACTORS_CSV,
        "warnings": WARNINGS_CSV,
        "json": IMPACT_JSON,
    }
    SCHEDULES_CSV.write_text(
        _csv_text(data["schedules"], SCHEDULE_COLUMNS), encoding="utf-8", newline="\n"
    )
    FACTORS_CSV.write_text(
        _csv_text(data["factors"], FACTOR_COLUMNS), encoding="utf-8", newline="\n"
    )
    WARNINGS_CSV.write_text(
        _csv_text(data["warnings"], WARNING_COLUMNS), encoding="utf-8", newline="\n"
    )
    IMPACT_JSON.write_text(
        json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n"
    )
    return files


def story_lines(payload: dict[str, Any] | None = None) -> list[str]:
    data = payload if payload is not None else build_impact()
    by_key = {(row["schedule_id"], row["scenario"]): row for row in data["schedules"]}
    easy = by_key[("easy", "analyze")]
    brutal = by_key[("brutal", "analyze")]
    stress = by_key[("easy", "miss_week_8")]
    before = by_key[("swap", "swap_before")]
    after = by_key[("swap", "swap_after")]
    return [
        "HokieLens student-success impact (calibrated synthetic catalog)",
        (
            f"  Balanced week:     risk {easy['risk_score']}, "
            f"{easy['n_impossible']} impossible walks, GPA mean {easy['gpa_mean'] or 'n/a'}"
        ),
        (
            f"  Wall-of-pain week: risk {brutal['risk_score']}, "
            f"{brutal['n_impossible']} impossible / {brutal['n_tight']} tight walks"
        ),
        (
            f"  One section swap:  {before['risk_score']} -> {after['risk_score']} "
            f"(delta {after['delta']})"
        ),
        (
            f"  Miss week 8:       {stress['risk_score']} -> {stress['stressed_risk']} "
            f"(delta {stress['delta']})"
        ),
        (
            "  Story: registration says these CRNs can be taken together; "
            "the same catalog shows the commute and difficulty cost."
        ),
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export HokieLens impact tables")
    parser.add_argument("--write", action="store_true", help="rewrite CSV/JSON files")
    args = parser.parse_args(argv)
    configure_stdio()
    payload = build_impact()
    for line in story_lines(payload):
        print(line)
    if args.write:
        write_impact(payload)
        print(f"wrote {DATABRICKS_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
