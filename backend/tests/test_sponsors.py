"""Sponsor-layer tests. Core eight-route contract and fixture scores must not move."""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

import config
from config import Settings
from main import create_app
from models import AnalyzeResponse
from risk import analyze as analyze_schedule
from sponsors.explain import call_gemini, explain_analysis, extract_facts, render_template
from sponsors.gateway import create_gateway
from sponsors.identity import agent_card_payload, dns_txt_record, public_base_url
from sponsors.impact import (
    FACTOR_COLUMNS,
    FACTORS_CSV,
    IMPACT_JSON,
    SCHEDULE_COLUMNS,
    SCHEDULES_CSV,
    WARNING_COLUMNS,
    WARNINGS_CSV,
    _csv_text,
    build_impact,
    story_lines,
)
from tests.test_api import EIGHT_ENDPOINTS


@pytest.fixture
def strict_client() -> TestClient:
    with TestClient(create_app(Settings())) as client:
        yield client


@pytest.fixture
def gateway_client() -> TestClient:
    with TestClient(create_gateway(Settings())) as client:
        yield client


def test_openapi_still_exactly_eight_api_routes(strict_client: TestClient) -> None:
    spec = strict_client.get("/openapi.json").json()
    documented = {
        (method, path)
        for path, methods in spec["paths"].items()
        for method in methods
        if path.startswith("/api/")
    }
    assert documented == EIGHT_ENDPOINTS
    assert "/.well-known/agent-card.json" not in spec["paths"]
    assert "/api/explain" not in spec["paths"]
    assert "/api/chat" not in spec["paths"]
    assert "/api/chat/status" not in spec["paths"]


def test_ans_well_known_is_public_and_keyless(strict_client: TestClient) -> None:
    card = strict_client.get("/.well-known/agent-card.json").json()
    alias = strict_client.get("/.well-known/ans/agent.json").json()
    registration = strict_client.get("/.well-known/ans/registration.json").json()
    assert card == alias
    assert card["agentDisplayName"] == "HokieLens"
    assert card["version"] == "0.1.0"
    assert card["endpoints"][0]["protocol"] == "HTTP-API"
    assert "__PUBLIC_BASE__" not in json.dumps(card)
    assert registration["agentDisplayName"] == "HokieLens"
    assert "identityCsrPEM" not in registration


def test_ans_card_rewrites_public_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOKIELENS_PUBLIC_URL", "https://hokielens.example")
    card = agent_card_payload()
    assert card["agentHost"] == "hokielens.example"
    assert card["endpoints"][0]["agentUrl"] == "https://hokielens.example/api"
    txt = dns_txt_record()
    assert "hokielens.example" in txt
    assert "v=ansv2" in txt
    assert public_base_url() == "https://hokielens.example"


def test_explain_template_uses_only_analysis_facts() -> None:
    with TestClient(create_app(Settings())) as client:
        ctx = client.app.state.ctx
        crns = list(ctx.demo_schedules.easy.crns)
        sections = [ctx.sections_by_crn[crn] for crn in crns]
        analysis = analyze_schedule(sections, ctx)
    payload = explain_analysis(analysis, allow_network=False)
    assert payload["source"] == "template"
    assert payload["gemini_configured"] is False
    assert str(analysis.risk_score) in payload["headline"]
    facts = extract_facts(analysis)
    for section in facts["sections"]:
        assert section["course_id"] in payload["cards"][0]["body"]


def test_explain_rejects_ungrounded_gemini(monkeypatch: pytest.MonkeyPatch) -> None:
    with TestClient(create_app(Settings())) as client:
        ctx = client.app.state.ctx
        crns = list(ctx.demo_schedules.easy.crns)
        analysis = analyze_schedule([ctx.sections_by_crn[crn] for crn in crns], ctx)

    def fake_gemini(*_args: Any, **_kwargs: Any) -> str:
        return json.dumps(
            {
                "headline": "This schedule scores 999 out of 100.",
                "cards": [
                    {"title": "Risk", "body": "Invented score 999."},
                    {"title": "Commute", "body": "Invented 88 minute walk."},
                    {"title": "Difficulty", "body": "Made-up PHYS 9999."},
                ],
            }
        )

    monkeypatch.setattr("sponsors.explain.call_gemini", fake_gemini)
    env = {"HOKIELENS_GEMINI": "1", "GEMINI_API_KEY": "not-a-real-key"}
    payload = explain_analysis(analysis, allow_network=True, environ=env)
    assert payload["source"] == "template"
    assert payload["fallback_reason"] == "ungrounded"
    assert "999" not in payload["headline"]


