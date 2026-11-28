import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Inbox, RefreshCw, Search } from "lucide-react";
import { ApiError } from "@/shared/api/client";
import { hasSnapshot, PERIODS, SCOPES, type Period, type Scope } from "@/shared/api/types";
import { defaultCustomRange, validateRange, type DateRange } from "@/shared/lib/dates";
import { formatDate, formatRelativeTime } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { EmptyState, ErrorState, Skeleton } from "@/shared/ui/States";
import { DEFAULT_PERIOD, DEFAULT_SCOPE, MAX_CUSTOM_DAYS, PAGE_SIZE } from "../constants";
import { useLeaderboard } from "../api";
import { LinkGithubPanel } from "@/features/link/components/LinkGithubPanel";
import { LeaderboardHero } from "../components/LeaderboardHero";
import { Pagination } from "../components/Pagination";
import { ScopeSelector } from "../components/ScopeSelector";
import { ScoreCards } from "../components/ScoreCards";
import { ScoreTable } from "../components/ScoreTable";
import { StaleDataBanner } from "../components/StaleDataBanner";
import { TimelineSelector, type TimelineSelection } from "../components/TimelineSelector";

const isPeriod = (value: string | null): value is Period =>
    value !== null && (PERIODS as readonly string[]).includes(value);

const isScope = (value: string | null): value is Scope =>
    value !== null && (SCOPES as readonly string[]).includes(value);

const MAX_PAGE = 5_000;
/** GitHub login limit, mirrored by the server's `q` validation. */
const MAX_QUERY_LENGTH = 39;

const parsePage = (value: string | null): number => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) return 1;
    return Math.min(parsed, MAX_PAGE);
};

