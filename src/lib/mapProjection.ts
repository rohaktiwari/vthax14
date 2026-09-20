import type { BuildingsMatrixResponse, WalkEntry } from "../api/types";

/**
 * Pure local map projection (frontend PRD §10.4).
 *
 * Only already-supplied latitude/longitude values are projected onto the local
 * schematic. Nothing here calculates walking duration, tight/impossible
 * verdicts, or routes; walk minutes are read directly from the committed matrix.
 */

export interface CoordinateInput {
  code: string;
  name: string;
  lat: number | null | undefined;
  lng: number | null | undefined;
}

export interface ProjectedMarker {
  code: string;
  name: string;
  /** 0–100 within the schematic viewport. */
  xPercent: number;
  /** 0–100 within the schematic viewport (north is up). */
  yPercent: number;
}

export interface ProjectionResult {
  markers: ProjectedMarker[];
  /** Building codes that could not be projected (missing/invalid coordinates). */
  unplaced: string[];
}

/** Padding (fraction of the viewport) so markers never sit on the edge. */
const EDGE_PAD = 0.08;

/** A finite lat/lng inside valid geographic bounds. */
export function isValidCoordinate(
  lat: number | null | undefined,
  lng: number | null | undefined,
): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

function scale(value: number, min: number, max: number): number {
  const span = max - min;
  // Degenerate bounds (all buildings share an axis value): center that axis.
  const normalized = span === 0 ? 0.5 : (value - min) / span;
  return (EDGE_PAD + normalized * (1 - 2 * EDGE_PAD)) * 100;
}

/**
 * Project supplied coordinates into 0–100 viewport percentages.
 * Invalid entries are reported in `unplaced` rather than guessed.
 */
export function projectCoordinates(entries: readonly CoordinateInput[]): ProjectionResult {
  const valid = entries.filter((entry) => isValidCoordinate(entry.lat, entry.lng));
  const unplaced = entries
    .filter((entry) => !isValidCoordinate(entry.lat, entry.lng))
    .map((entry) => entry.code);

  if (valid.length === 0) return { markers: [], unplaced };

  if (valid.length === 1) {
    const only = valid[0]!;
    return {
      markers: [{ code: only.code, name: only.name, xPercent: 50, yPercent: 50 }],
      unplaced,
    };
  }

  const lats = valid.map((entry) => entry.lat as number);
  const lngs = valid.map((entry) => entry.lng as number);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const markers = valid.map((entry) => ({
    code: entry.code,
    name: entry.name,
    xPercent: scale(entry.lng as number, minLng, maxLng),
    // Larger latitude is further north, which is higher on screen.
    yPercent: 100 - scale(entry.lat as number, minLat, maxLat),
  }));

  return { markers, unplaced };
}

/**
 * Look up committed walk minutes for an unordered building pair. The matrix key
 * is `CODE_A|CODE_B` with A < B (documented contract); this only normalizes the
 * lookup order and never derives or estimates a duration.
 */
export function walkMinutesFor(
  walk: BuildingsMatrixResponse["walk"] | undefined,
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  if (!walk || !a || !b || a === b) return null;
  const key = [a, b].sort().join("|");
  const entry = walk[key];
  if (entry === undefined) return null;
  const minutes = typeof entry === "number" ? entry : (entry as WalkEntry).minutes;
  return Number.isFinite(minutes) ? minutes : null;
}
