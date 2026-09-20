import { useMemo, useState } from "react";
import type { CommuteVerdict, Weekday } from "../api/types";
import { useAnalysis, useBuildingsMatrix } from "../api/hooks";
import { normalizeApiError } from "../api/errors";
import { useSchedule } from "../context/ScheduleContext";
import { useMapSelection } from "../context/MapSelectionContext";
import { formatMinutes, formatWeekdayShort } from "../lib/time";
import { projectCoordinates, walkMinutesFor } from "../lib/mapProjection";
import {
  buildDayTransitions,
  transitionDays,
  warningKey,
  type DayTransition,
} from "../lib/transitions";
import ErrorState from "./ErrorState";
import Skeleton from "./Skeleton";

const VERDICT_STROKE: Record<CommuteVerdict, string> = {
  comfortable: "var(--color-info)",
  tight: "var(--color-warning)",
  impossible: "var(--color-danger)",
};

const VERDICT_BADGE: Record<CommuteVerdict, string> = {
  comfortable: "border-success/40 bg-panel text-success",
  tight: "border-warning/50 bg-panel text-warning",
  impossible: "border-danger/50 bg-panel text-danger",
};

const NEUTRAL_STROKE = "var(--color-text-secondary)";

function verdictText(verdict: CommuteVerdict): string {
  if (verdict === "impossible") return "Impossible";
  if (verdict === "tight") return "Tight";
  return "Comfortable";
}

function MapPin({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 24 32" className="h-7 w-5 drop-shadow" aria-hidden="true">
      <path
        d="M12 1C6.5 1 2 5.6 2 11.2 2 19 12 31 12 31S22 19 22 11.2C22 5.6 17.5 1 12 1Z"
        fill="var(--color-maroon)"
      />
      <circle cx="12" cy="11" r="4" fill="var(--color-panel)" />
      <title>{label}</title>
    </svg>
  );
}

/**
 * Schematic campus map and its fully equivalent textual transition list
 * (frontend PRD §10.4, §12.8).
 *
 * Uses the committed local `public/campus-map.svg` backdrop, the documented
 * buildings matrix for coordinates/labels, and backend analysis for warnings.
 * It never loads tiles or routing services and never derives walk times or
 * verdicts locally. When coordinates or the matrix are missing, the textual
 * daily transition list becomes the clear fallback.
 */
