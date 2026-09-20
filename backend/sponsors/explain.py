"""Grounded Gemini rewrite of an AnalyzeResponse. Never invents numbers.

Off unless HOKIELENS_GEMINI=1 *and* GEMINI_API_KEY is set. Missing keys, timeouts,
and ungrounded model output fall back to a deterministic template. Ask Gemini
chat reuses generate_gemini(); the eight planner routes stay offline.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Any

import httpx

from config import Settings, parse_bool_flag
from data import load_data_context
from models import AnalyzeResponse
from risk import analyze as analyze_schedule
from risk import miss_week_stress
from sponsors import configure_stdio, load_local_env

ENV_GEMINI_KEY = "GEMINI_API_KEY"
ENV_GEMINI_MODEL = "GEMINI_MODEL"
ENV_GEMINI_ENABLE = "HOKIELENS_GEMINI"
DEFAULT_MODEL = "gemini-3.6-flash"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
TIMEOUT_S = 20.0


class GeminiError(Exception):
    """Outbound Gemini call failed. Callers fall back to the template.

    ``reason`` is ``quota`` (HTTP 429), ``timeout``, or ``error``. Never carries text
    from the request or the key.
    """

    def __init__(self, message: str = "gemini call failed", *, reason: str = "error") -> None:
        super().__init__(message)
        self.reason = reason


_NUMBER = re.compile(r"\d+(?:\.\d+)?")

SYSTEM_PROMPT = (
    "You rewrite a HokieLens schedule analysis for a Virginia Tech student. "
    "Use only the facts JSON. Do not add courses, CRNs, scores, minutes, GPA "
    "values, or claims that are not in facts. Do not give advice beyond restating "
    "the analysis. Do not mention being an AI. Output JSON only: "
    '{"headline": string, "cards": [{"title": string, "body": string}]} '
    "with exactly three cards titled Risk, Commute, and Difficulty."
)


def gemini_enabled(environ: dict[str, str] | None = None) -> bool:
    if environ is None:
        load_local_env()
    env = os.environ if environ is None else environ
    flag = parse_bool_flag(ENV_GEMINI_ENABLE, env.get(ENV_GEMINI_ENABLE), default=False)
    key = (env.get(ENV_GEMINI_KEY) or "").strip()
    return flag and bool(key)


def extract_facts(analysis: AnalyzeResponse) -> dict[str, Any]:
    dump = analysis.model_dump(mode="json", by_alias=True)
    warnings = dump.get("commute_warnings") or []
    factors = dump.get("factors") or []
    gpa = dump.get("expected_gpa") or {}
    sections = [
        {
            "crn": section["crn"],
            "course_id": section["course_id"],
            "title": section["title"],
            "credits": section["credits"],
            "instructor": (section.get("instructor_names") or ["TBA"])[0],
        }
        for section in dump["sections"]
    ]
    return {
        "risk_score": dump["risk_score"],
        "sections": sections,
        "factors": [
            {
                "type": factor["type"],
                "severity": factor["severity"],
                "max_severity": factor["max_severity"],
                "detail": factor["detail"],
                "affected_crns": factor["affected_crns"],
            }
            for factor in factors
        ],
        "commute_warnings": [
            {
                "day": item["day"],
                "from_crn": item["from"]["crn"],
                "to_crn": item["to"]["crn"],
                "from_building": item["from"]["building"],
                "to_building": item["to"]["building"],
                "walk_min": item["walk_min"],
                "gap_min": item["gap_min"],
                "verdict": item["verdict"],
                "detail": item["detail"],
            }
            for item in warnings
        ],
        "expected_gpa": {
            "mean": gpa.get("mean"),
            "range": gpa.get("range"),
            "confidence": gpa.get("confidence"),
        },
        "data_notes": list(dump.get("meta", {}).get("data_notes") or []),
        "disclaimer": "Heuristic planning aid, not a prediction of any student's grades.",
    }


def _collect_allowed_numbers(facts: dict[str, Any]) -> set[str]:
    allowed: set[str] = {"0", "100"}
    blob = json.dumps(facts, default=str)
    allowed.update(_NUMBER.findall(blob))
    allowed.add(str(len(facts.get("sections") or [])))
    allowed.add(str(len(facts.get("commute_warnings") or [])))
    return allowed


def _numbers_grounded(text: str, allowed: set[str]) -> bool:
    for token in _NUMBER.findall(text):
        if token in allowed:
            continue
        try:
            value = float(token)
        except ValueError:
            return False
        if any(abs(value - float(item)) < 1e-9 for item in allowed):
            continue
        return False
    return True


def _risk_band(score: int) -> str:
    if score < 25:
        return "light"
    if score <= 45:
        return "moderate"
    if score <= 65:
        return "heavy"
    return "very heavy"


def render_template(facts: dict[str, Any]) -> dict[str, Any]:
    score = int(facts["risk_score"])
    sections = facts["sections"]
    warnings = facts["commute_warnings"]
    factors = facts["factors"]
    gpa = facts["expected_gpa"]
    course_bits = ", ".join(f"{row['course_id']} ({row['crn']})" for row in sections)
    if warnings:
        commute_bits = "; ".join(
            (
                f"{item['verdict']} {item['from_building']}->{item['to_building']} "
                f"on {item['day']}: {item['walk_min']} min walk, {item['gap_min']} min gap"
            )
            for item in warnings
        )
        commute = f"{len(warnings)} commute warning(s). {commute_bits}."
    else:
        commute = "No tight or impossible walks between these meetings."
    top = max(factors, key=lambda row: float(row["severity"])) if factors else None
    if top and float(top["severity"]) > 0:
        difficulty = (
            f"Largest factor is {top['type']} at {top['severity']} of "
            f"{top['max_severity']}. {top['detail']}"
        )
    else:
        difficulty = "No factor is contributing severity on this schedule."
    mean = gpa.get("mean")
    gpa_bit = f" Catalog GPA mean {mean}." if mean is not None else ""
    headline = f"This schedule scores {score} out of 100 - a {_risk_band(score)} week."
    return {
        "headline": headline,
        "cards": [
            {
                "title": "Risk",
                "body": f"{headline} Courses: {course_bits}.{gpa_bit}",
            },
            {"title": "Commute", "body": commute},
            {"title": "Difficulty", "body": difficulty},
        ],
        "disclaimer": facts["disclaimer"],
    }


def _parse_model_json(text: str) -> dict[str, Any] | None:
    raw = text.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE).strip()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    headline = payload.get("headline")
    cards = payload.get("cards")
    if not isinstance(headline, str) or not headline.strip():
        return None
    if not isinstance(cards, list) or len(cards) != 3:
        return None
    cleaned: list[dict[str, str]] = []
    for card in cards:
        if not isinstance(card, dict):
            return None
        title = card.get("title")
        body = card.get("body")
        if not isinstance(title, str) or not isinstance(body, str):
            return None
        if not title.strip() or not body.strip():
            return None
        cleaned.append({"title": title.strip(), "body": body.strip()})
    expected = {"Risk", "Commute", "Difficulty"}
    if {card["title"] for card in cleaned} != expected:
        return None
    return {"headline": headline.strip(), "cards": cleaned}


def generate_gemini(
    *,
    system: str,
    user: str,
    key: str,
    model: str,
    json_mode: bool = False,
    max_output_tokens: int = 2048,
) -> str:
    """POST to Gemini generateContent. The key travels in a header only; never logged."""
    url = GEMINI_URL.format(model=model)
    config: dict[str, Any] = {
        "temperature": 0.1,
        "maxOutputTokens": max_output_tokens,
    }
    if json_mode:
        config["responseMimeType"] = "application/json"
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": config,
    }
    headers = {"x-goog-api-key": key, "content-type": "application/json"}
    try:
        with httpx.Client(timeout=TIMEOUT_S) as client:
            response = client.post(url, headers=headers, json=body)
            response.raise_for_status()
            payload = response.json()
        parts = payload.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        texts = [part.get("text", "") for part in parts if isinstance(part, dict)]
        return "\n".join(texts).strip()
    except httpx.HTTPStatusError as exc:
        reason = "quota" if exc.response.status_code == 429 else "error"
        raise GeminiError("gemini call failed", reason=reason) from None
    except httpx.TimeoutException:
        raise GeminiError("gemini call failed", reason="timeout") from None
    except (
        httpx.HTTPError,
        OSError,
        ValueError,
        KeyError,
        TypeError,
        IndexError,
        AttributeError,
    ) as exc:
        raise GeminiError("gemini call failed") from exc


def call_gemini(facts: dict[str, Any], *, key: str, model: str) -> str:
    return generate_gemini(
        system=SYSTEM_PROMPT,
        user=json.dumps(facts, sort_keys=True),
        key=key,
        model=model,
        json_mode=True,
    )


def explain_analysis(
    analysis: AnalyzeResponse,
    *,
    allow_network: bool = False,
    environ: dict[str, str] | None = None,
) -> dict[str, Any]:
    if environ is None:
        load_local_env()
    env = dict(os.environ if environ is None else environ)
    facts = extract_facts(analysis)
    template = render_template(facts)
    key = (env.get(ENV_GEMINI_KEY) or "").strip()
    configured = bool(key) and parse_bool_flag(
        ENV_GEMINI_ENABLE, env.get(ENV_GEMINI_ENABLE), default=False
    )
    result = {
        **template,
        "source": "template",
        "gemini_configured": configured,
        "fallback_reason": None,
    }
    if not allow_network or not configured:
        if allow_network and not configured:
            result["fallback_reason"] = "gemini_disabled"
        return result
    model = (env.get(ENV_GEMINI_MODEL) or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    try:
        raw = call_gemini(facts, key=key, model=model)
    except GeminiError:
        result["fallback_reason"] = "gemini_unavailable"
        return result
    parsed = _parse_model_json(raw)
    if parsed is None:
        result["fallback_reason"] = "ungrounded"
        return result
    allowed = _collect_allowed_numbers(facts)
    blob = parsed["headline"] + " " + " ".join(card["body"] for card in parsed["cards"])
    if not _numbers_grounded(blob, allowed):
        result["fallback_reason"] = "ungrounded"
        return result
    return {
        "headline": parsed["headline"],
        "cards": parsed["cards"],
        "disclaimer": facts["disclaimer"],
        "source": "gemini",
        "gemini_configured": True,
        "fallback_reason": None,
    }


def _load_fixture_analysis(name: str) -> AnalyzeResponse:
    settings = Settings()
    ctx = load_data_context(settings)
    demo = ctx.demo_schedules
    if name == "easy":
        crns = list(demo.easy.crns)
    elif name == "brutal":
        crns = list(demo.brutal.crns)
    else:
        raise ValueError(f"unknown fixture {name!r}; use easy or brutal")
    sections = [ctx.sections_by_crn[crn] for crn in crns]
    return analyze_schedule(sections, ctx)


def _load_stress() -> tuple[AnalyzeResponse, dict[str, Any]]:
    settings = Settings()
    ctx = load_data_context(settings)
    crns = list(ctx.demo_schedules.easy.crns)
    sections = [ctx.sections_by_crn[crn] for crn in crns]
    analysis = analyze_schedule(sections, ctx)
    stressed = miss_week_stress(analysis, sections, ctx, 8)
    extra = {
        "original_risk": stressed.original_risk,
        "stressed_risk": stressed.stressed_risk,
        "delta": stressed.delta,
    }
    return analysis, extra


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Explain a HokieLens analysis")
    parser.add_argument("--fixture", choices=("easy", "brutal"), default="easy")
    parser.add_argument(
        "--gemini",
        action="store_true",
        help="call Gemini if HOKIELENS_GEMINI=1 and GEMINI_API_KEY are set",
    )
    parser.add_argument("--stress", action="store_true", help="also print week-8 stress")
    args = parser.parse_args(argv)
    configure_stdio()
    load_local_env()
    analysis = _load_fixture_analysis(args.fixture)
    payload = explain_analysis(analysis, allow_network=args.gemini)
    print(json.dumps(payload, indent=2, sort_keys=True))
    if args.stress:
        _, extra = _load_stress()
        extra["note"] = (
            f"Missing week 8 moves easy from {extra['original_risk']} to "
            f"{extra['stressed_risk']} (delta {extra['delta']})."
        )
        print(json.dumps(extra, indent=2, sort_keys=True))
    if args.gemini and payload["source"] != "gemini":
        reason = payload.get("fallback_reason") or "gemini_disabled"
        print(f"Gemini not used ({reason})", file=sys.stderr)
        if reason == "gemini_disabled":
            print(
                f"Set {ENV_GEMINI_ENABLE}=1 and {ENV_GEMINI_KEY} to enable.",
                file=sys.stderr,
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