export const LeaderboardPage = (): ReactNode => {
    const { org = "" } = useParams<{ org: string }>();
    const [searchParams, setSearchParams] = useSearchParams();

    const period = isPeriod(searchParams.get("period"))
        ? (searchParams.get("period") as Period)
        : DEFAULT_PERIOD;
    const rawScope = searchParams.get("scope");
    const scope: Scope = isScope(rawScope) ? rawScope : DEFAULT_SCOPE;
    const rawFrom = searchParams.get("from");
    const rawTo = searchParams.get("to");
    const page = parsePage(searchParams.get("page"));
    const offset = (page - 1) * PAGE_SIZE;
    const rawQuery = searchParams.get("q") ?? "";
    const [queryInput, setQueryInput] = useState(rawQuery);

    // The URL stays the source of truth so a search is shareable. Typing is
    // debounced before it becomes a URL change (and a new API request).
    useEffect(() => {
        setQueryInput(rawQuery);
    }, [rawQuery]);

    useEffect(() => {
        const next = queryInput.trim();
        if (next === rawQuery) return;

        const timer = window.setTimeout(() => {
            const params = new URLSearchParams(searchParams);
            if (next.length === 0) params.delete("q");
            else params.set("q", next);
            params.delete("page");
            setSearchParams(params, { replace: true });
        }, 250);

        return () => window.clearTimeout(timer);
    }, [queryInput, rawQuery, searchParams, setSearchParams]);

    // A valid range from the URL, or the default 30-day window for a bad one.
    const customRange = useMemo<DateRange | null>(() => {
        if (period !== "custom") return null;

        if (rawFrom !== null && rawTo !== null) {
            const validation = validateRange(rawFrom, rawTo, MAX_CUSTOM_DAYS);
            if (validation.range !== null) return validation.range;
        }

        return defaultCustomRange();
    }, [period, rawFrom, rawTo]);

    const rangeFrom = customRange?.from ?? null;
    const rangeTo = customRange?.to ?? null;

    // Keep the URL canonical so a custom leaderboard is always shareable.
    useEffect(() => {
        if (rangeFrom === null || rangeTo === null) return;
        if (rawFrom === rangeFrom && rawTo === rangeTo) return;

        const params = new URLSearchParams(searchParams);
        params.set("period", "custom");
        params.set("from", rangeFrom);
        params.set("to", rangeTo);
        setSearchParams(params, { replace: true });
    }, [rangeFrom, rangeTo, rawFrom, rawTo, searchParams, setSearchParams]);

    const leaderboard = useLeaderboard({
        org,
        period,
        scope,
        limit: PAGE_SIZE,
        offset,
        q: rawQuery.length > 0 ? rawQuery : undefined,
        from: rangeFrom ?? undefined,
        to: rangeTo ?? undefined,
    });

    const changeTimeline = (selection: TimelineSelection): void => {
        const params = new URLSearchParams(searchParams);
        params.set("period", selection.period);
        params.delete("page");

        if (selection.period === "custom") {
            const range =
                selection.from !== undefined && selection.to !== undefined
                    ? { from: selection.from, to: selection.to }
                    : (customRange ?? defaultCustomRange());
            params.set("from", range.from);
            params.set("to", range.to);
        } else {
            params.delete("from");
            params.delete("to");
        }

        setSearchParams(params, { replace: true });
    };

    const changeScope = (next: Scope): void => {
        const params = new URLSearchParams(searchParams);
        if (next === DEFAULT_SCOPE) params.delete("scope");
        else params.set("scope", next);
        params.delete("page");

        setSearchParams(params, { replace: true });
    };

    const goToPage = (next: number): void => {
        const params = new URLSearchParams(searchParams);
        if (next <= 1) params.delete("page");
        else params.set("page", String(next));

        setSearchParams(params);
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const retry = (): void => void leaderboard.refetch();
    const selectorRange = customRange ?? defaultCustomRange();

    const snapshot =
        leaderboard.data !== undefined && hasSnapshot(leaderboard.data) ? leaderboard.data : null;
    const totalPages = snapshot === null ? 1 : Math.max(1, Math.ceil(snapshot.total / PAGE_SIZE));
    const firstShown = snapshot === null || snapshot.entries.length === 0 ? 0 : offset + 1;
    const lastShown = snapshot === null ? 0 : offset + snapshot.entries.length;

    // Keep a hand-edited page number inside the real range. This also covers a
    // refresh that shrinks the board below the current page.
    useEffect(() => {
        if (snapshot === null || page <= totalPages) return;

        const params = new URLSearchParams(searchParams);
        if (totalPages <= 1) params.delete("page");
        else params.set("page", String(totalPages));

        setSearchParams(params, { replace: true });
    }, [snapshot, page, totalPages, searchParams, setSearchParams]);

    return (
        <div className="space-y-6">
            <LeaderboardHero org={org} scope={scope} snapshot={snapshot} offset={offset} />

            {/* Toolbar: who the board counts, and the time window */}
            <div
                id="board"
                className="flex flex-col gap-4 pt-2 sm:flex-row sm:items-end sm:justify-between"
            >
                <h2 className="font-display text-[1.75rem] font-bold leading-[1.15] tracking-[-0.05em]">
                    Rankings
                </h2>
                <div className="flex flex-wrap items-end gap-2">
                    <label className="relative w-full sm:w-56">
                        <span className="sr-only">Search by GitHub username</span>
                        <Search
                            size={15}
                            aria-hidden
                            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
                        />
                        <input
                            type="search"
                            value={queryInput}
                            onChange={(event) => setQueryInput(event.target.value)}
                            placeholder="Find a username"
                            autoComplete="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            maxLength={MAX_QUERY_LENGTH}
                            className="h-10 w-full rounded-lg border border-line bg-canvas pr-3 pl-9 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-500"
                        />
                    </label>
                    <ScopeSelector value={scope} onChange={changeScope} />
                    <TimelineSelector
                        value={period}
                        from={selectorRange.from}
                        to={selectorRange.to}
                        onChange={changeTimeline}
                    />
                </div>
            </div>

            {/* Dev department: sign in with MCID and link a GitHub account. */}
            {scope === "dev" && <LinkGithubPanel />}

            {/* States */}
            {leaderboard.isPending ? (
                <TableSkeleton />
            ) : leaderboard.isError && leaderboard.data === undefined ? (
                <ErrorState
                    title={
                        leaderboard.error instanceof ApiError && leaderboard.error.status === 404
                            ? "Organization not found"
                            : "Couldn't load the leaderboard"
                    }
                    description={
                        leaderboard.error instanceof ApiError
                            ? leaderboard.error.message
                            : "Something went wrong while loading this leaderboard."
                    }
                    action={
                        <Button variant="secondary" onClick={retry}>
                            <RefreshCw size={15} aria-hidden />
                            Try again
                        </Button>
                    }
                />
            ) : snapshot !== null ? (
                <>
                    {/* Refresh failed but a snapshot is cached: keep serving it. */}
                    {leaderboard.isError && (
                        <StaleDataBanner
                            retryAfterSeconds={
                                leaderboard.error instanceof ApiError
                                    ? leaderboard.error.retryAfterSeconds
                                    : null
                            }
                            onRetry={retry}
                            busy={leaderboard.isFetching}
                        />
                    )}

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-ink-faint">
                            Updated {formatRelativeTime(snapshot.generatedAt)} ·{" "}
                            {formatDate(snapshot.windowFrom)} – {formatDate(snapshot.windowTo)} ·
                            showing{" "}
                            <span className="text-ink-muted tabular">
                                {firstShown === 0 ? 0 : `${firstShown}–${lastShown}`}
                            </span>{" "}
                            of <span className="text-ink-muted tabular">{snapshot.total}</span>{" "}
                            {scope === "dev" ? "Dev members" : "contributors"}
                            {rawQuery.length > 0 && (
                                <>
                                    {" "}
                                    matching <span className="text-ink-muted">@{rawQuery}</span>
                                </>
                            )}
                        </p>

                        {rawQuery.length === 0 && (
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">
                                <span className="inline-flex items-center gap-1.5">
                                    <span className="size-2 rounded-full bg-success" aria-hidden />
                                    Top 4
                                </span>
                                {snapshot.total > 7 && (
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="size-2 rounded-full bg-danger" aria-hidden />
                                        Bottom 3
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    {snapshot.entries.length === 0 ? (
                        <EmptyState
                            icon={<Inbox size={20} />}
                            title={
                                rawQuery.length > 0
                                    ? `No match for @${rawQuery}`
                                    : "No activity in this period"
                            }
                            description={
                                rawQuery.length > 0
                                    ? "Try another username, or clear the search to see the full board."
                                    : scope === "dev"
                                      ? "No Dev member contributed during this window, or they have not linked their GitHub account yet. Try a different range."
                                      : "Nobody contributed during the selected window. Try a different range."
                            }
                        />
                    ) : (
                        <>
                            <ScoreTable entries={snapshot.entries} total={snapshot.total} />
                            <ScoreCards entries={snapshot.entries} total={snapshot.total} />
                            <Pagination
                                page={page}
                                totalPages={totalPages}
                                onChange={goToPage}
                            />
                        </>
                    )}
                </>
            ) : leaderboard.data !== undefined ? (
                <EmptyState
                    icon={
                        <RefreshCw
                            size={20}
                            className="animate-spin"
                        />
                    }
                    title="Preparing this leaderboard"
                    description="Collecting data from GitHub. This page updates on its own when it is ready. All-time and multi-month ranges can take several minutes."
                />
            ) : (
                // Should be unreachable: isPending | isError | data are exhaustive.
                <ErrorState title="Something went wrong" description="Please try again." />
            )}

        </div>
    );
};

/** Skeleton matching the table's geometry so nothing jumps on load. */
const TableSkeleton = (): ReactNode => (
    <div className="space-y-3" aria-busy aria-label="Loading leaderboard">
        <Skeleton className="h-4 w-56" />
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
            {Array.from({ length: 8 }, (_, index) => (
                <div
                    key={index}
                    className="flex items-center gap-4 border-b border-line/60 px-4 py-3.5 last:border-0"
                >
                    <Skeleton className="size-7 rounded-full" />
                    <Skeleton className="size-8 rounded-full" />
                    <Skeleton
                        className="h-4 flex-1"
                        style={{ maxWidth: `${40 + ((index * 7) % 30)}%` }}
                    />
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-4 w-14" />
                </div>
            ))}
        </div>
    </div>
);
