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
    content?: string;
    embeds: Array<{
        title?: string;
        url?: string;
        color: number;
        author?: { name: string; url?: string; icon_url?: string };
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

const LEGEND = `${ICONS.commits} commits · ${ICONS.pullRequests} PRs · ${ICONS.reviews} reviews · ${ICONS.issues} issues`;

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
            ? { footer: { text: `${footer}\n${LEGEND}` }, timestamp: generatedAt.toISOString() }
            : {}),
    })),
});

/** Gold, silver and bronze for the podium; everyone else takes the board's color. */
const PODIUM_COLORS = [0xf1c40f, 0xbdc3c7, 0xcd7f32] as const;

/** Discord shows at most this many embeds in one message. */
export const MAX_EMBEDS = 10;

const countWord = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Only the non-zero counts, in words: "56 commits · 10 PRs". */
const countsOf = (entry: Pick<SnapshotContributor, keyof typeof ICONS>): string =>
    [
        entry.commits > 0 ? countWord(entry.commits, "commit") : null,
        entry.pullRequests > 0 ? countWord(entry.pullRequests, "PR") : null,
        entry.reviews > 0 ? countWord(entry.reviews, "review") : null,
        entry.issues > 0 ? countWord(entry.issues, "issue") : null,
    ]
        .filter((part): part is string => part !== null)
        .join(" · ");

/** "5 active today · 80 commits · 13 PRs", over everyone on the board. */
const plainSummary = (board: ReportBoard): string => {
    const all = board.contributors;
    const totals = countsOf({
        commits: sum(all, "commits"),
        pullRequests: sum(all, "pullRequests"),
        reviews: sum(all, "reviews"),
        issues: sum(all, "issues"),
    });
    return [`${all.length} ${board.activeLabel}`, totals].filter((part) => part.length > 0).join(" · ");
};

/**
 * One card per member: the GitHub avatar and name (linked to the profile) as
 * the card's author line, and the score with the counts underneath.
 */
const memberCard = (entry: SnapshotContributor, color: number): WebhookPayload["embeds"][number] => {
    const counts = countsOf(entry);
    return {
        color: PODIUM_COLORS[entry.rank - 1] ?? color,
        author: {
            name: `#${entry.rank}  ${entry.login}`,
            url: `https://github.com/${entry.login}`,
            icon_url: entry.avatarUrl || `https://github.com/${entry.login}.png?size=96`,
        },
        description: `**${entry.score} pts**${counts ? `  ·  ${counts}` : ""}`,
    };
};

/**
 * One message per board: the title and summary as the message text, then a
 * card per member. Pure: the same board always gives the same payload.
 */
export const buildBoardMessage = (
    board: ReportBoard,
    footer?: { text: string; at: Date },
): WebhookPayload => {
    const top = board.contributors.slice(0, Math.min(board.limit, MAX_EMBEDS));
    const title = board.url ? `## [${board.title}](<${board.url}>)` : `## ${board.title}`;
    const embeds = top.map((entry) => memberCard(entry, board.color));

    const last = embeds.at(-1);
    if (footer !== undefined && last !== undefined) {
        last.footer = { text: footer.text };
        last.timestamp = footer.at.toISOString();
    }

    return {
        username: "Micro Club Leaderboard",
        // Never ping anyone, whatever ends up in the text.
        allowed_mentions: { parse: [] },
        content: `${title}\n${top.length === 0 ? board.emptyText : plainSummary(board)}`,
        embeds,
    };
};
