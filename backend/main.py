"""HokieLens FastAPI application (PRD 2, 6).

Run from the ``backend/`` directory::

    uvicorn main:app            # verification
    uvicorn main:app --reload   # development

Startup loads and validates every committed data file exactly once (FastAPI
lifespan) and stores the immutable ``DataContext`` on ``app.state.ctx``. The
eight planner routes stay offline. Optional Ask Gemini (``POST /api/chat``,
hidden from OpenAPI) is the only path that may call Google, and only when
``HOKIELENS_GEMINI=1`` and ``GEMINI_API_KEY`` are set.

Delivery is complete through the final audit (PRD 11). Catalog, health, demo,
schedule validation, commute, swap, the real risk engine, miss-week stress,
professor vibes, offline pipeline scripts, and the calibrated synthetic catalog
are live. ``/api/analyze`` and ``/api/swap`` validate first, then call
:func:`risk.analyze`. ``HOKIELENS_STUB_ANALYZE=1`` remains an isolated
compatibility path (same ``AnalyzeResponse`` contract); default is off.
``/api/stress`` reuses that same analysis path and adds the PRD 6.5 penalty.
Pipeline scripts live in ``scripts/`` and are never imported by this module.
Optional ANS well-known documents are served from ``sponsors/ans`` with no
outbound calls.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Path, Query, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import config
from config import Settings
from data import DataContext, buildings_matrix, load_data_context, search_courses
from models import (
    AnalyzeRequest,
    AnalyzeResponse,
    BuildingsMatrixQuery,
    BuildingsMatrixResponse,
    ConflictErrorDetail,
    CourseSearchQuery,
    CourseSearchResponse,
    DemoSchedulesResponse,
    ErrorResponse,
    HealthResponse,
    Section,
    StressRequest,
    StressResponse,
    SwapRequest,
    SwapResponse,
    SwapSummary,
    VibesResponse,
    normalize_instructor_key,
)
from risk import analyze as analyze_schedule
from risk import miss_week_stress, professor_vibes
from schedule import find_meeting_conflicts
from sponsors.chat import register_chat_routes
from sponsors.identity import agent_card_payload, registration_payload
from stub_analyze import build_stub_analysis

logger = logging.getLogger("hokielens")

API_TITLE = "HokieLens API"
API_VERSION = "0.1.0"

_ERROR = {"model": ErrorResponse}


def _configure_logging() -> None:
    root = logging.getLogger()
    if not root.handlers:
        logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("hokielens").setLevel(logging.INFO)


def get_ctx(request: Request) -> DataContext:
    return request.app.state.ctx


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


Ctx = Annotated[DataContext, Depends(get_ctx)]
AppSettings = Annotated[Settings, Depends(get_settings)]


def resolve_sections(crns: list[str], ctx: DataContext) -> list[Section]:
    """Map request CRNs to sections in request order; unknown CRNs are a 422."""
    unknown = [crn for crn in crns if crn not in ctx.sections_by_crn]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown CRNs: {', '.join(unknown)}",
        )
    return [ctx.sections_by_crn[crn] for crn in crns]


def validate_schedule(crns: list[str], ctx: DataContext) -> list[Section]:
    """Analyze validation (PRD 6.3) shared by analyze and swap.

    CRN count and uniqueness are enforced by the request models. Here: every CRN
    must exist in the catalog (422 with a string ``detail``), and no two selected
    sections may overlap on a shared weekday, time interval, and inclusive date
    range (422 with the structured ``meeting_overlap`` detail listing every conflict).
    """
    sections = resolve_sections(crns, ctx)
    conflicts = find_meeting_conflicts(sections)
    if conflicts:
        detail = ConflictErrorDetail(
            code=config.MEETING_OVERLAP_CODE,
            message=config.MEETING_OVERLAP_MESSAGE,
            conflicts=conflicts,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail.model_dump()
        )
    return sections


def run_analysis(sections: list[Section], ctx: DataContext, settings: Settings) -> AnalyzeResponse:
    """Single analysis path used by analyze and (twice, independently) by swap.

    Default: :func:`risk.analyze`. ``HOKIELENS_STUB_ANALYZE=1`` routes to the
    isolated placeholder (same ``AnalyzeResponse`` contract) so the frontend can
    still exercise a stable fake payload. Validation always runs first.
    """
    if settings.stub_analyze:
        return build_stub_analysis(sections, ctx)
    return analyze_schedule(sections, ctx)


def warning_identities(analysis: AnalyzeResponse) -> set[tuple[str, str, str, str]]:
    """Swap warning identity ``(day, from.crn, to.crn, verdict)`` (PRD 6.4)."""
    return {
        (warning.day, warning.from_.crn, warning.to.crn, warning.verdict)
        for warning in analysis.commute_warnings
    }


def _format_validation_error(exc: RequestValidationError) -> str:
    parts = []
    for error in exc.errors():
        location = ".".join(str(piece) for piece in error.get("loc", ())) or "request"
        parts.append(f"{location}: {error.get('msg', 'invalid value')}")
    return "; ".join(parts) or "Invalid request"


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the application. ``settings`` defaults to the environment."""
    _configure_logging()
    resolved = Settings.from_env() if settings is None else settings

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        logger.info(
            "starting HokieLens: term_id=%s lenient=%s stub_analyze=%s data_dir=%s fixtures_dir=%s",
            resolved.catalog_term_id,
            resolved.lenient,
            resolved.stub_analyze,
            resolved.data_dir,
            resolved.fixtures_dir,
        )
        ctx = load_data_context(resolved)
        app.state.settings = resolved
        app.state.ctx = ctx
        if resolved.stub_analyze:
            logger.warning("HOKIELENS_STUB_ANALYZE=1: /api/analyze returns placeholder data")
        yield

    app = FastAPI(
        title=API_TITLE,
        version=API_VERSION,
        description=(
            "Explanatory semester-planning aid for Virginia Tech course selections. "
            "Risk values are heuristics, not predictions. All routes live under /api."
        ),
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=False,
    )

    @app.exception_handler(RequestValidationError)
    async def _validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": _format_validation_error(exc)},
        )

    # ------------------------------------------------------------------ system

    @app.get("/api/health", response_model=HealthResponse, tags=["system"])
    def health(ctx: Ctx) -> HealthResponse:
        stats = ctx.stats
        return HealthResponse(
            status="ok",
            term_id=ctx.term_id,
            sections=stats.sections,
            grade_records=stats.grade_records,
            instructors=stats.instructors,
            buildings=stats.buildings,
            walk_pairs=stats.walk_pairs,
            synthetic_rows=stats.synthetic_rows,
            warnings=stats.warnings,
        )

    # ----------------------------------------------------------------- catalog

    @app.get(
        "/api/courses/search",
        response_model=CourseSearchResponse,
        tags=["catalog"],
    )
    def courses_search(
        query: Annotated[CourseSearchQuery, Query()], ctx: Ctx
    ) -> CourseSearchResponse:
        return search_courses(ctx, query.q, query.subject, query.limit)

    @app.get(
        "/api/buildings/matrix",
        response_model=BuildingsMatrixResponse,
        tags=["catalog"],
    )
    def buildings_matrix_route(
        query: Annotated[BuildingsMatrixQuery, Query()], ctx: Ctx
    ) -> BuildingsMatrixResponse:
        return buildings_matrix(ctx, query.include_meta)

    # ---------------------------------------------------------------- analysis

    @app.post(
        "/api/analyze",
        response_model=AnalyzeResponse,
        responses={status.HTTP_422_UNPROCESSABLE_CONTENT: _ERROR},
        tags=["analysis"],
    )
    def analyze(body: AnalyzeRequest, ctx: Ctx, settings: AppSettings) -> AnalyzeResponse:
        sections = validate_schedule(body.crns, ctx)
        return run_analysis(sections, ctx, settings)

    @app.post(
        "/api/swap",
        response_model=SwapResponse,
        responses={
            status.HTTP_400_BAD_REQUEST: _ERROR,
            status.HTTP_422_UNPROCESSABLE_CONTENT: _ERROR,
        },
        tags=["analysis"],
    )
    def swap(body: SwapRequest, ctx: Ctx, settings: AppSettings) -> SwapResponse:
        # 1. current_crns follows analyze validation before the swap (422).
        before_sections = validate_schedule(body.current_crns, ctx)

        # 2. Swap-operation rules (400), in PRD order.
        if body.current_crns.count(body.drop_crn) != 1:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"drop_crn {body.drop_crn!r} must occur exactly once in current_crns",
            )
        if body.add_crn not in ctx.sections_by_crn:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail=f"add_crn {body.add_crn!r} is not a known CRN"
            )
        if body.add_crn == body.drop_crn:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"add_crn {body.add_crn!r} must differ from drop_crn",
            )
        if body.add_crn in body.current_crns:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"add_crn {body.add_crn!r} is already selected in current_crns",
            )

        # 3. The resulting schedule (add_crn replaces drop_crn at the same index)
        #    must satisfy analyze validation (422 with conflict details).
        after_crns = [body.add_crn if crn == body.drop_crn else crn for crn in body.current_crns]
        after_sections = validate_schedule(after_crns, ctx)

        # 4. Two independent analyses; before/after equal standalone analyze calls.
        before = run_analysis(before_sections, ctx, settings)
        after = run_analysis(after_sections, ctx, settings)

        before_ids = warning_identities(before)
        after_ids = warning_identities(after)
        return SwapResponse(
            before=before,
            after=after,
            delta=after.risk_score - before.risk_score,
            summary=SwapSummary(
                risk=config.SWAP_RISK_SUMMARY_FORMAT.format(
                    before=before.risk_score, after=after.risk_score
                ),
                resolved_warnings=len(before_ids - after_ids),
                new_warnings=len(after_ids - before_ids),
            ),
        )

    @app.post(
        "/api/stress",
        response_model=StressResponse,
        responses={status.HTTP_422_UNPROCESSABLE_CONTENT: _ERROR},
        tags=["analysis"],
    )
    def stress(body: StressRequest, ctx: Ctx, settings: AppSettings) -> StressResponse:
        sections = validate_schedule(body.crns, ctx)
        analysis = run_analysis(sections, ctx, settings)
        return miss_week_stress(analysis, sections, ctx, body.week)

    # -------------------------------------------------------------- professors

    @app.get(
        "/api/professors/{surname}/vibes",
        response_model=VibesResponse,
        responses={status.HTTP_404_NOT_FOUND: _ERROR},
        tags=["professors"],
    )
    def professor_vibes_route(
        surname: Annotated[str, Path(min_length=1, description="Instructor surname")],
        ctx: Ctx,
    ) -> VibesResponse:
        result = professor_vibes(ctx, surname)
        if result is None:
            key = normalize_instructor_key(surname) or surname.strip()
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                detail=config.VIBES_NOT_FOUND_DETAIL.format(key=key),
            )
        return result

    # -------------------------------------------------------------------- demo

    @app.get("/api/demo/schedules", response_model=DemoSchedulesResponse, tags=["demo"])
    def demo_schedules(ctx: Ctx) -> DemoSchedulesResponse:
        return ctx.demo_schedules

    # ANS protocol card. Static identity, no keys, no outbound calls. Hidden
    # from OpenAPI so the eight-route frontend contract is unchanged.
    @app.get("/.well-known/agent-card.json", include_in_schema=False)
    def ans_agent_card() -> JSONResponse:
        return JSONResponse(agent_card_payload())

    @app.get("/.well-known/ans/agent.json", include_in_schema=False)
    def ans_agent_alias() -> JSONResponse:
        return JSONResponse(agent_card_payload())

    @app.get("/.well-known/ans/registration.json", include_in_schema=False)
    def ans_registration() -> JSONResponse:
        return JSONResponse(registration_payload())

    register_chat_routes(app, validate_schedule=validate_schedule, run_analysis=run_analysis)
    return app


app = create_app()
