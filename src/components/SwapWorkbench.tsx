import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Section, SwapResponse } from "../api/types";
import { useSwap } from "../api/hooks";
import { normalizeApiError } from "../api/errors";
import { queryKeys } from "../api/queryKeys";
import { useSchedule } from "../context/ScheduleContext";
import { formatMeetingSummary, formatModality } from "../lib/time";
import { formatRiskScore, riskBand } from "../lib/risk";
import { describeDelta, findAlternativeSections, type DeltaDirection } from "../lib/swap";
import ErrorState from "./ErrorState";
import Skeleton from "./Skeleton";

interface SwapWorkbenchProps {
  open: boolean;
  initialDropCrn?: string | null;
  initialAddCrn?: string | null;
  onClose: () => void;
}

const DELTA_TONE: Record<DeltaDirection, string> = {
  decrease: "border-success/40 bg-panel text-success",
  none: "border-line bg-warm text-ink-secondary",
  increase: "border-danger/40 bg-panel text-danger",
};

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function sectionHeading(section: Section): string {
  return `${section.course_id} · CRN ${section.crn}`;
}

/** Meeting/building/time summary from documented fields; no inference. */
function locationSummary(section: Section): string {
  const inPerson = section.meetings.filter((meeting) => meeting.building);
  if (inPerson.length === 0) return formatModality(section.modality);
  return inPerson
    .map(
      (meeting) =>
        `${formatMeetingSummary(meeting)} · ${meeting.building}${meeting.room ? ` ${meeting.room}` : ""}`,
    )
    .join(" · ");
}

/**
 * Swap comparison workbench (frontend PRD §10.11).
 *
 * Sends the documented `{ current_crns, drop_crn, add_crn }` body and renders the
 * backend `before`, `after`, `delta`, and warning-change summary unchanged. A
 * preview never mutates the URL; `Apply swap` is only offered for a successful
 * result, and applying replaces the dropped CRN at its exact URL index.
 */
