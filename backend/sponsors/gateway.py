from fastapi.responses import JSONResponse

from main import AppSettings, Ctx, create_app, run_analysis, validate_schedule
from models import AnalyzeRequest
from sponsors import load_local_env
from sponsors.explain import explain_analysis, gemini_enabled


def create_gateway(settings=None):
    load_local_env()
    app = create_app(settings)

    @app.post("/api/explain", include_in_schema=False)
    def explain(
        body: AnalyzeRequest,
        ctx: Ctx,
        app_settings: AppSettings,
    ) -> JSONResponse:
        sections = validate_schedule(body.crns, ctx)
        analysis = run_analysis(sections, ctx, app_settings)
        payload = explain_analysis(analysis, allow_network=gemini_enabled())
        return JSONResponse(payload)

    return app


app = create_gateway()