def test_explain_accepts_grounded_gemini(monkeypatch: pytest.MonkeyPatch) -> None:
    with TestClient(create_app(Settings())) as client:
        ctx = client.app.state.ctx
        crns = list(ctx.demo_schedules.easy.crns)
        analysis = analyze_schedule([ctx.sections_by_crn[crn] for crn in crns], ctx)
    facts = extract_facts(analysis)
    template = render_template(facts)

    def fake_gemini(*_args: Any, **_kwargs: Any) -> str:
        return json.dumps(
            {
                "headline": template["headline"],
                "cards": template["cards"],
            }
        )

    monkeypatch.setattr("sponsors.explain.call_gemini", fake_gemini)
    env = {"HOKIELENS_GEMINI": "1", "GEMINI_API_KEY": "not-a-real-key"}
    payload = explain_analysis(analysis, allow_network=True, environ=env)
    assert payload["source"] == "gemini"
    assert payload["fallback_reason"] is None
    assert payload["headline"] == template["headline"]


def test_call_gemini_is_not_used_in_default_tests() -> None:
    # Guard: importing explain must not open sockets; the autouse blocker
    # would fail this module if call_gemini ran at import.
    assert callable(call_gemini)


def test_gateway_explain_defaults_to_template(gateway_client: TestClient) -> None:
    demo = gateway_client.get("/api/demo/schedules").json()
    response = gateway_client.post("/api/explain", json={"crns": demo["easy"]["crns"]})
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "template"
    assert len(body["cards"]) == 3
    analyze = gateway_client.post("/api/analyze", json={"crns": demo["easy"]["crns"]})
    assert analyze.status_code == 200
    assert analyze.json()["risk_score"] == config.EASY_FIXTURE_EXPECTED_SCORE
    assert str(analyze.json()["risk_score"]) in body["headline"]


def test_gateway_does_not_change_openapi_of_core_app(strict_client: TestClient) -> None:
    spec = strict_client.get("/openapi.json").json()
    documented = {
        (method, path)
        for path, methods in spec["paths"].items()
        for method in methods
        if path.startswith("/api/")
    }
    assert documented == EIGHT_ENDPOINTS


def test_committed_impact_files_match_engine() -> None:
    payload = build_impact()
    assert SCHEDULES_CSV.read_text(encoding="utf-8").replace("\r\n", "\n") == _csv_text(
        payload["schedules"], SCHEDULE_COLUMNS
    )
    assert FACTORS_CSV.read_text(encoding="utf-8").replace("\r\n", "\n") == _csv_text(
        payload["factors"], FACTOR_COLUMNS
    )
    assert WARNINGS_CSV.read_text(encoding="utf-8").replace("\r\n", "\n") == _csv_text(
        payload["warnings"], WARNING_COLUMNS
    )
    assert json.loads(IMPACT_JSON.read_text(encoding="utf-8")) == json.loads(
        json.dumps(payload, indent=2, sort_keys=True)
    )


def test_impact_tables_match_calibrated_scores() -> None:
    payload = build_impact()
    by_key = {(row["schedule_id"], row["scenario"]): row for row in payload["schedules"]}
    easy = by_key[("easy", "analyze")]
    brutal = by_key[("brutal", "analyze")]
    stress = by_key[("easy", "miss_week_8")]
    before = by_key[("swap", "swap_before")]
    after = by_key[("swap", "swap_after")]
    assert easy["risk_score"] == config.EASY_FIXTURE_EXPECTED_SCORE
    assert brutal["risk_score"] == config.BRUTAL_FIXTURE_EXPECTED_SCORE
    assert before["risk_score"] == config.SWAP_DEMO_BEFORE_SCORE
    assert after["risk_score"] == config.SWAP_DEMO_AFTER_SCORE
    assert after["delta"] == config.SWAP_DEMO_AFTER_SCORE - config.SWAP_DEMO_BEFORE_SCORE
    assert stress["risk_score"] == config.EASY_FIXTURE_EXPECTED_SCORE
    assert stress["stressed_risk"] == config.EASY_STRESS_STRESSED_SCORE
    assert stress["delta"] == config.EASY_STRESS_DELTA
    story = "\n".join(story_lines(payload))
    assert str(config.EASY_FIXTURE_EXPECTED_SCORE) in story
    assert str(config.BRUTAL_FIXTURE_EXPECTED_SCORE) in story


def test_explain_does_not_mutate_analyze_contract() -> None:
    with TestClient(create_app(Settings())) as client:
        demo = client.get("/api/demo/schedules").json()
        body = {"crns": demo["easy"]["crns"]}
        analyzed = AnalyzeResponse.model_validate(client.post("/api/analyze", json=body).json())
    dumped = analyzed.model_dump(mode="json")
    explain_analysis(analyzed, allow_network=False)
    assert analyzed.model_dump(mode="json") == dumped