export default function CampusMap() {
  const { crns, selectedSections, unavailableCrns } = useSchedule();
  const buildingsQuery = useBuildingsMatrix(false);
  const analysisQuery = useAnalysis(crns);
  const mapSelection = useMapSelection();
  const [requestedDay, setRequestedDay] = useState<Weekday | null>(null);
  const [activeTransition, setActiveTransition] = useState<string | null>(null);

  const days = useMemo(() => transitionDays(selectedSections), [selectedSections]);
  const day = requestedDay && days.includes(requestedDay) ? requestedDay : days[0] ?? null;
  const transitions = useMemo(
    () => (day ? buildDayTransitions(selectedSections, day) : []),
    [selectedSections, day],
  );

  const buildings = useMemo(() => buildingsQuery.data?.buildings ?? {}, [buildingsQuery.data]);
  const walk = buildingsQuery.data?.walk;
  const warnings = useMemo(
    () => analysisQuery.data?.commute_warnings ?? [],
    [analysisQuery.data],
  );

  const warningsByKey = useMemo(() => {
    const map = new Map<string, (typeof warnings)[number]>();
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
    for (const warning of warnings) {
      codes.add(warning.from.building);
      codes.add(warning.to.building);
    }
    return [...codes].sort();
  }, [selectedSections, warnings]);

  const projection = useMemo(
    () =>
      projectCoordinates(
        usedCodes.map((code) => {
          const building = buildings[code];
          return {
            code,
            name: building?.name ?? code,
            lat: building?.lat,
            lng: building?.lng,
          };
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
      for (const code of codes) {
        const list = map.get(code) ?? [];
        list.push(section.crn);
        map.set(code, list);
      }
    }
    return map;
  }, [selectedSections]);

  const warningBuildingCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const warning of warnings) {
      if (day && warning.day !== day) continue;
      codes.add(warning.from.building);
      codes.add(warning.to.building);
    }
    return codes;
  }, [warnings, day]);

  const active = useMemo(
    () => transitions.find((transition) => transition.key === activeTransition) ?? null,
    [transitions, activeTransition],
  );
  const activeWarning = active
    ? warningsByKey.get(warningKey(active.day, active.from.crn, active.to.crn)) ?? null
    : null;

  const detailsUnavailable = crns.length > 0 && selectedSections.length === 0;
  const analysisPending = crns.length >= 2 && analysisQuery.isPending;
  const analysisFailed = crns.length >= 2 && analysisQuery.isError;

  function transitionWarning(transition: DayTransition) {
    return warningsByKey.get(warningKey(transition.day, transition.from.crn, transition.to.crn)) ?? null;
  }

  function handleMarkerClick(code: string) {
    if (mapSelection.highlightedBuilding === code) {
      mapSelection.clearHighlight();
    } else {
      mapSelection.setHighlightedBuilding(code, crnsByBuilding.get(code) ?? []);
    }
  }

  if (crns.length === 0) {
    return (
      <section aria-label="Campus map" className="rounded-2xl border border-line bg-panel shadow-card">
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-base font-semibold text-ink-primary">Campus Map</h2>
        </header>
        <p className="p-4 text-sm text-ink-secondary" data-testid="map-empty">
          Select sections to see their buildings and walking transitions on the local schematic.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Campus map" className="rounded-2xl border border-line bg-panel shadow-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-ink-primary">Campus Map</h2>
          <p className="text-xs text-ink-secondary">
            Local schematic only. No map tiles or routing services.
          </p>
        </div>
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
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
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

      {detailsUnavailable ? (
        <div className="m-4 rounded-lg border border-warning/40 bg-warm p-3 text-xs" data-testid="map-unavailable">
          <p className="font-semibold text-warning">
            Building locations unavailable for {unavailableCrns.length} selected section
            {unavailableCrns.length === 1 ? "" : "s"}
          </p>
          <p className="mt-1 text-ink-secondary">
            The documented API has no section-by-CRN endpoint, so these CRNs cannot be mapped here.
            Add them again from search results or remove them.
          </p>
        </div>
      ) : (
        <div className="space-y-3 p-4">
          {/* Map region */}
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-line map-grid map-canvas">
            <img
              src="/campus-map.svg"
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover"
            />
            {buildingsQuery.isPending ? (
              <div className="absolute inset-0 grid place-items-center bg-panel/70 p-6">
                <div className="w-48">
                  <Skeleton lines={3} />
                </div>
              </div>
            ) : null}
            {buildingsQuery.isError ? (
              <div className="absolute inset-0 grid place-items-center overflow-auto bg-panel/85 p-4">
                <ErrorState
                  title="Building data unavailable"
                  error={normalizeApiError(buildingsQuery.error)}
                  onRetry={() => void buildingsQuery.refetch()}
                />
              </div>
            ) : null}

            {projection.markers.length > 0 ? (
              <>
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="absolute inset-0 h-full w-full"
                  aria-hidden="true"
                >
                  {transitions.map((transition) => {
                    const from = markerByCode.get(transition.from.building);
                    const to = markerByCode.get(transition.to.building);
                    if (!from || !to) return null;
                    const warning = transitionWarning(transition);
                    return (
                      <line
                        key={transition.key}
                        x1={from.xPercent}
                        y1={from.yPercent}
                        x2={to.xPercent}
                        y2={to.yPercent}
                        stroke={warning ? VERDICT_STROKE[warning.verdict] : NEUTRAL_STROKE}
                        strokeWidth={warning ? 1 : 0.6}
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
                  const warningHere = warningBuildingCodes.has(marker.code);
                  return (
                    <button
                      key={marker.code}
                      type="button"
                      aria-pressed={highlighted}
                      aria-label={`${marker.name} (${marker.code}), ${crnCount} selected section${
                        crnCount === 1 ? "" : "s"
                      }${warningHere ? ", has a walking warning" : ""}`}
                      onClick={() => handleMarkerClick(marker.code)}
                      className="group absolute flex -translate-x-1/2 -translate-y-full flex-col items-center transition-transform hover:z-10 hover:scale-[1.04]"
                      style={{ left: `${marker.xPercent}%`, top: `${marker.yPercent}%` }}
                    >
                      <MapPin label={marker.name} />
                      <span
                        className={`mt-1 max-w-28 break-words rounded-md border px-1.5 py-0.5 text-center text-[0.6875rem] font-medium shadow-sm transition-colors ${
                          highlighted
                            ? "border-maroon bg-soft-maroon text-maroon"
                            : "border-line bg-panel text-ink-primary group-hover:border-maroon group-hover:bg-soft-maroon"
                        }`}
                      >
                        {marker.name}
                      </span>
                    </button>
                  );
                })}
              </>
            ) : null}

            {projection.markers.length === 0 && !buildingsQuery.isPending && !buildingsQuery.isError ? (
              <p className="absolute inset-x-3 bottom-3 rounded-md border border-line bg-panel/95 px-3 py-2 text-xs text-ink-secondary">
                {usedCodes.length === 0
                  ? "No in-person buildings to place on the map."
                  : "No usable coordinates for the selected buildings; see the transition list below."}
              </p>
            ) : null}
          </div>

          {/* Legend */}
          <ul className="flex flex-wrap gap-2" aria-label="Map legend">
            <li className="inline-flex items-center gap-1.5 rounded-full border border-line bg-warm px-2.5 py-1 text-[0.6875rem] font-medium text-ink-secondary">
              <span className="h-2.5 w-2.5 rounded-full bg-maroon" aria-hidden="true" />
              Selected building
            </li>
            <li className="inline-flex items-center gap-1.5 rounded-full border border-line bg-warm px-2.5 py-1 text-[0.6875rem] font-medium text-ink-secondary">
              <span className="h-0.5 w-6 border-t-2 border-dashed border-warning" aria-hidden="true" />
              Tight transition
            </li>
            <li className="inline-flex items-center gap-1.5 rounded-full border border-line bg-warm px-2.5 py-1 text-[0.6875rem] font-medium text-ink-secondary">
              <span className="h-0.5 w-6 border-t-2 border-dashed border-danger" aria-hidden="true" />
              Impossible transition
            </li>
            <li className="inline-flex items-center gap-1.5 rounded-full border border-line bg-warm px-2.5 py-1 text-[0.6875rem] font-medium text-ink-secondary">
              <span className="h-0.5 w-6 border-t-2 border-dashed border-ink-secondary" aria-hidden="true" />
              Transition (no backend warning)
            </li>
          </ul>

          {analysisPending ? (
            <p className="text-xs text-ink-secondary" data-testid="map-analysis-pending">
              Checking walking warnings…
            </p>
          ) : null}
          {analysisFailed ? (
            <ErrorState
              title="Walking warnings unavailable"
              error={normalizeApiError(analysisQuery.error)}
              onRetry={() => void analysisQuery.refetch()}
            />
          ) : null}

          {/* Textual equivalent of every map interaction, always rendered. */}
          <div data-testid="transition-list">
            <h3 className="text-sm font-semibold text-ink-primary">
              Daily transitions{day ? ` · ${formatWeekdayShort(day)}` : ""}
            </h3>

            {days.length === 0 ? (
              <p className="mt-1 text-xs text-ink-secondary" data-testid="transition-none">
                No in-person meetings on the selected schedule.
              </p>
            ) : transitions.length === 0 ? (
              <p className="mt-1 text-xs text-ink-secondary" data-testid="transition-none">
                {selectedSections.length === 1
                  ? "Add at least one more section to see walking transitions."
                  : `Only one in-person stop on ${day ? formatWeekdayShort(day) : "this day"}; no transitions.`}
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {transitions.map((transition) => {
                  const warning = transitionWarning(transition);
                  const matrixMinutes = walkMinutesFor(walk, transition.from.building, transition.to.building);
                  const isActive = activeTransition === transition.key;
                  return (
                    <li key={transition.key}>
                      <button
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => setActiveTransition(isActive ? null : transition.key)}
                        className={`w-full rounded-xl border p-2.5 text-left text-xs transition-colors ${
                          isActive
                            ? "border-maroon bg-soft-maroon"
                            : "border-line bg-warm hover:border-maroon/40 hover:bg-panel"
                        }`}
                      >
                        <span className="block font-medium text-ink-primary">
                          {transition.from.courseId} ({transition.from.building}) →{" "}
                          {transition.to.courseId} ({transition.to.building})
                        </span>
                        <span className="mt-0.5 block text-ink-secondary">
                          Ends {formatMinutes(transition.from.endMin)} · starts{" "}
                          {formatMinutes(transition.to.startMin)}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-2">
                          {warning ? (
                            <span
                              className={`inline-block rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold ${VERDICT_BADGE[warning.verdict]}`}
                            >
                              {verdictText(warning.verdict)}
                            </span>
                          ) : (
                            <span className="text-ink-secondary">No backend warning</span>
                          )}
                          {matrixMinutes !== null ? (
                            <span className="text-ink-secondary">Committed matrix walk: {matrixMinutes} min</span>
                          ) : (
                            <span className="text-ink-secondary">Walk time unavailable</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {active ? (
            <div
              role="region"
              aria-label="Transition details"
              data-testid="transition-details"
              className="rounded-xl border border-line bg-panel p-3 text-xs shadow-card"
            >
              <p className="text-sm font-semibold text-ink-primary">
                {active.from.courseId} → {active.to.courseId}
              </p>
              <p className="mt-1 text-ink-secondary">
                {active.from.building} (ends {formatMinutes(active.from.endMin)}) →{" "}
                {active.to.building} (starts {formatMinutes(active.to.startMin)})
              </p>
              {activeWarning ? (
                <>
                  <p className="mt-1 font-semibold text-ink-primary">
                    Verdict: {verdictText(activeWarning.verdict)}
                  </p>
                  <p className="mt-1 text-ink-secondary">
                    Walk {activeWarning.walk_min} min · adjusted {activeWarning.adjusted_walk_min} min ·
                    available gap {activeWarning.gap_min} min
                  </p>
                  <p className="mt-1 text-ink-secondary">{activeWarning.detail}</p>
                </>
              ) : (
                <p className="mt-1 text-ink-secondary">
                  The backend reported no tight or impossible warning for this transition.
                </p>
              )}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
