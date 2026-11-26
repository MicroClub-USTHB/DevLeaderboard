import { config } from "../../config/config.js";
import { logger } from "../../lib/logger.js";
import { findSnapshot, upsertSnapshot } from "../../models/leaderboardSnapshot.js";
import { aggregate, isBotLogin } from "./aggregator.js";
import { collectMember } from "./collector.js";
import type { Period } from "./periods.js";
import type { RawContributor } from "./types.js";

/** Only the fixed periods are kept up to date this way; custom ranges are built on demand. */
const PERIODS: readonly Period[] = ["month", "all"];

const APPROXIMATE_NOTE =
    "Members who linked their GitHub after the last full refresh are counted from their contribution graph only and may be a little lower until the next refresh.";

const inFlight = new Map<string, Promise<void>>();

const addToOrg = async (orgLogin: string, login: string): Promise<void> => {
    for (const period of PERIODS) {
        const snapshot = await findSnapshot(orgLogin, period, "");
        // Nothing stored yet: the first full build will include this person anyway.
        if (snapshot === null) continue;
        if (snapshot.contributors.some((entry) => entry.login.toLowerCase() === login)) continue;

        const member = await collectMember(orgLogin, login, {
            from: snapshot.windowFrom,
            to: snapshot.windowTo,
        });
        if (member === null) continue;

        const existing: RawContributor[] = snapshot.contributors.map((entry) => ({
            key: entry.key,
            login: entry.login,
            avatarUrl: entry.avatarUrl,
            commits: entry.commits,
            pullRequests: entry.pullRequests,
            reviews: entry.reviews,
            issues: entry.issues,
        }));
        const entries = aggregate([...existing, member], config.Score);

        // aggregate() drops people with no activity; then there is nothing to add.
        if (entries.length === snapshot.contributors.length) continue;

        await upsertSnapshot({
            orgLogin: snapshot.orgLogin,
            period: snapshot.period,
            rangeKey: snapshot.rangeKey,
            orgCreatedAt: snapshot.orgCreatedAt,
            windowFrom: snapshot.windowFrom,
            windowTo: snapshot.windowTo,
            // Unchanged on purpose: it still describes when the full scan ran.
            generatedAt: snapshot.generatedAt,
            contributors: entries.map((entry) => ({
                key: entry.key,
                login: entry.login,
                avatarUrl: entry.avatarUrl,
                commits: entry.commits,
                pullRequests: entry.pullRequests,
                reviews: entry.reviews,
                issues: entry.issues,
                score: entry.score,
                rank: entry.rank,
            })),
            warnings: snapshot.warnings.includes(APPROXIMATE_NOTE)
                ? snapshot.warnings
                : [...snapshot.warnings, APPROXIMATE_NOTE],
        });
        logger.info("added a linked member to the stored snapshot", { org: orgLogin, period, login });
    }
};

/**
 * A member just linked their GitHub username. If the stored snapshots do not include them
 * yet, fetch only their own activity and merge it in. Never starts a full collection, and
 * never throws (a failure only means they appear after the next scheduled refresh).
 */
export const addMemberToSnapshots = (username: string): Promise<void> => {
    const login = username.trim().toLowerCase();
    if (login.length === 0 || isBotLogin(login)) return Promise.resolve();

    const running = inFlight.get(login);
    if (running !== undefined) return running;

    const task = (async () => {
        for (const orgLogin of config.Leaderboard.Orgs) {
            try {
                await addToOrg(orgLogin, login);
            } catch (error) {
                logger.error("could not add a linked member to the snapshot", { org: orgLogin, login, err: error });
            }
        }
    })().finally(() => {
        inFlight.delete(login);
    });

    inFlight.set(login, task);
    return task;
};
