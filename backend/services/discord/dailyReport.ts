import type { DiscordConfig } from "../../config/schema.js";
import { findSnapshot } from "../../models/leaderboardSnapshot.js";
import { dayIn, dayRangeIn, formatDay, shiftDay, type CalendarDay } from "../../lib/zonedTime.js";
import { syncLeaderboard } from "../leaderboard/sync.js";
import type { SnapshotContributor } from "../leaderboard/types.js";
import { buildBoardMessage, type ReportBoard } from "./format.js";
import { SPACER_NAME, SPACER_PNG } from "./spacer.js";
import { postToDiscord, type WebhookFile } from "./webhook.js";

const SPACER: WebhookFile = { name: SPACER_NAME, contentType: "image/png", data: SPACER_PNG };

const DAY_COLOR = 0xf5b700;
const MONTH_COLOR = 0x5865f2;

// Calendar days are built at UTC midnight below, so they are formatted in UTC.
const dayTitle = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
});
const monthTitle = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

const asUtcDate = (day: CalendarDay): Date => new Date(Date.UTC(day.year, day.month - 1, day.day));

const boardUrl = (siteUrl: string, orgLogin: string, query: Record<string, string>): string =>
    siteUrl ? `${siteUrl}/leaderboard/${orgLogin}?${new URLSearchParams(query).toString()}` : "";

/** Reads a snapshot that `syncLeaderboard` just made sure exists. */
const contributorsOf = async (
    orgLogin: string,
    period: "month" | "custom",
    rangeKey: string,
): Promise<SnapshotContributor[]> => (await findSnapshot(orgLogin, period, rangeKey))?.contributors ?? [];

export interface ReportOptions {
    now?: Date;
    /**
     * false sends what is already stored, without calling GitHub (a resend or a
     * preview). A board with no stored snapshot then shows as empty.
     */
    refresh?: boolean;
}

/**
 * Reports the last full day in the configured timezone: at 00:00 in Algiers it
 * is the day that just ended there. The day is always collected fresh; the
 * month board is the site's monthly snapshot (reused when recent). Both are
 * posted to the Discord channel.
 */
export const sendDailyReport = async (
    discord: DiscordConfig,
    orgLogin: string,
    { now = new Date(), refresh = true }: ReportOptions = {},
): Promise<void> => {
    const day = shiftDay(dayIn(now, discord.TimeZone), -1);
    const dayRange = dayRangeIn(day, discord.TimeZone);
    const dayKey = formatDay(day);
    // Not the site's `YYYY-MM-DD_YYYY-MM-DD`: this day is not a UTC day.
    const rangeKey = `tz:${discord.TimeZone}:${dayKey}`;

    if (refresh) {
        await syncLeaderboard(orgLogin, "custom", { customRange: dayRange, rangeKey, force: true, now });
        await syncLeaderboard(orgLogin, "month", { now });
    }

    const [dayContributors, monthContributors] = await Promise.all([
        contributorsOf(orgLogin, "custom", rangeKey),
        contributorsOf(orgLogin, "month", ""),
    ]);

    const boards: ReportBoard[] = [
        {
            title: `Daily top ${discord.TodayLimit} · ${dayTitle.format(asUtcDate(day))}`,
            // The site counts days in UTC, so this opens the nearest match.
            url: boardUrl(discord.SiteUrl, orgLogin, { period: "custom", from: dayKey, to: dayKey }),
            color: DAY_COLOR,
            contributors: dayContributors,
            limit: discord.TodayLimit,
            emptyText: "No activity on this day.",
            activeLabel: "active",
        },
        {
            title: `This month's top ${discord.MonthLimit} · ${monthTitle.format(asUtcDate(day))}`,
            url: boardUrl(discord.SiteUrl, orgLogin, { period: "month" }),
            color: MONTH_COLOR,
            contributors: monthContributors,
            limit: discord.MonthLimit,
            emptyText: "No activity this month yet.",
            activeLabel: "active this month",
        },
    ];

    const sender = { username: discord.Username, avatarUrl: discord.AvatarUrl };
    // One message per board (Discord caps a message at 10 cards); the last one carries the footer.
    for (const [index, board] of boards.entries()) {
        const footer = index === boards.length - 1 ? { text: `${orgLogin} · daily leaderboard`, at: now } : undefined;
        const message = buildBoardMessage(board, sender, footer);
        await postToDiscord(discord.WebhookUrl, message, message.attachments ? [SPACER] : []);
    }
};
