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
    /** Ends the summary line, e.g. "active today" in "5 active today · 80 commits". */
    activeLabel: string;
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
        thumbnail?: { url: string };
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

const sum = (entries: readonly SnapshotContributor[], metric: keyof typeof ICONS): number =>
    entries.reduce((total, entry) => total + entry[metric], 0);

/** Totals over everyone on the board, not only the top: "**5** active today · 📝 **80** · 🔀 **13**". */
export const formatSummary = (board: ReportBoard): string => {
    const all = board.contributors;
    const totals = (Object.keys(ICONS) as Array<keyof typeof ICONS>)
        .map((metric) => ({ metric, total: sum(all, metric) }))
        .filter(({ total }) => total > 0)
        .map(({ metric, total }) => `${ICONS[metric]} **${total}**`);
    return [`**${all.length}** ${board.activeLabel}`, ...totals].join(" · ");
};

const formatBoard = (board: ReportBoard): string => {
    const top = board.contributors.slice(0, board.limit);
    if (top.length === 0) return board.emptyText;
    return `${formatSummary(board)}\n\n${top.map(formatLine).join("\n")}`;
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
        // The leader's avatar, as a small picture in the card's corner.
        ...(board.contributors[0]?.avatarUrl ? { thumbnail: { url: board.contributors[0].avatarUrl } } : {}),
        // Only the last embed carries the footer, so the message reads as one card.
        ...(index === boards.length - 1
            ? { footer: { text: footer }, timestamp: generatedAt.toISOString() }
            : {}),
    })),
});
