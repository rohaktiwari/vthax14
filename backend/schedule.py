"""Pure schedule geometry (PRD 4, 6.3): weekday timelines, overlap detection, HH:MM.

No FastAPI imports. ``main.py`` uses :func:`find_meeting_conflicts` for request-time
schedule validation (analyze and swap); ``risk.py`` uses the timeline helpers for
commute classification. Every function is deterministic for identical input.

Sections reaching these functions come from the startup-validated catalog, so
meeting days, minute ranges, date ranges, modality rules, and building codes are
already known to be well-formed (``models.py`` and ``data.py``).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import config
from models import Meeting, MeetingConflict, Section

_WEEKDAY_INDEX = {day: index for index, day in enumerate(config.WEEKDAY_ORDER)}


def format_hhmm(minutes: int) -> str:
    """Zero-padded 24-hour ``HH:MM`` for minutes from midnight (PRD 4)."""
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def weekday_index(day: str) -> int:
    """Position of ``day`` in the configured ``M,T,W,R,F,S,U`` order."""
    return _WEEKDAY_INDEX[day]


def dates_overlap(first: Meeting, second: Meeting) -> bool:
    """Inclusive date ranges share at least one day (PRD 4: ranges are inclusive)."""
    return first.start_date <= second.end_date and second.start_date <= first.end_date


def times_overlap(first: Meeting, second: Meeting) -> bool:
    """Minute intervals overlap; meetings that touch exactly at an endpoint do not."""
    return first.start_min < second.end_min and second.start_min < first.end_min


@dataclass(frozen=True)
class TimelineEntry:
    section: Section
    meeting: Meeting


def weekday_timeline(sections: Sequence[Section], day: str) -> list[TimelineEntry]:
    """Every synchronous meeting (physical or online) on ``day``, ordered by
    ``(start_min, end_min, crn)``. Asynchronous sections have no meetings and
    therefore never appear."""
    entries = [
        TimelineEntry(section=section, meeting=meeting)
        for section in sections
        for meeting in section.meetings
        if day in meeting.days
    ]
    entries.sort(
        key=lambda entry: (entry.meeting.start_min, entry.meeting.end_min, entry.section.crn)
    )
    return entries


def find_meeting_conflicts(sections: Sequence[Section]) -> list[MeetingConflict]:
    """Pairwise meeting overlaps between distinct selected sections (PRD 6.3).

    A conflict requires a shared weekday, overlapping minute intervals (touching
    endpoints do not overlap), and overlapping inclusive date ranges. One conflict
    is reported per ``(weekday, overlap interval, CRN pair)``; ``crns`` follow the
    request order of the two sections. Results sort by weekday order, then overlap
    start, end, and CRNs.
    """
    found: dict[tuple[int, int, int, str, str], MeetingConflict] = {}
    for index, first in enumerate(sections):
        for second in sections[index + 1 :]:
            for meeting_a in first.meetings:
                for meeting_b in second.meetings:
                    if not dates_overlap(meeting_a, meeting_b):
                        continue
                    if not times_overlap(meeting_a, meeting_b):
                        continue
                    start = max(meeting_a.start_min, meeting_b.start_min)
                    end = min(meeting_a.end_min, meeting_b.end_min)
                    for day in meeting_a.days:
                        if day not in meeting_b.days:
                            continue
                        key = (weekday_index(day), start, end, first.crn, second.crn)
                        found.setdefault(
                            key,
                            MeetingConflict(
                                crns=[first.crn, second.crn],
                                day=day,
                                start=format_hhmm(start),
                                end=format_hhmm(end),
                            ),
                        )
    return [found[key] for key in sorted(found)]
