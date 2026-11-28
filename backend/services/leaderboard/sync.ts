import { config } from "../../config/config.js";
import {
    findSnapshot,
    upsertSnapshot,
    type LeaderboardSnapshotAttrs,
    type SnapshotInput,
} from "../../models/leaderboardSnapshot.js";
import { aggregate } from "./aggregator.js";
import { collectContributions, type CollectorClient } from "./collector.js";
import { rangeKeyFor, type CustomRange, type Period } from "./periods.js";
import type { CollectResult, SyncResult } from "./types.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * How long a cached snapshot is served before a non-forced refresh recomputes
 * it. The monthly view is cheap and changes often; all-time and custom ranges
 * cost many GitHub calls, so they are cached for a day.
 */
const FRESHNESS_MS: Readonly<Record<Period, number>> = {
    month: 15 * MINUTE_MS,
    all: 24 * HOUR_MS,
    custom: 24 * HOUR_MS,
};

type CollectFn = (
    orgLogin: string,
    period: Period,
    now: Date,
    customRange?: CustomRange,
    client?: CollectorClient,
    extraRepos?: readonly string[],
) => Promise<CollectResult>;

/**
 * `LEADERBOARD_EXTRA_REPOS` is written as `org=owner/repo`. Only entries that
 * belong to the requested organization are passed to the collector.
 */
const extraReposFor = (orgLogin: string): string[] => {
    const target = orgLogin.toLowerCase();
    const repos: string[] = [];

    for (const entry of config.Leaderboard.ExtraRepos) {
        const separator = entry.indexOf("=");
        if (separator <= 0) continue;

        const org = entry.slice(0, separator).trim().toLowerCase();
        const repo = entry.slice(separator + 1).trim();
        if (org === target && repo.length > 0) repos.push(repo);
    }

    return repos;
};

type FindFn = (
    orgLogin: string,
    period: Period,
    rangeKey: string,
) => Promise<LeaderboardSnapshotAttrs | null>;

interface SyncOptions {
    /** Injection points for tests; production uses the real collector and store. */
    collect?: CollectFn;
    save?: (snapshot: SnapshotInput) => Promise<void>;
    find?: FindFn;
    now?: Date;
    /** Bypass the freshness window (the UI's explicit Refresh button). */
    force?: boolean;
    customRange?: CustomRange;
    /**
     * Stores a custom range under this key instead of its UTC dates. For ranges
     * that do not start and end on UTC days (a day in another timezone), so they
     * never collide with a range the site asks for.
     */
    rangeKey?: string;
}

// One refresh per org+period+range at a time; concurrent callers await the same run.
const inFlight = new Map<string, Promise<SyncResult>>();

const toResult = (snapshot: LeaderboardSnapshotAttrs, skipped: boolean): SyncResult => ({
    orgLogin: snapshot.orgLogin,
    period: snapshot.period,
    rangeKey: snapshot.rangeKey,
    generatedAt: snapshot.generatedAt,
    windowFrom: snapshot.windowFrom,
    windowTo: snapshot.windowTo,
    entryCount: snapshot.contributors.length,
    warnings: snapshot.warnings,
    skipped,
});

const runSync = async (
    orgLogin: string,
    period: Period,
    options: SyncOptions,
): Promise<SyncResult> => {
    const now = options.now ?? new Date();
    const rangeKey = options.rangeKey ?? rangeKeyFor(period, options.customRange);
    const find = options.find ?? findSnapshot;

    // Serve a fresh cached snapshot without spending GitHub quota. The
    // explicit Refresh button sets `force`, so a user can always demand new data.
    if (!options.force) {
        const existing = await find(orgLogin, period, rangeKey);
        if (
            existing !== null &&
            now.getTime() - existing.generatedAt.getTime() < FRESHNESS_MS[period]
        ) {
            return toResult(existing, true);
        }
    }

    const collect = options.collect ?? collectContributions;
    const save = options.save ?? upsertSnapshot;

    const { contributors, warnings, window, orgCreatedAt } = await collect(
        orgLogin,
        period,
        now,
        options.customRange,
        undefined,
        extraReposFor(orgLogin),
    );
    const entries = aggregate(contributors, config.Score);

    const snapshot: SnapshotInput = {
        orgLogin: orgLogin.toLowerCase(),
        period,
        rangeKey,
        orgCreatedAt,
        windowFrom: window.from,
        windowTo: window.to,
        generatedAt: now,
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
        warnings,
    };

    await save(snapshot);

    return toResult(snapshot, false);
};

export const syncLeaderboard = async (
    orgLogin: string,
    period: Period,
    options: SyncOptions = {},
): Promise<SyncResult> => {
    const key = `${orgLogin.toLowerCase()}:${period}:${options.rangeKey ?? rangeKeyFor(period, options.customRange)}`;

    const existing = inFlight.get(key);
    if (existing !== undefined) return existing;

    const task = runSync(orgLogin, period, options).finally(() => {
        inFlight.delete(key);
    });

    inFlight.set(key, task);
    return task;
};
