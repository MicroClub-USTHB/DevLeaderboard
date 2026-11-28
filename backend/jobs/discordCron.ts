import { schedule } from "node-cron";
import type { ScheduledTask } from "node-cron";
import { config } from "../config/config.js";
import { logger } from "../lib/logger.js";
import { sendDailyReport } from "../services/discord/dailyReport.js";

let task: ScheduledTask | undefined;

/**
 * Sends the report for every configured org. One failure never stops the
 * others; the result says how many orgs failed.
 */
export const sendDiscordReports = async (): Promise<number> => {
    const discord = config.Discord;
    if (discord === undefined) return 0;

    let failures = 0;
    for (const org of config.Leaderboard.Orgs) {
        try {
            await sendDailyReport(discord, org);
            logger.info("posted the daily leaderboard to Discord", { org });
        } catch (error) {
            failures += 1;
            logger.error("could not post the daily leaderboard to Discord", { org, err: error });
        }
    }
    return failures;
};

/** Starts the daily Discord report. Off while DISCORD_WEBHOOK_URL is empty. */
export const startDiscordCron = (): void => {
    stopDiscordCron();

    const discord = config.Discord;
    if (discord === undefined) return;

    if (config.Leaderboard.Orgs.length === 0) {
        logger.warn("LEADERBOARD_ORGS is empty, the Discord report has nothing to post");
        return;
    }

    task = schedule(discord.Schedule, async () => {
        await sendDiscordReports();
    }, {
        // Day and month boundaries are UTC everywhere else, so the schedule is too.
        timezone: "UTC",
        noOverlap: true,
        unref: true,
    });
    logger.info(`scheduled the Discord report "${discord.Schedule}" (UTC)`, { schedule: discord.Schedule });
};

/** Stops the Discord report; safe to call when nothing is running. */
export const stopDiscordCron = (): void => {
    task?.stop();
    task = undefined;
};
