import { schedule } from "node-cron";
import type { ScheduledTask } from "node-cron";
import { config } from "../config/config.js";
import { logger } from "../lib/logger.js";
import type { Period } from "../services/leaderboard/periods.js";
import { syncLeaderboard } from "../services/leaderboard/sync.js";

/**
 * `custom` cannot be scheduled: it needs a range from the caller. Both fixed
 * periods are force-refreshed on every tick, and `all` runs after `month`, so
 * the all-time window ends at or after the monthly one. Without the force, the
 * 24h read-cache TTL would let the all-time snapshot lag the 15-minute monthly
 * one, and month could report activity that all-time does not.
 */
const SCHEDULED_PERIODS: readonly Period[] = ["month", "all"];

interface OrgRefreshOutcome {
    orgLogin: string;
    period: Period;
    ok: boolean;
    entryCount?: number;
    error?: string;
}

let task: ScheduledTask | undefined;

/**
 * Refreshes every period for one org, sequentially. A failure in one period
 * is recorded and swallowed so the remaining periods still run — the read
 * path keeps serving the previous snapshot either way.
 */
const refreshOrg = async (orgLogin: string): Promise<OrgRefreshOutcome[]> => {
    const outcomes: OrgRefreshOutcome[] = [];

    for (const period of SCHEDULED_PERIODS) {
        try {
            const result = await syncLeaderboard(orgLogin, period, { force: true });
            outcomes.push({
                orgLogin: result.orgLogin,
                period,
                ok: true,
                entryCount: result.entryCount,
            });
            logger.info(`refreshed ${result.orgLogin}/${period}`, {
                org: result.orgLogin,
                period,
                entryCount: result.entryCount,
            });
            for (const warning of result.warnings) {
                logger.debug(`warning for ${result.orgLogin}/${period}`, {
                    org: result.orgLogin,
                    period,
                    warning,
                });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            outcomes.push({
                orgLogin: orgLogin.toLowerCase(),
                period,
                ok: false,
                error: message,
            });
            logger.error(`refresh failed for ${orgLogin}/${period}`, {
                org: orgLogin,
                period,
                error: message,
            });
        }
    }

    return outcomes;
};

const runScheduled = async (orgs: readonly string[]): Promise<void> => {
    // One org at a time: a large org already issues many GitHub requests.
    for (const org of orgs) {
        await refreshOrg(org);
    }
};

/**
 * Runs the scheduled refresh immediately. Used at boot so the default org has
 * a snapshot before the first visitor arrives.
 */
export const refreshOrgsNow = async (orgs: readonly string[]): Promise<void> => {
    await runScheduled(orgs);
};

/**
 * Starts the periodic refresh. An empty `LEADERBOARD_ORGS` disables the
 * scheduler entirely — manual refresh still works for any org.
 */
export const startRefreshCron = (): void => {
    stopRefreshCron();

    const { Schedule, Orgs } = config.Leaderboard;

    if (Orgs.length === 0) {
        logger.warn("LEADERBOARD_ORGS is empty, scheduled refresh is disabled");
        return;
    }

    task = schedule(
        Schedule,
        () => runScheduled(Orgs),
        { noOverlap: true, unref: true },
    );

    logger.info(`scheduled refresh "${Schedule}"`, { schedule: Schedule, orgs: Orgs });
};

/** Stops the scheduler; safe to call when nothing is running. */
export const stopRefreshCron = (): void => {
    task?.stop();
    task = undefined;
};
