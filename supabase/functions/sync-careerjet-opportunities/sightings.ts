// S7/R7 helper: exported repeated-fingerprint-sightings counter.
// `repeated_fingerprint_sightings` counts resolver attempts that occur AFTER
// the first observation of a given fingerprint within the same Edge run.
// 3 attempts with the same fingerprint => 2 repeats.
//
// This module is the single source of truth for the counter. The Edge
// run loop and the Deno unit test both import `noteFingerprintSighting`
// instead of inlining the Set logic.

export type SightingTracker = {
  /** Distinct fingerprints observed so far. */
  readonly distinct: Set<string>;
  /** Count of resolver attempts after first sighting of a fingerprint. */
  repeats: number;
};

export function createSightingTracker(): SightingTracker {
  return { distinct: new Set<string>(), repeats: 0 };
}

/**
 * Record a fingerprint sighting. Returns true if this is the FIRST time the
 * fingerprint is seen in this run; false if it's a repeat (counter bumped).
 */
export function noteFingerprintSighting(
  tracker: SightingTracker,
  fingerprint: string,
): boolean {
  if (tracker.distinct.has(fingerprint)) {
    tracker.repeats += 1;
    return false;
  }
  tracker.distinct.add(fingerprint);
  return true;
}

/** Convenience aggregator used by the Edge response builder. */
export function summarizeSightings(tracker: SightingTracker): {
  distinct_valid_fingerprints: number;
  repeated_fingerprint_sightings: number;
} {
  return {
    distinct_valid_fingerprints: tracker.distinct.size,
    repeated_fingerprint_sightings: tracker.repeats,
  };
}
