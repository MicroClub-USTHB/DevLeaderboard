import type { SnapshotContributor } from "./types.js";

/** GitHub serves any account's avatar at `/<login>.png`, so inactive members need no lookup. */
const avatarFor = (login: string): string => `https://github.com/${login}.png?size=96`;

/**
 * The Dev department board: every roster member, active or not.
 *
 * A snapshot only holds people who did something in its window (the aggregator drops
 * zero-activity accounts so the global board stays readable). For the Dev department the
 * whole point is to see who did nothing, so roster members missing from the snapshot are
 * added with zero everything and ranked after everyone who contributed, in login order
 * (the same tie-break the aggregator uses). Ranks run 1..n over the full list.
 *
 * Pure: the same snapshot and roster always give the same board.
 */
export const buildDevBoard = (
    contributors: readonly SnapshotContributor[],
    rosterLogins: ReadonlySet<string>,
): SnapshotContributor[] => {
    const active = contributors.filter((contributor) =>
        rosterLogins.has(contributor.login.toLowerCase()),
    );
    const seen = new Set(active.map((contributor) => contributor.login.toLowerCase()));

    const inactive: SnapshotContributor[] = [...rosterLogins]
        .filter((login) => !seen.has(login))
        .sort()
        .map((login) => ({
            // Not a GitHub node ID (we never looked this account up); only needs to be unique.
            key: `roster:${login}`,
            login,
            avatarUrl: avatarFor(login),
            commits: 0,
            pullRequests: 0,
            reviews: 0,
            issues: 0,
            score: 0,
            rank: 0,
        }));

    return [...active, ...inactive].map((contributor, index) => ({
        ...contributor,
        rank: index + 1,
    }));
};
