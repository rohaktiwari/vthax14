import type { AnalysisMeta } from "../api/types";

/**
 * Backend data notes and heuristic disclaimer (frontend PRD §10.10/§11).
 * Notes are rendered verbatim and always visible; synthetic-data warnings are
 * never hidden behind a tooltip.
 */
export default function DataNotes({ meta }: { meta: AnalysisMeta }) {
  return (
    <section aria-label="Data notes" className="rounded-xl border border-line bg-warm p-3 text-xs shadow-sm">
      <h3 className="text-sm font-semibold text-ink-primary">Data notes</h3>
      <p className="mt-1 text-ink-secondary">Catalog term: {meta.term_id}</p>

      {meta.data_notes.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-ink-secondary">
          {meta.data_notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-ink-secondary">No data notes were reported for this term.</p>
      )}

      {meta.heuristic ? (
        <p className="mt-2 rounded-md border border-warning/40 bg-panel px-2 py-1.5 text-ink-primary">
          This analysis is a deterministic planning heuristic, not a prediction of your outcome.
        </p>
      ) : null}
    </section>
  );
}
