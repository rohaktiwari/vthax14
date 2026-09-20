"""Optional Ask Gemini chat proxy. Hidden from OpenAPI; no outbound call unless enabled.

The browser only talks to ``POST /api/chat``. The Gemini key stays in the server
process environment and is sent to Google in a header. This module never logs
message text, facts, or keys. The eight planner routes stay offline.
"""

from __future__ import annotations

import json
import os
import threading
import time
from collections import defaultdict, deque
from collections.abc import Callable
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import config
from config import Settings
from data import DataContext
from models import AnalyzeResponse, Section
from sponsors.chat_facts import (
    CHAT_SYSTEM,
    MAX_REPLY_CHARS,
    NOTICES,
    build_chat_facts,
    fallback_reply,
    reply_is_grounded,
    reply_leaks,
    sanitize_focus,
    sanitize_text,
)
from sponsors.explain import (
    DEFAULT_MODEL,
    ENV_GEMINI_ENABLE,
    ENV_GEMINI_KEY,
    ENV_GEMINI_MODEL,
    GeminiError,
    gemini_enabled,
    generate_gemini,
)

MAX_MESSAGE_CHARS = 500
MAX_MESSAGES = 8
MAX_USER_TURNS = 4
MAX_CRNS = 12
MAX_BODY_BYTES = 16_384
RATE_WINDOW_S = 60.0
CLIENT_LIMIT = 12
GLOBAL_LIMIT = 30
REPLY_TOKEN_CAP = 1024

ValidateSchedule = Callable[[list[str], DataContext], list[Section]]
RunAnalysis = Callable[[list[Section], DataContext, Settings], AnalyzeResponse]


class SlidingWindowLimiter:
    """In-memory sliding window. One process; enough to protect a demo's Gemini quota."""

    def __init__(self, limit: int, window_s: float = RATE_WINDOW_S, max_keys: int = 4096) -> None:
        self.limit = limit
        self.window_s = window_s
        self.max_keys = max_keys
        self._lock = threading.Lock()
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            if len(self._hits) > self.max_keys:
                self._hits = defaultdict(
                    deque,
                    {k: v for k, v in self._hits.items() if v and now - v[-1] <= self.window_s},
                )
            hits = self._hits[key]
            while hits and now - hits[0] > self.window_s:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


_client_limiter = SlidingWindowLimiter(CLIENT_LIMIT)
_global_limiter = SlidingWindowLimiter(GLOBAL_LIMIT)


def reset_rate_limit() -> None:
    """Test helper."""
    _client_limiter.reset()
    _global_limiter.reset()


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)


class ChatFocus(BaseModel):
    building: str | None = Field(default=None, max_length=32)
    crn: str | None = Field(default=None, max_length=16)
    professor: str | None = Field(default=None, max_length=80)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_MESSAGES)
    crns: list[str] = Field(default_factory=list, max_length=MAX_CRNS)
    focus: ChatFocus | None = None


def _client_key(request: Request) -> str:
    # Render terminates TLS and sets X-Forwarded-For. A spoofed value only dodges the
    # per-client cap; the global cap still protects the quota.
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()[:64]
    if forwarded:
        return forwarded
    return request.client.host if request.client else "unknown"


def _enforce_rate_limits(request: Request) -> None:
    if _client_limiter.allow(_client_key(request)) and _global_limiter.allow("*"):
        return
    raise HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS,
        detail="You are sending questions too fast. Wait a minute and try again.",
        headers={"Retry-After": str(int(RATE_WINDOW_S))},
    )


def _off_reason() -> str:
    flag = os.environ.get(ENV_GEMINI_ENABLE, "").strip().lower() in {"1", "true", "yes", "on"}
    return "no_key" if flag else "disabled"


def _payload(reply: str, source: str, reason: str | None) -> dict[str, Any]:
    return {
        "reply": reply,
        "source": source,
        "reason": reason,
        "notice": NOTICES.get(reason) if reason else None,
    }


def _build_prompt(facts: dict[str, Any], history: list[tuple[str, str]]) -> str:
    turns = [
        f"{'student' if role == 'user' else 'earlier reply (unverified)'}: {text}"
        for role, text in history
    ]
    return (
        "<facts>\n"
        + json.dumps(facts, sort_keys=True)
        + "\n</facts>\n<conversation>\n"
        + "\n".join(turns)
        + "\n</conversation>"
    )


