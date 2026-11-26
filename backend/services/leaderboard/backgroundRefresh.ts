import { logger } from "../../lib/logger.js";
import { GitHubError } from "../github/errors.js";
import type { CustomRange, Period } from "./periods.js";
import { rangeKeyFor } from "./periods.js";
import { syncLeaderboard } from "./sync.js";

/** After a failed run, leave the target alone for this long (protects quota). */
const FAILURE_COOLDOWN_MS = 5 * 60_000;
/** A rate-limit failure waits for GitHub's reset instead, but never longer than this. */
const MAX_RATE_LIMIT_COOLDOWN_MS = 60 * 60_000;
/** Upper bound on simultaneous GitHub collections started from reads. */
const MAX_CONCURRENT = 2;

/** Epoch ms until which a failed target is left alone. */
const retryAfter = new Map<string, number>();
const running = new Set<string>();

/** Rate limited: retry when the quota is back. Anything else: the flat cooldown. */
const cooldownFor = (error: unknown): number => {
    if (error instanceof GitHubError) {
        const resetAt = error.rateLimit?.resetAt;
        const limited = error.status === 429 || (error.status === 403 && error.rateLimit?.remaining === 0);
        if (limited && resetAt instanceof Date) {
            const wait = resetAt.getTime() - Date.now() + 5_000;
            return Math.min(Math.max(wait, FAILURE_COOLDOWN_MS), MAX_RATE_LIMIT_COOLDOWN_MS);
        }
    }
    return FAILURE_COOLDOWN_MS;
};

/**
 * Keeps snapshots current without ever blocking a read.
 *
 * Called on every leaderboard read. `syncLeaderboard` already skips work while
 * the stored snapshot is fresh, so this is cheap when nothing is due. When a
 * snapshot is missing or stale, one background run is started; readers keep
 * getting the stored data (or a 202) until it lands. Runs are deduplicated,
 * capped, and paused after a failure so a broken token or an exhausted quota
 * cannot be hammered by page loads.
 */
export const requestRefresh = (
    orgLogin: string,
    period: Period,
    customRange?: CustomRange,
): void => {
    const key = `${orgLogin.toLowerCase()}:${period}:${rangeKeyFor(period, customRange)}`;

    if (running.has(key) || running.size >= MAX_CONCURRENT) return;

    const blockedUntil = retryAfter.get(key);
    if (blockedUntil !== undefined && Date.now() < blockedUntil) return;

    running.add(key);
    void syncLeaderboard(orgLogin, period, { customRange })
        .then(() => {
            retryAfter.delete(key);
        })
        .catch((error: unknown) => {
            retryAfter.set(key, Date.now() + cooldownFor(error));
            logger.error("background refresh failed", { key, err: error });
        })
        .finally(() => {
            running.delete(key);
        });
};
