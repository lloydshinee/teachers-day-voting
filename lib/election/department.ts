import { z } from "zod";

/**
 * Election state machine — spec §5 (per-department advancement markers).
 *
 * Mirrors the `election_departments` participation row (spec §3):
 * `finalists_locked_at`, `winner_published_at`, `tie_pending`. A tied
 * department holds (tie_pending) while other departments advance, so every
 * marker below is department-scoped and independent of sibling departments.
 *
 * Timestamps are ISO-8601 strings with an offset (as `timestamptz` serializes),
 * or null when the marker is not yet set.
 */

export const departmentMarkersSchema = z.object({
  electionId: z.uuid(),
  departmentId: z.uuid(),
  // Database-read timestamps: PostgREST returns timestamptz with a numeric
  // offset (+00:00), so offset form must be accepted here. Naive datetimes
  // are still rejected.
  finalistsLockedAt: z.iso.datetime({ offset: true }).nullable(),
  winnerPublishedAt: z.iso.datetime({ offset: true }).nullable(),
  tiePending: z.boolean(),
});

export type DepartmentMarkers = z.infer<typeof departmentMarkersSchema>;

export function isFinalistsLocked(markers: DepartmentMarkers): boolean {
  return markers.finalistsLockedAt !== null;
}

export function isWinnerPublished(markers: DepartmentMarkers): boolean {
  return markers.winnerPublishedAt !== null;
}

export function isTiePending(markers: DepartmentMarkers): boolean {
  return markers.tiePending;
}
