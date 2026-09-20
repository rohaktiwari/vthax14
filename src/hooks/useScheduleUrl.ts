import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  MAX_CRNS,
  addCrn as addToList,
  parseCrnParam,
  removeCrn as removeFromList,
  serializeCrns,
} from "../lib/schedule";

export interface ScheduleUrlState {
  /** Ordered, de-duplicated CRNs parsed from the URL. */
  crns: string[];
  addCrn: (crn: string) => void;
  removeCrn: (crn: string) => void;
  /** Replace the whole selection (e.g. loading a demo schedule). */
  setCrns: (crns: string[]) => void;
  clear: () => void;
  isFull: boolean;
}

/**
 * URL-backed selected-schedule state.
 *
 * The `crns` query parameter is canonical. Unrelated parameters (for example
 * `panel` or `demo`) are preserved. Unknown CRNs are kept rather than silently
 * dropped; the backend reports them and a later phase offers removal.
 */
export function useScheduleUrl(): ScheduleUrlState {
  const [searchParams, setSearchParams] = useSearchParams();

  const crns = useMemo(() => parseCrnParam(searchParams.get("crns")), [searchParams]);

  const write = useCallback(
    (next: string[]) => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          if (next.length === 0) {
            params.delete("crns");
          } else {
            params.set("crns", serializeCrns(next));
          }
          return params;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const addCrn = useCallback((crn: string) => write(addToList(crns, crn)), [crns, write]);
  const removeCrn = useCallback((crn: string) => write(removeFromList(crns, crn)), [crns, write]);
  const setCrns = useCallback(
    (next: string[]) => write(parseCrnParam(serializeCrns(next))),
    [write],
  );
  const clear = useCallback(() => write([]), [write]);

  return { crns, addCrn, removeCrn, setCrns, clear, isFull: crns.length >= MAX_CRNS };
}
