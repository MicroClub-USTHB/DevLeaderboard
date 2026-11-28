import type { DiscordConfig } from "../../config/schema.js";
import { findSnapshot } from "../../models/leaderboardSnapshot.js";
import { endOfDayUtc, formatDateKey, rangeKeyFor, startOfMonthUtc, type CustomRange } from "../leaderboard/periods.js";
import { syncLeaderboard } from "../leaderboard/sync.js";
import type { SnapshotContributor } from "../leaderboard/types.js";
import { buildBoardMessage, type ReportBoard } from "./format.js";
import { postToDiscord } from "./webhook.js";

const TODAY_COLOR = 0xf5b700;
const MONTH_COLOR = 0x5865f2;

const dayTitle = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
});
const monthTitle = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

const todayRange = (now: Date): CustomRange => {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return { from, to: endOfDayUtc(from) };
};

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
 * Collects today's activity (always fresh) and this month's (cached snapshot if
 * it is recent), then posts both boards to the Discord channel.
 */
export const sendDailyReport = async (
    discord: DiscordConfig,
    orgLogin: string,
    { now = new Date(), refresh = true }: ReportOptions = {},
): Promise<void> => {
    const today = todayRange(now);
    const todayKey = formatDateKey(today.from);

    if (refresh) {
        await syncLeaderboard(orgLogin, "custom", { customRange: today, force: true, now });
        await syncLeaderboard(orgLogin, "month", { now });
    }

    const [todayContributors, monthContributors] = await Promise.all([
        contributorsOf(orgLogin, "custom", rangeKeyFor("custom", today)),
        contributorsOf(orgLogin, "month", ""),
    ]);

    const boards: ReportBoard[] = [
        {
            title: `Today's top ${discord.TodayLimit} · ${dayTitle.format(today.from)}`,
            url: boardUrl(discord.SiteUrl, orgLogin, { period: "custom", from: todayKey, to: todayKey }),
            color: TODAY_COLOR,
            contributors: todayContributors,
            limit: discord.TodayLimit,
            emptyText: "No activity today. Tomorrow is a new chance to ship.",
            activeLabel: "active today",
        },
        {
            title: `This month's top ${discord.MonthLimit} · ${monthTitle.format(startOfMonthUtc(now))}`,
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
        await postToDiscord(discord.WebhookUrl, buildBoardMessage(board, sender, footer));
    }
};
