import type {MemoryProfile} from './profile.js';

export const DEFAULT_THRESHOLD_DAYS = 90;

/**
 * Resolves the staleness threshold (days) for a given memory category.
 * Priority: per_category override → profile default_days → system default (90).
 */
export function resolveThreshold(
  category: string | undefined,
  profile: MemoryProfile | null
): number {
  if (profile?.retention) {
    if (category && profile.retention.per_category?.[category]) {
      return profile.retention.per_category[category]!;
    }
    if (profile.retention.default_days) {
      return profile.retention.default_days;
    }
  }
  return DEFAULT_THRESHOLD_DAYS;
}

/**
 * Returns the number of whole days elapsed since lastConfirmed.
 * `now` is injectable for deterministic testing.
 */
export function getDaysSince(lastConfirmed: string, now: Date = new Date()): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((now.getTime() - new Date(lastConfirmed).getTime()) / msPerDay);
}

/**
 * Computes confidence as a value in [0, 1].
 * confidence = max(0, 1 - daysSince / thresholdDays)
 * `now` is injectable for deterministic testing.
 */
export function computeConfidence(
  lastConfirmed: string,
  thresholdDays: number = DEFAULT_THRESHOLD_DAYS,
  now: Date = new Date()
): number {
  const days = getDaysSince(lastConfirmed, now);
  return Math.max(0, 1 - days / thresholdDays);
}

/**
 * Returns the display label for a given confidence value.
 * confidence === 0 → STALE, 0 < confidence < 0.5 → AGING
 */
export function getHealthLabel(confidence: number): 'STALE' | 'AGING' {
  return confidence === 0 ? 'STALE' : 'AGING';
}
