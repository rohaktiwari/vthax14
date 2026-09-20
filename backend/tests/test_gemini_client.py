"""generate_gemini at the HTTP layer with a mocked transport. No test opens the network."""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from sponsors.explain import GeminiError, generate_gemini

KEY = "test-key-not-real-1234"
_REAL_CLIENT = httpx.Client


def _install(
    monkeypatch: pytest.MonkeyPatch, handler: Callable[[httpx.Request], httpx.Response]
) -> None:
    def factory(**kwargs: Any) -> httpx.Client:
        return _REAL_CLIENT(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr("sponsors.explain.httpx.Client", factory)


def _call(**overrides: Any) -> str:
    args: dict[str, Any] = {"system": "sys", "user": "usr", "key": KEY, "model": "test-model"}
    args.update(overrides)
    return generate_gemini(**args)


def test_key_goes_in_a_header_never_the_url_and_reply_text_is_joined(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["key_header"] = request.headers.get("x-goog-api-key")
        seen["body"] = request.read().decode()
        return httpx.Response(
            200,
            json={"candidates": [{"content": {"parts": [{"text": "Hello"}, {"text": "there"}]}}]},
        )

    _install(monkeypatch, handler)
    assert _call(max_output_tokens=321) == "Hello\nthere"
    assert KEY not in seen["url"] and "test-model" in seen["url"]
    assert seen["key_header"] == KEY
    assert '"maxOutputTokens":321' in seen["body"].replace(" ", "")
    assert KEY not in seen["body"]


@pytest.mark.parametrize(
    ("status_code", "reason"),
    [(429, "quota"), (500, "error"), (403, "error"), (400, "error")],
)
def test_http_errors_map_to_reasons_without_leaking_the_key(
    monkeypatch: pytest.MonkeyPatch, status_code: int, reason: str
) -> None:
    _install(
        monkeypatch, lambda _r: httpx.Response(status_code, json={"error": {"message": "nope"}})
    )
    with pytest.raises(GeminiError) as caught:
        _call()
    assert caught.value.reason == reason
    assert KEY not in str(caught.value) and KEY not in repr(caught.value.__cause__)


def test_timeouts_and_malformed_payloads_are_gemini_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    _install(monkeypatch, timeout)
    with pytest.raises(GeminiError) as caught:
        _call()
    assert caught.value.reason == "timeout"

    for payload in ({"candidates": []}, {"candidates": ["not-a-dict"]}):
        _install(monkeypatch, lambda _r, body=payload: httpx.Response(200, json=body))
        with pytest.raises(GeminiError) as bad:
            _call()
        assert bad.value.reason == "error"

    _install(monkeypatch, lambda _r: httpx.Response(200, content=b"<html>"))
    with pytest.raises(GeminiError):
        _call()


def test_no_log_line_contains_the_key(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    _install(monkeypatch, lambda _r: httpx.Response(429, json={}))
    with caplog.at_level(logging.DEBUG), pytest.raises(GeminiError):
        _call()
    assert KEY not in "\n".join(record.getMessage() for record in caplog.records)
