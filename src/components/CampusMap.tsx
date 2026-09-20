import { useMemo, useState } from "react";
import type { CommuteVerdict, CommuteWarning, Weekday } from "../api/types";
import { useBuildingsMatrix } from "../api/hooks";
import { normalizeApiError } from "../api/errors";
import { useMapSelection } from "../context/MapSelectionContext";
import { useSchedule } from "../context/ScheduleContext";
import { useScheduleAnalysis } from "../hooks/useScheduleAnalysis";
import { verdictLabel } from "../lib/risk";
import { formatMinutes, formatWeekdayShort } from "../lib/time";
import { projectCoordinates, walkMinutesFor } from "../lib/mapProjection";
import {
  buildDayTransitions,
  transitionDays,
  warningKey,
  type DayTransition,
} from "../lib/transitions";
import { CARD, type Tone } from "../lib/ui";
import Badge from "./Badge";
import ErrorState from "./ErrorState";
import Skeleton from "./Skeleton";

const VERDICT_STROKE: Record<CommuteVerdict, string> = {
  comfortable: "var(--color-success)",
  tight: "var(--color-warning)",
  impossible: "var(--color-danger)",
};

const VERDICT_TONE: Record<CommuteVerdict, Tone> = {
  comfortable: "success",
  tight: "warning",
  impossible: "danger",
};

const NEUTRAL_STROKE = "var(--color-text-secondary)";

function MapPin({ label, dimmed }: { label: string; dimmed: boolean }) {
  return (
    <svg viewBox="0 0 24 32" className={`h-7 w-5 drop-shadow ${dimmed ? "opacity-40" : ""}`} aria-hidden="true">
      <path
        d="M12 1C6.5 1 2 5.6 2 11.2 2 19 12 31 12 31S22 19 22 11.2C22 5.6 17.5 1 12 1Z"
        fill="var(--color-maroon)"
      />
      <circle cx="12" cy="11" r="4" fill="var(--color-panel)" />
      <title>{label}</title>
    </svg>
  );
}

function WalkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="13" cy="4.5" r="1.8" />
      <path d="m9 21 2.5-6-2-2.5 1-4.5 3.5 2.5 2.5.5M9.5 10.5 7 13" />
    </svg>
  );
}

interface WalkInfo {
  transition: DayTransition;
  warning: CommuteWarning | null;
  minutes: number | null;
}

function chipText(info: WalkInfo): string {
  const minutes = info.minutes === null ? "? min" : `${info.minutes} min`;
  return info.warning ? `${minutes} · ${verdictLabel(info.warning.verdict)}` : minutes;
}

/** Solid white chips stay readable over the map; only the border and text carry the verdict. */
const CHIP_TONE: Record<"success" | "warning" | "danger", string> = {
  success: "border-success/50 text-success",
  warning: "border-warning/60 text-warning",
  danger: "border-danger/60 text-danger",
};

/**
 * Schematic campus map with walking times drawn on it, plus a fully equivalent
 * textual transition list (frontend PRD §10.4, §12.8).
 *
 * Uses the committed local `public/campus-map.svg` backdrop, the documented
 * buildings matrix for coordinates and walk minutes, and backend analysis for
 * verdicts. It never loads tiles or routing services and never derives a walk
 * time or verdict locally. A transition with no backend warning is shown as an
 * ordinary walk, since the backend lists only tight and impossible ones.
 */
