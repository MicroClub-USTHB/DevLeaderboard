import type { ReactNode } from "react";
import type { LeaderboardMeta, SnapshotSummary } from "@/shared/api/types";
import { formatNumber, formatRelativeTime } from "@/shared/lib/format";
import { PERIOD_LABELS } from "../constants";

interface MetaPanelProps {
    meta: LeaderboardMeta;
}

/** Custom ranges are identified by their date keys, not a fixed label. */
const snapshotLabel = (snapshot: SnapshotSummary): string => {
    if (snapshot.period !== "custom") return PERIOD_LABELS[snapshot.period];

    const [from, to] = snapshot.rangeKey.split("_");
    return from !== undefined && to !== undefined ? `${from} → ${to}` : PERIOD_LABELS.custom;
};

/**
 * Secondary info: how scoring works and how fresh each snapshot is.
 * Read-only context, never blocking.
 */
export const MetaPanel = ({ meta }: MetaPanelProps): ReactNode => {
    const { scoreWeights, snapshots } = meta;

    return (
        <section className="grid gap-4 rounded-xl border border-line bg-surface p-5 sm:grid-cols-2">
            <div>
                <h2 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Score weights
                </h2>
                <dl className="mt-3 space-y-1.5 text-sm">
                    {(
                        [
                            ["Commit", scoreWeights.Commit],
                            ["Pull request", scoreWeights.PullRequest],
                            ["Review", scoreWeights.Review],
                            ["Issue", scoreWeights.Issue],
                        ] as const
                    ).map(([label, weight]) => (
                        <div key={label} className="flex justify-between gap-3">
                            <dt className="text-ink-muted">{label}</dt>
                            <dd className="font-medium text-ink tabular">×{weight}</dd>
                        </div>
                    ))}
                </dl>
            </div>

            <div>
                <h2 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Snapshots
                </h2>
                {snapshots.length === 0 ? (
                    <p className="mt-3 text-sm text-ink-faint">None generated yet.</p>
                ) : (
                    <dl className="mt-3 space-y-1.5 text-sm">
                        {snapshots.map((snapshot) => (
                            <div
                                key={`${snapshot.period}:${snapshot.rangeKey}`}
                                className="flex justify-between gap-3"
                            >
                                <dt className="text-ink-muted">{snapshotLabel(snapshot)}</dt>
                                <dd className="text-right">
                                    <span className="font-medium text-ink tabular">
                                        {formatNumber(snapshot.entryCount)}
                                    </span>
                                    <span className="text-ink-faint"> · </span>
                                    <span className="text-ink-faint">
                                        {formatRelativeTime(snapshot.generatedAt)}
                                    </span>
                                </dd>
                            </div>
                        ))}
                    </dl>
                )}
            </div>
        </section>
    );
};
