import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { ApiError } from "@/shared/api/client";
import { hasSnapshot, PERIODS, type Period } from "@/shared/api/types";
import { defaultCustomRange, validateRange, type DateRange } from "@/shared/lib/dates";
import { formatDate, formatRelativeTime } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { EmptyState, ErrorState, Skeleton } from "@/shared/ui/States";
import { DEFAULT_LIMIT, DEFAULT_PERIOD, MAX_CUSTOM_DAYS } from "../constants";
import { useLeaderboard, useLeaderboardMeta, useRefresh } from "../api";
import { MetaPanel } from "../components/MetaPanel";
import { RefreshButton } from "../components/RefreshButton";
import { ScoreCards } from "../components/ScoreCards";
import { ScoreTable } from "../components/ScoreTable";
import { StaleDataBanner } from "../components/StaleDataBanner";
import { TimelineSelector, type TimelineSelection } from "../components/TimelineSelector";

const isPeriod = (value: string | null): value is Period =>
    value !== null && (PERIODS as readonly string[]).includes(value);

const parseLimit = (value: string | null): number => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_LIMIT;
    return Math.min(parsed, 100);
};

export const LeaderboardPage = (): ReactNode => {
    const { org = "" } = useParams<{ org: string }>();
    const [searchParams, setSearchParams] = useSearchParams();

    const period = isPeriod(searchParams.get("period"))
        ? (searchParams.get("period") as Period)
        : DEFAULT_PERIOD;
    const rawFrom = searchParams.get("from");
    const rawTo = searchParams.get("to");
    const limit = parseLimit(searchParams.get("limit"));

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
        limit,
        from: rangeFrom ?? undefined,
        to: rangeTo ?? undefined,
    });
    const meta = useLeaderboardMeta(org);
    const refresh = useRefresh(org);

    // Identifies "this org + period + range", so an auto-refresh never fires
    // twice for the same timeline selection. A ref may only be touched inside
    // effects or event handlers, never read during render.
    const requestKey = `${period}:${rangeFrom ?? ""}:${rangeTo ?? ""}`;
    const autoRefreshRef = useRef<string | null>(null);

    const handleRefresh = (): void => {
        refresh.mutate({
            period,
            from: rangeFrom ?? undefined,
            to: rangeTo ?? undefined,
        });
    };

    // A 202 means no snapshot exists yet: start the first collection once.
    useEffect(() => {
        const data = leaderboard.data;
        if (data === undefined || hasSnapshot(data)) return;
        if (autoRefreshRef.current === requestKey) return;

        autoRefreshRef.current = requestKey;
        refresh.mutate({
            period,
            from: rangeFrom ?? undefined,
            to: rangeTo ?? undefined,
        });
    }, [leaderboard.data, requestKey, period, rangeFrom, rangeTo, refresh]);

    const changeTimeline = (selection: TimelineSelection): void => {
        const params = new URLSearchParams(searchParams);
        params.set("period", selection.period);

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

    const retry = (): void => void leaderboard.refetch();
    const selectorRange = customRange ?? defaultCustomRange();
    const refreshFailed = refresh.isError;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-accent-400">
                        Leaderboard
                    </p>
                    <h1 className="mt-1 text-3xl font-semibold tracking-tight">{org}</h1>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                    <TimelineSelector
                        value={period}
                        from={selectorRange.from}
                        to={selectorRange.to}
                        onChange={changeTimeline}
                    />
                    <RefreshButton
                        label="Refresh"
                        onRefresh={handleRefresh}
                        busy={refresh.isPending}
                    />
                </div>
            </div>

            {/* Warnings from the last collection run — non-blocking by design. */}
            {leaderboard.data !== undefined &&
                hasSnapshot(leaderboard.data) &&
                leaderboard.data.warnings.length > 0 && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink-muted">
                        <AlertTriangle
                            size={16}
                            className="mt-0.5 shrink-0 text-warning"
                            aria-hidden
                        />
                        <p>
                            {leaderboard.data.warnings.length} warning
                            {leaderboard.data.warnings.length > 1 ? "s" : ""} during the last
                            refresh: {leaderboard.data.warnings.join(" · ")}
                        </p>
                    </div>
                )}

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
            ) : leaderboard.data !== undefined && hasSnapshot(leaderboard.data) ? (
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

                    <p className="text-sm text-ink-faint">
                        Updated {formatRelativeTime(leaderboard.data.generatedAt)} ·{" "}
                        {formatDate(leaderboard.data.windowFrom)} –{" "}
                        {formatDate(leaderboard.data.windowTo)} · showing{" "}
                        <span className="text-ink-muted tabular">{leaderboard.data.count}</span> of{" "}
                        <span className="text-ink-muted tabular">{leaderboard.data.total}</span>{" "}
                        contributors
                    </p>

                    {leaderboard.data.entries.length === 0 ? (
                        <EmptyState
                            icon={<Inbox size={20} />}
                            title="No activity in this period"
                            description="Nobody contributed during the selected window. Try a different range."
                        />
                    ) : (
                        <>
                            <ScoreTable entries={leaderboard.data.entries} />
                            <ScoreCards entries={leaderboard.data.entries} />
                        </>
                    )}
                </>
            ) : leaderboard.data !== undefined && refreshFailed ? (
                <ErrorState
                    title="Couldn't build this leaderboard"
                    description={
                        refresh.error instanceof ApiError
                            ? refresh.error.message
                            : "GitHub could not be reached. Please try again."
                    }
                    action={
                        <Button variant="secondary" onClick={handleRefresh}>
                            <RefreshCw size={15} aria-hidden />
                            Try again
                        </Button>
                    }
                />
            ) : leaderboard.data !== undefined ? (
                <EmptyState
                    icon={
                        <RefreshCw
                            size={20}
                            className={refresh.isPending ? "animate-spin" : undefined}
                        />
                    }
                    title="Preparing this leaderboard"
                    description={
                        refresh.isPending
                            ? "Collecting contributions from GitHub. All-time and multi-month ranges can take up to a minute."
                            : "No snapshot exists for this period yet. Start a refresh to build it."
                    }
                    action={
                        <RefreshButton
                            label="Refresh now"
                            onRefresh={handleRefresh}
                            busy={refresh.isPending}
                        />
                    }
                />
            ) : (
                // Should be unreachable: isPending | isError | data are exhaustive.
                <ErrorState title="Something went wrong" description="Please try again." />
            )}

            {meta.data !== undefined && <MetaPanel meta={meta.data} />}
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