export default function CampusMap() {
  const { crns, selectedSections, unavailableCrns } = useSchedule();
  const buildingsQuery = useBuildingsMatrix(false);
  const analysis = useScheduleAnalysis();
  const mapSelection = useMapSelection();
  const [requestedDay, setRequestedDay] = useState<Weekday | null>(null);
  const [activeTransition, setActiveTransition] = useState<string | null>(null);

  const days = useMemo(() => {
    const inPerson = transitionDays(selectedSections);
    const withWalks = inPerson.filter((day) => buildDayTransitions(selectedSections, day).length > 0);
    return withWalks.length > 0 ? withWalks : inPerson;
  }, [selectedSections]);
  const day = requestedDay && days.includes(requestedDay) ? requestedDay : (days[0] ?? null);
  const transitions = useMemo(
    () => (day ? buildDayTransitions(selectedSections, day) : []),
    [selectedSections, day],
  );

  const buildings = useMemo(() => buildingsQuery.data?.buildings ?? {}, [buildingsQuery.data]);
  const walk = buildingsQuery.data?.walk;
  const warnings = useMemo(() => analysis.data?.commute_warnings ?? [], [analysis.data]);

  const warningsByKey = useMemo(() => {
    const map = new Map<string, CommuteWarning>();
    for (const warning of warnings) {
      map.set(warningKey(warning.day, warning.from.crn, warning.to.crn), warning);
    }
    return map;
  }, [warnings]);

  const usedCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const section of selectedSections) {
      for (const meeting of section.meetings) {
        if (meeting.building) codes.add(meeting.building);
      }
    }
    return [...codes].sort();
  }, [selectedSections]);

  const projection = useMemo(
    () =>
      projectCoordinates(
        usedCodes.map((code) => {
          const building = buildings[code];
          return { code, name: building?.name ?? code, lat: building?.lat, lng: building?.lng };
        }),
      ),
    [usedCodes, buildings],
  );

  const markerByCode = useMemo(
    () => new Map(projection.markers.map((marker) => [marker.code, marker])),
    [projection],
  );

  const crnsByBuilding = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const section of selectedSections) {
      const codes = new Set<string>();
      for (const meeting of section.meetings) {
        if (meeting.building) codes.add(meeting.building);
      }
      for (const code of codes) map.set(code, [...(map.get(code) ?? []), section.crn]);
    }
    return map;
  }, [selectedSections]);

  const dayCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const transition of transitions) {
      codes.add(transition.from.building);
      codes.add(transition.to.building);
    }
    return codes;
  }, [transitions]);

  const walkInfos = useMemo<WalkInfo[]>(
    () =>
      transitions.map((transition) => {
        const warning = warningsByKey.get(warningKey(transition.day, transition.from.crn, transition.to.crn)) ?? null;
        const matrix = walkMinutesFor(walk, transition.from.building, transition.to.building);
        return { transition, warning, minutes: matrix ?? warning?.walk_min ?? null };
      }),
    [transitions, warningsByKey, walk],
  );

  // Chips whose midpoints coincide (same building pair) stack instead of overlapping.
  const chipSlots = useMemo(() => {
    const seen = new Map<string, number>();
    const slots = new Map<string, number>();
    for (const info of walkInfos) {
      const from = markerByCode.get(info.transition.from.building);
      const to = markerByCode.get(info.transition.to.building);
      if (!from || !to) continue;
      const mid = `${Math.round((from.xPercent + to.xPercent) * 5)}|${Math.round((from.yPercent + to.yPercent) * 5)}`;
      const count = seen.get(mid) ?? 0;
      seen.set(mid, count + 1);
      slots.set(info.transition.key, count);
    }
    return slots;
  }, [walkInfos, markerByCode]);

  const active = walkInfos.find((info) => info.transition.key === activeTransition) ?? null;
  const detailsUnavailable = crns.length > 0 && selectedSections.length === 0;
  const analysisPending = crns.length >= 2 && analysis.isPending;

  function handleMarkerClick(code: string) {
    if (mapSelection.highlightedBuilding === code) mapSelection.clearHighlight();
    else mapSelection.setHighlightedBuilding(code, crnsByBuilding.get(code) ?? []);
  }

  const header = (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
      <h2 className="text-lg font-bold text-ink-primary">Campus Map</h2>
      {days.length > 1 ? (
        <div role="group" aria-label="Choose a weekday" className="flex flex-wrap gap-1">
          {days.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === day}
              onClick={() => {
                setRequestedDay(option);
                setActiveTransition(null);
              }}
              className={`rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${
                option === day
                  ? "border-maroon bg-soft-maroon text-maroon"
                  : "border-line bg-panel text-ink-secondary hover:border-maroon/40 hover:text-ink-primary"
              }`}
            >
              {formatWeekdayShort(option)}
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );

  if (crns.length === 0) {
    return (
      <section aria-label="Campus map" className={`${CARD} shrink-0`}>
        {header}
        <p className="p-4 text-sm text-ink-secondary" data-testid="map-empty">
          Add courses to see their buildings and the walking time between back-to-back classes.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Campus map" className={`${CARD} shrink-0`}>
      {header}

      {detailsUnavailable ? (
        <div className="m-4 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm" data-testid="map-unavailable">
          <p className="font-semibold text-warning">
            Building locations unavailable for {unavailableCrns.length} selected course
            {unavailableCrns.length === 1 ? "" : "s"}
          </p>
          <p className="mt-1 text-ink-secondary">Remove them and add them again from search to place them here.</p>
        </div>
      ) : (
        <div className="space-y-3 p-3">
          <div className="relative h-[clamp(9rem,24vh,15rem)] overflow-hidden rounded-xl border border-line map-grid map-canvas">
            <img src="/campus-map.svg" alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />

            {buildingsQuery.isPending ? (
              <div className="absolute inset-0 grid place-items-center bg-panel/70 p-6">
                <div className="w-48">
                  <Skeleton lines={3} />
                </div>
              </div>
            ) : null}
            {buildingsQuery.isError ? (
              <div className="absolute inset-0 grid place-items-center overflow-auto bg-panel/90 p-4">
                <ErrorState
                  title="Building locations unavailable"
                  error={normalizeApiError(buildingsQuery.error)}
                  onRetry={() => void buildingsQuery.refetch()}
                />
              </div>
            ) : null}

            {projection.markers.length > 0 ? (
              <>
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
                  {walkInfos.map((info) => {
                    const from = markerByCode.get(info.transition.from.building);
                    const to = markerByCode.get(info.transition.to.building);
                    if (!from || !to) return null;
                    return (
                      <line
                        key={info.transition.key}
                        x1={from.xPercent}
                        y1={from.yPercent}
                        x2={to.xPercent}
                        y2={to.yPercent}
                        stroke={info.warning ? VERDICT_STROKE[info.warning.verdict] : NEUTRAL_STROKE}
                        strokeWidth={info.warning ? 1.4 : 0.9}
                        strokeDasharray="4 3"
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
                </svg>

                {projection.markers.map((marker) => {
                  const highlighted = mapSelection.highlightedBuilding === marker.code;
                  const crnCount = (crnsByBuilding.get(marker.code) ?? []).length;
                  const onThisDay = dayCodes.size === 0 || dayCodes.has(marker.code);
                  return (
                    <button
                      key={marker.code}
                      type="button"
                      aria-pressed={highlighted}
                      aria-label={`${marker.name} (${marker.code}), ${crnCount} selected course${crnCount === 1 ? "" : "s"}`}
                      onClick={() => handleMarkerClick(marker.code)}
                      className="group absolute flex -translate-x-1/2 -translate-y-full flex-col items-center transition-transform hover:z-10 hover:scale-[1.04]"
                      style={{ left: `${marker.xPercent}%`, top: `${marker.yPercent}%` }}
                    >
                      <MapPin label={marker.name} dimmed={!onThisDay} />
                      <span
                        className={`mt-0.5 max-w-28 truncate rounded-md border px-1.5 py-0.5 text-center text-xs font-medium shadow-sm transition-colors ${
                          highlighted
                            ? "border-maroon bg-soft-maroon text-maroon"
                            : "border-line bg-panel text-ink-primary group-hover:border-maroon"
                        } ${onThisDay ? "" : "opacity-60"}`}
                      >
                        {marker.name}
                      </span>
                    </button>
                  );
                })}

                {walkInfos.map((info) => {
                  const from = markerByCode.get(info.transition.from.building);
                  const to = markerByCode.get(info.transition.to.building);
                  if (!from || !to) return null;
                  const tone = info.warning ? (VERDICT_TONE[info.warning.verdict] as "warning" | "danger") : "success";
                  const midX = (from.xPercent + to.xPercent) / 2;
                  const midY = (from.yPercent + to.yPercent) / 2;
                  const slot = chipSlots.get(info.transition.key) ?? 0;
                  const isActive = activeTransition === info.transition.key;
                  const verdictText = info.warning ? verdictLabel(info.warning.verdict).toLowerCase() : "no warning";
                  return (
                    <button
                      key={info.transition.key}
                      type="button"
                      data-testid="walk-chip"
                      data-verdict={info.warning?.verdict ?? "none"}
                      aria-pressed={isActive}
                      aria-label={`${info.transition.from.courseId} to ${info.transition.to.courseId}: ${
                        info.minutes === null ? "walk time unavailable" : `${info.minutes} minute walk`
                      }, ${verdictText}`}
                      onClick={() => setActiveTransition(isActive ? null : info.transition.key)}
                      className={`absolute z-10 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-full border bg-panel px-2 py-0.5 text-xs font-bold shadow-md transition-transform hover:scale-105 ${CHIP_TONE[tone]} ${
                        isActive ? "ring-2 ring-maroon" : ""
                      }`}
                      style={{ left: `${midX}%`, top: `calc(${midY}% + ${slot * 26}px)` }}
                    >
                      <WalkIcon />
                      {chipText(info)}
                    </button>
                  );
                })}
              </>
            ) : null}

            {projection.markers.length === 0 && !buildingsQuery.isPending && !buildingsQuery.isError ? (
              <p className="absolute inset-x-3 bottom-3 rounded-md border border-line bg-panel/95 px-3 py-2 text-sm text-ink-secondary">
                {usedCodes.length === 0
                  ? "No in-person buildings to place on the map."
                  : "No usable coordinates for the selected buildings. See the walking details below."}
              </p>
            ) : null}
          </div>

          {analysisPending ? (
            <p className="text-sm text-ink-secondary" data-testid="map-analysis-pending">
              Checking which walks are too tight…
            </p>
          ) : null}
          {analysis.error && !analysis.data ? (
            <ErrorState title="Walking warnings unavailable" error={analysis.error} onRetry={analysis.retry} />
          ) : null}

          {active ? (
            <div role="region" aria-label="Transition details" data-testid="transition-details" className="rounded-xl border border-line bg-warm p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-primary">
                {active.transition.from.courseId} → {active.transition.to.courseId}
                {active.warning ? (
                  <Badge tone={VERDICT_TONE[active.warning.verdict]}>{verdictLabel(active.warning.verdict)}</Badge>
                ) : (
                  <Badge tone="success">No warning</Badge>
                )}
              </p>
              <p className="mt-1 text-ink-secondary">
                {active.transition.from.building} class ends {formatMinutes(active.transition.from.endMin)}, then{" "}
                {active.transition.to.building} class starts {formatMinutes(active.transition.to.startMin)}.
              </p>
              {active.warning ? (
                <p className="mt-1 text-ink-primary">{active.warning.detail}</p>
              ) : (
                <p className="mt-1 text-ink-secondary">The backend reported no tight or impossible walk here.</p>
              )}
            </div>
          ) : null}

          {/* Textual equivalent of every map interaction. Collapsed to keep the panel short. */}
          <details data-testid="transition-list" className="group rounded-xl border border-line">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-semibold text-ink-primary">
              Walking details{day ? ` for ${formatWeekdayShort(day)}` : ""}
              <span aria-hidden="true" className="text-ink-secondary transition-transform group-open:rotate-90">
                ▶
              </span>
            </summary>
            <div className="border-t border-line p-3">
              {days.length === 0 ? (
                <p className="text-sm text-ink-secondary" data-testid="transition-none">
                  No in-person meetings on the selected schedule.
                </p>
              ) : walkInfos.length === 0 ? (
                <p className="text-sm text-ink-secondary" data-testid="transition-none">
                  {selectedSections.length === 1
                    ? "Add one more course to see walking times."
                    : `Only one in-person stop on ${day ? formatWeekdayShort(day) : "this day"}, so there is no walk.`}
                </p>
              ) : (
                <ul className="space-y-2">
                  {walkInfos.map((info) => (
                    <li key={info.transition.key} className="rounded-lg border border-line bg-warm/50 px-3 py-2 text-sm">
                      <p className="font-medium text-ink-primary">
                        {info.transition.from.courseId} ({info.transition.from.building}) → {info.transition.to.courseId} (
                        {info.transition.to.building})
                      </p>
                      <p className="text-ink-secondary">
                        Ends {formatMinutes(info.transition.from.endMin)} · starts {formatMinutes(info.transition.to.startMin)}
                        {" · "}
                        {info.minutes === null ? "walk time unavailable" : `${info.minutes} min walk`}
                        {" · "}
                        {info.warning ? verdictLabel(info.warning.verdict) : "no warning"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
