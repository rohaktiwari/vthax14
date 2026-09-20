"""Optional placeholder for ``POST /api/analyze`` when ``HOKIELENS_STUB_ANALYZE=1``.

Default production path is the real engine (``HOKIELENS_STUB_ANALYZE=0``). This
module is a compatibility/testing path with the same :class:`models.AnalyzeResponse`
contract; it cannot run unless the flag is explicitly set.

What is real here: the selected ``sections`` (request order), the ``commute``
factor, ``commute_warnings`` (PRD 7.6), and instructor-collision ``data_notes``.
What is placeholder: the other four factors and ``expected_gpa``. The
``meta.data_notes`` entry and every placeholder ``detail`` string say so.

Nothing outside ``main.py`` imports this module.
"""

from __future__ import annotations

import config
from data import DataContext
from models import (
    AnalysisMeta,
    AnalyzeResponse,
    ExpectedGpa,
    GpaExclusion,
    RiskFactor,
    Section,
)
from risk import COMMUTE_FACTOR, commute_factor, commute_transitions, commute_warnings

STUB_NOTE = (
    "STUB: HOKIELENS_STUB_ANALYZE=1 - risk_score, non-commute factors, and expected_gpa "
    "are placeholder values, not computed by the risk engine."
)


def _seed(sections: list[Section]) -> int:
    """Order-independent integer derived from the selected CRNs."""
    return sum(ord(ch) for crn in sorted(section.crn for section in sections) for ch in crn)


def _stub_factors(sections: list[Section], seed: int, commute: RiskFactor) -> list[RiskFactor]:
    crns = [section.crn for section in sections]
    factors: list[RiskFactor] = []
    for index, name in enumerate(config.FACTOR_ORDER):
        if name == COMMUTE_FACTOR:
            factors.append(commute)
            continue
        max_severity = config.factor_max_severity(name)
        fraction = ((seed + 7 * index) % 11) / 10  # 0.0 .. 1.0, deterministic
        severity = round(max_severity * fraction, 1)
        factors.append(
            RiskFactor(
                type=name,  # type: ignore[arg-type]
                severity=severity,
                max_severity=max_severity,
                detail=f"STUB placeholder severity for {name}; not computed by the risk engine.",
                affected_crns=list(crns) if severity > 0 else [],
            )
        )
    return factors


def _stub_expected_gpa(sections: list[Section], seed: int) -> ExpectedGpa:
    excluded = [
        GpaExclusion(crn=section.crn, reason="pass_fail")
        for section in sections
        if config.PASS_FAIL_EXCLUDE_FROM_GPA and section.grade_mode == "pass_fail"
    ]
    eligible = [section for section in sections if section.grade_mode != "pass_fail"]
    if not eligible:
        return ExpectedGpa(
            range=None, mean=None, confidence="low", n_students=0, n_terms=0, excluded=excluded
        )
    mean = round(2.8 + (seed % 7) / 10, 2)  # 2.80 .. 3.40
    half_width = 0.25
    return ExpectedGpa(
        range=(round(max(0.0, mean - half_width), 2), round(min(4.0, mean + half_width), 2)),
        mean=mean,
        confidence="low",
        n_students=0,
        n_terms=0,
        excluded=excluded,
    )


def build_stub_analysis(sections: list[Section], ctx: DataContext) -> AnalyzeResponse:
    """Deterministic placeholder analysis for the given sections (request order)."""
    seed = _seed(sections)
    transitions = commute_transitions(sections, ctx)
    factors = _stub_factors(sections, seed, commute_factor(transitions))
    total = sum(factor.severity for factor in factors)
    risk_score = round(min(config.RISK_SCORE_MAX, max(config.RISK_SCORE_MIN, total)))

    loader_notes = sorted({note for s in sections for note in ctx.section_notes.get(s.crn, ())})
    return AnalyzeResponse(
        risk_score=risk_score,
        sections=list(sections),
        factors=factors,
        commute_warnings=commute_warnings(transitions),
        expected_gpa=_stub_expected_gpa(sections, seed),
        meta=AnalysisMeta(
            term_id=ctx.term_id, data_notes=[STUB_NOTE, *loader_notes], heuristic=True
        ),
    )