export default function SwapWorkbench({
  open,
  initialDropCrn = null,
  initialAddCrn = null,
  onClose,
}: SwapWorkbenchProps) {
  const { crns, sectionsByCrn, applySwap } = useSchedule();
  const swap = useSwap();
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);

  const [dropCrn, setDropCrn] = useState<string | null>(initialDropCrn ?? crns[0] ?? null);
  const [addCrn, setAddCrn] = useState<string | null>(initialAddCrn ?? null);
  const [result, setResult] = useState<SwapResponse | null>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => !element.hasAttribute("disabled"),
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, [open, onClose]);

  const cachedSections = useMemo(() => Object.values(sectionsByCrn), [sectionsByCrn]);
  const dropSection = dropCrn ? sectionsByCrn[dropCrn] ?? null : null;

  const alternatives = useMemo(
    () => findAlternativeSections(cachedSections, { dropCrn, selectedCrns: crns }),
    [cachedSections, dropCrn, crns],
  );

  // A backend/demo-provided add CRN may not be cached (no section-by-CRN
  // endpoint). Surface it explicitly rather than pretending it is an alternative.
  const prefilledCandidate =
    addCrn && addCrn !== dropCrn && !crns.includes(addCrn) && !alternatives.some((section) => section.crn === addCrn)
      ? { crn: addCrn, section: sectionsByCrn[addCrn] ?? null }
      : null;

  const canPreview = Boolean(
    dropCrn && addCrn && crns.length > 0 && dropCrn !== addCrn && !crns.includes(addCrn),
  );

  const delta = result
    ? describeDelta(result.delta, result.before.risk_score, result.after.risk_score)
    : null;

  const beforeSection =
    result && dropCrn ? result.before.sections.find((section) => section.crn === dropCrn) ?? null : null;
  const afterSection =
    result && addCrn ? result.after.sections.find((section) => section.crn === addCrn) ?? null : null;

  function handlePreview() {
    if (!dropCrn || !addCrn || !canPreview) return;
    setResult(null);
    swap.mutate(
      { current_crns: crns, drop_crn: dropCrn, add_crn: addCrn },
      { onSuccess: (data) => setResult(data) },
    );
  }

  function handleApply() {
    // Only reachable when a successful backend result exists (PRD §10.11).
    if (!result || !dropCrn || !addCrn) return;
    applySwap(dropCrn, addCrn);
    void queryClient.invalidateQueries({ queryKey: queryKeys.analyze });
    onClose();
  }

  if (!open) return null;

  const dropOptions = crns.map((crn) => ({ crn, section: sectionsByCrn[crn] ?? null }));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-primary/40 p-4 backdrop-blur-sm">
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="swap-workbench-title"
        className="my-6 w-full max-w-2xl rounded-2xl border border-line bg-panel shadow-xl"
        data-testid="swap-workbench"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 id="swap-workbench-title" className="text-lg font-semibold text-ink-primary">
              Compare a section swap
            </h2>
            <p className="text-xs text-ink-secondary">
              The backend evaluates both schedules. Nothing changes until you confirm.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close swap workbench"
            className="rounded-lg border border-line bg-panel px-2.5 py-1 text-xs font-semibold text-ink-secondary transition-colors hover:bg-soft-maroon hover:text-ink-primary"
          >
            Close
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          {crns.length === 0 ? (
            <p className="text-sm text-ink-secondary" data-testid="swap-empty">
              Select at least one section before comparing a swap.
            </p>
          ) : (
            <>
              <div>
                <label htmlFor="swap-drop" className="block text-sm font-medium text-ink-primary">
                  Section to drop
                </label>
                <select
                  id="swap-drop"
                  data-testid="swap-drop"
                  value={dropCrn ?? ""}
                  onChange={(event) => {
                    setDropCrn(event.target.value || null);
                    setResult(null);
                  }}
                  className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink-primary"
                >
                  <option value="">Choose a section…</option>
                  {dropOptions.map(({ crn, section }) => (
                    <option key={crn} value={crn}>
                      {section ? sectionHeading(section) : `CRN ${crn} (details unavailable)`}
                    </option>
                  ))}
                </select>
                {dropSection ? (
                  <p className="mt-1 text-xs text-ink-secondary">{locationSummary(dropSection)}</p>
                ) : dropCrn ? (
                  <p className="mt-1 text-xs text-ink-secondary">
                    No cached details for this CRN; the backend still validates it.
                  </p>
                ) : null}
              </div>

              <div>
                <p className="text-sm font-medium text-ink-primary">Add an alternative</p>
                <p className="text-xs text-ink-secondary">
                  Alternatives come only from sections already loaded in this session.
                </p>

                {prefilledCandidate ? (
                  <button
                    type="button"
                    data-testid="swap-prefilled-add"
                    aria-pressed={addCrn === prefilledCandidate.crn}
                    onClick={() => {
                      setAddCrn(prefilledCandidate.crn);
                      setResult(null);
                    }}
                    className={`mt-2 w-full rounded-lg border p-2 text-left text-sm transition-colors ${
                      addCrn === prefilledCandidate.crn
                        ? "border-maroon bg-soft-maroon"
                        : "border-line bg-warm hover:border-maroon/40 hover:bg-panel"
                    }`}
                  >
                    <span className="block font-medium text-ink-primary">
                      {prefilledCandidate.section
                        ? sectionHeading(prefilledCandidate.section)
                        : `CRN ${prefilledCandidate.crn}`}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-secondary">
                      {prefilledCandidate.section
                        ? locationSummary(prefilledCandidate.section)
                        : "Provided by the demo setup; details unavailable."}
                    </span>
                  </button>
                ) : null}

                {alternatives.length === 0 && !prefilledCandidate ? (
                  <p className="mt-2 text-xs text-ink-secondary" data-testid="swap-no-alternatives">
                    No alternative sections are available yet. Search for the same course to load
                    more sections.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2" data-testid="swap-alternatives">
                    {alternatives.map((section) => (
                      <li key={section.crn}>
                        <button
                          type="button"
                          aria-pressed={addCrn === section.crn}
                          onClick={() => {
                            setAddCrn(section.crn);
                            setResult(null);
                          }}
                          className={`w-full rounded-lg border p-2 text-left text-sm transition-colors ${
                            addCrn === section.crn
                              ? "border-maroon bg-soft-maroon"
                              : "border-line bg-warm hover:border-maroon/40 hover:bg-panel"
                          }`}
                        >
                          <span className="block font-medium text-ink-primary">{sectionHeading(section)}</span>
                          <span className="mt-0.5 block text-xs text-ink-secondary">
                            {locationSummary(section)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <button
                type="button"
                data-testid="swap-preview"
                disabled={!canPreview || swap.isPending}
                onClick={handlePreview}
                className="rounded-lg border border-maroon bg-maroon px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-maroon-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {swap.isPending ? "Comparing…" : "Preview comparison"}
              </button>

              {swap.isPending ? <Skeleton lines={4} /> : null}

              {swap.isError ? (
                <ErrorState
                  title="Swap could not be evaluated"
                  error={normalizeApiError(swap.error)}
                  onRetry={handlePreview}
                />
              ) : null}

              {result && !swap.isError ? (
                <div className="space-y-3" data-testid="swap-result">
                  <div className="rounded-xl border border-line bg-warm p-3">
                    <p className="text-sm font-semibold text-ink-primary">Risk before / after</p>
                    <p className="mt-1 text-xs text-ink-secondary" data-testid="swap-summary-risk">
                      Backend summary: {result.summary.risk}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                      <p className="text-ink-secondary">
                        Before:{" "}
                        <span className="font-semibold text-ink-primary">
                          {formatRiskScore(result.before.risk_score)}
                        </span>{" "}
                        ({riskBand(result.before.risk_score).label})
                      </p>
                      <p className="text-ink-secondary">
                        After:{" "}
                        <span className="font-semibold text-ink-primary">
                          {formatRiskScore(result.after.risk_score)}
                        </span>{" "}
                        ({riskBand(result.after.risk_score).label})
                      </p>
                    </div>
                    {delta ? (
                      <p
                        data-testid="swap-delta"
                        className={`mt-2 rounded-lg border px-2.5 py-1.5 text-sm font-medium ${DELTA_TONE[delta.direction]}`}
                      >
                        {delta.text}
                      </p>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-line bg-panel p-3 text-sm">
                    <p className="font-semibold text-ink-primary">Warning changes</p>
                    <p className="mt-1 text-ink-secondary" data-testid="swap-warning-changes">
                      {result.summary.resolved_warnings} resolved · {result.summary.new_warnings} new
                    </p>
                    <p className="mt-1 text-xs text-ink-secondary">
                      Before warnings: {result.before.commute_warnings.length} · after warnings:{" "}
                      {result.after.commute_warnings.length}
                    </p>
                  </div>

                  <div className="rounded-xl border border-line bg-panel p-3 text-sm" data-testid="swap-changed-sections">
                    <p className="font-semibold text-ink-primary">Changed meeting / building details</p>
                    <div className="mt-2 space-y-2 text-xs">
                      <p className="text-ink-secondary">
                        <span className="font-semibold text-ink-primary">Removed: </span>
                        {beforeSection
                          ? `${sectionHeading(beforeSection)} — ${locationSummary(beforeSection)}`
                          : `CRN ${dropCrn ?? "?"} (not present in the before schedule)`}
                      </p>
                      <p className="text-ink-secondary">
                        <span className="font-semibold text-ink-primary">Added: </span>
                        {afterSection
                          ? `${sectionHeading(afterSection)} — ${locationSummary(afterSection)}`
                          : `CRN ${addCrn ?? "?"} (not present in the after schedule)`}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      data-testid="swap-apply"
                      onClick={handleApply}
                      className="rounded-lg border border-maroon bg-maroon px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-maroon-dark"
                    >
                      Apply swap
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-lg border border-line bg-panel px-3.5 py-2 text-sm font-semibold text-ink-primary transition-colors hover:bg-soft-maroon"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