def answer_chat(
    facts: dict[str, Any],
    history: list[tuple[str, str]],
    *,
    allow_network: bool,
) -> dict[str, Any]:
    """One grounded answer. Any failure returns HokieLens's own deterministic read."""
    question = next((text for role, text in reversed(history) if role == "user"), "")
    fallback = fallback_reply(facts, question)
    if not allow_network:
        return _payload(fallback, "unavailable", _off_reason())

    key = (os.environ.get(ENV_GEMINI_KEY) or "").strip()
    model = (os.environ.get(ENV_GEMINI_MODEL) or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    try:
        raw = generate_gemini(
            system=CHAT_SYSTEM,
            user=_build_prompt(facts, history),
            key=key,
            model=model,
            max_output_tokens=REPLY_TOKEN_CAP,
        )
    except GeminiError as exc:
        reason = exc.reason if exc.reason in NOTICES else "error"
        return _payload(fallback, "fallback", reason)

    text = raw.strip()
    if not text:
        return _payload(fallback, "fallback", "empty")
    if reply_leaks(text, key):
        return _payload(fallback, "fallback", "blocked")
    if not reply_is_grounded(text, facts):
        return _payload(fallback, "fallback", "ungrounded")
    return _payload(text[:MAX_REPLY_CHARS], "gemini", None)


def _clean_history(messages: list[ChatMessage]) -> list[tuple[str, str]]:
    cleaned = [(item.role, sanitize_text(item.content)) for item in messages]
    return [(role, text) for role, text in cleaned if text]


def _score_schedule(
    ctx: DataContext,
    settings: Settings,
    crns: list[str],
    validate_schedule: ValidateSchedule,
    run_analysis: RunAnalysis,
) -> tuple[list[Section], AnalyzeResponse | None, list[str]]:
    notes: list[str] = []
    sections = [ctx.sections_by_crn[crn] for crn in crns if crn in ctx.sections_by_crn]
    if len(sections) < len(crns):
        notes.append("Some selected CRNs are not in the catalog and were ignored.")
    if len(sections) < config.MIN_ANALYZE_CRNS:
        return sections, None, notes
    try:
        validated = validate_schedule([section.crn for section in sections], ctx)
        return sections, run_analysis(validated, ctx, settings), notes
    except HTTPException:
        notes.append("Two selected classes overlap, so this schedule cannot be scored yet.")
        return sections, None, notes


def register_chat_routes(
    app: FastAPI,
    *,
    validate_schedule: ValidateSchedule,
    run_analysis: RunAnalysis,
) -> None:
    """Attach ``/api/chat`` and ``/api/chat/status``. Both are hidden from OpenAPI."""

    @app.middleware("http")
    async def _chat_body_limit(request: Request, call_next: Any) -> Any:
        if request.url.path == "/api/chat":
            declared = request.headers.get("content-length", "")
            if declared.isdigit() and int(declared) > MAX_BODY_BYTES:
                return JSONResponse(
                    {"detail": "That message is too large. Shorten it and try again."},
                    status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                )
        return await call_next(request)

    @app.get("/api/chat/status", include_in_schema=False)
    def chat_status() -> JSONResponse:
        return JSONResponse({"enabled": gemini_enabled()})

    @app.post("/api/chat", include_in_schema=False)
    def chat(body: ChatRequest, request: Request) -> JSONResponse:
        _enforce_rate_limits(request)
        history = _clean_history(body.messages)
        if not history or history[-1][0] != "user":
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Type a question for Ask Gemini first.",
            )
        if sum(1 for role, _ in history if role == "user") > MAX_USER_TURNS:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="This chat is long enough. Start a new chat to keep going.",
            )

        ctx: DataContext = request.app.state.ctx
        settings: Settings = request.app.state.settings
        crns = list(dict.fromkeys(token.strip() for token in body.crns if token.strip()))
        sections, analysis, notes = _score_schedule(
            ctx, settings, crns, validate_schedule, run_analysis
        )
        focus = None
        if body.focus is not None:
            focus = sanitize_focus(ctx, body.focus.building, body.focus.crn, body.focus.professor)
        facts = build_chat_facts(ctx, sections, analysis, focus, notes)
        result = answer_chat(facts, history, allow_network=gemini_enabled())
        return JSONResponse(result, headers={"Cache-Control": "no-store"})
