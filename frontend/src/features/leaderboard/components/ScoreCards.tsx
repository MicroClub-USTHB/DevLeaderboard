import type { ReactNode } from "react";
import type { LeaderboardEntry } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { formatNumber } from "@/shared/lib/format";
import { rankZone, type RankZone } from "../rankZone";
import { ContributorLink } from "./ContributorLink";
import { RankBadge } from "./RankBadge";

interface ScoreCardsProps {
    entries: LeaderboardEntry[];
    /** Full board size, so bottom-zone colors survive pagination. */
    total: number;
    /** GitHub login of the signed-in member, highlighted in amber. */
    viewerLogin?: string | null;
}

const cardZoneClass: Record<RankZone, string> = {
    top: "border-l-success/70 bg-success/5",
    bottom: "border-l-danger/70 bg-danger/5",
    neutral: "border-l-transparent",
};

/** Mobile counterpart of ScoreTable — stacked cards below the md breakpoint. */
export const ScoreCards = ({ entries, total, viewerLogin }: ScoreCardsProps): ReactNode => (
    <ul className="space-y-2 md:hidden">
        {entries.map((entry) => {
            const zone = rankZone(entry.rank, total);
            const isYou =
                viewerLogin !== undefined &&
                viewerLogin !== null &&
                entry.login.toLowerCase() === viewerLogin.toLowerCase();

            return (
                <li
                    key={entry.key}
                    className={cn(
                        "rounded-xl border border-l-2 border-line p-3.5 transition-colors duration-150 active:bg-overlay/60",
                        cardZoneClass[zone],
                        isYou && "border-l-warning bg-warning/10 active:bg-warning/15",
                    )}
                >
                    <div className="flex items-center gap-3">
                        <RankBadge rank={entry.rank} zone={zone} isYou={isYou} />
                        <ContributorLink
                            login={entry.login}
                            avatarUrl={entry.avatarUrl}
                            className="flex-1"
                            avatarClassName="bg-overlay"
                            nameClassName="text-sm font-medium text-ink"
                            isYou={isYou}
                        />
                        <span className="text-sm font-semibold text-ink tabular">
                            {formatNumber(entry.score)}
                        </span>
                    </div>

                    <dl className="mt-3 grid grid-cols-4 gap-2 border-t border-line/60 pt-3 text-center">
                        {(
                            [
                                ["Commits", entry.commits],
                                ["PRs", entry.pullRequests],
                                ["Reviews", entry.reviews],
                                ["Issues", entry.issues],
                            ] as const
                        ).map(([label, value]) => (
                            <div key={label}>
                                <dt className="text-[11px] uppercase tracking-wide text-ink-faint">
                                    {label}
                                </dt>
                                <dd className="mt-0.5 text-sm text-ink-muted tabular">
                                    {formatNumber(value)}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </li>
            );
        })}
    </ul>
);
