import type { SnapshotContributor } from "../leaderboard/types.js";

/** One ranked board in the report (today, this month). */
export interface ReportBoard {
    title: string;
    /** Link to the same board on the site; empty leaves the title unlinked. */
    url: string;
    color: number;
    contributors: readonly SnapshotContributor[];
    limit: number;
    emptyText: string;
}

/** The JSON body Discord's "execute webhook" endpoint expects. */
export interface WebhookPayload {
    username: string;
    allowed_mentions: { parse: string[] };
    embeds: Array<{
        title: string;
        url?: string;
        color: number;
        description: string;
        footer?: { text: string };
        timestamp?: string;
    }>;
}

const MEDALS = ["🥇", "🥈", "🥉"] as const;

/** One icon per metric; the footer carries the legend. */
export const ICONS = { commits: "📝", pullRequests: "🔀", reviews: "👀", issues: "🐛" } as const;

/** Only the non-zero counts, so a line stays short: "📝 5 · 🔀 1". */
const breakdown = (entry: SnapshotContributor): string =>
    (Object.keys(ICONS) as Array<keyof typeof ICONS>)
        .filter((metric) => entry[metric] > 0)
        .map((metric) => `${ICONS[metric]} ${entry[metric]}`)
        .join(" · ");

const KEYCAPS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"] as const;

const rankMark = (rank: number): string => MEDALS[rank - 1] ?? KEYCAPS[rank - 1] ?? `**${rank}.**`;

/**
 * Two lines per contributor: rank, name and score, then the counts. GitHub
 * logins are letters, digits and hyphens, so they cannot break the Markdown or
 * mention anyone.
 */
export const formatLine = (entry: SnapshotContributor): string => {
    const name = `[${entry.login}](https://github.com/${entry.login})`;
    const details = breakdown(entry);
    const head = `${rankMark(entry.rank)} **${name}** · **${entry.score}** pts`;
    return details ? `${head}\n\u2003\u2003${details}` : head;
};

const formatBoard = (board: ReportBoard): string => {
    const top = board.contributors.slice(0, board.limit);
    return top.length === 0 ? board.emptyText : top.map(formatLine).join("\n");
};

/** Builds the whole message. Pure: the same boards always give the same payload. */
export const buildReport = (
    boards: readonly ReportBoard[],
    generatedAt: Date,
    footer: string,
): WebhookPayload => ({
    username: "Micro Club Leaderboard",
    // Never ping anyone, whatever ends up in the text.
    allowed_mentions: { parse: [] },
    embeds: boards.map((board, index) => ({
        title: board.title,
        ...(board.url ? { url: board.url } : {}),
        color: board.color,
        description: formatBoard(board),
        // Only the last embed carries the footer, so the message reads as one card.
        ...(index === boards.length - 1
            ? { footer: { text: footer }, timestamp: generatedAt.toISOString() }
            : {}),
    })),
});
