import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import type { RankZone } from "../rankZone";

interface RankBadgeProps {
    rank: number;
    zone: RankZone;
    /** Amber for the signed-in contributor, regardless of zone. */
    isYou?: boolean;
}

/** Rank medallion: green for the top four, red for the bottom three, amber for you. */
export const RankBadge = ({ rank, zone, isYou = false }: RankBadgeProps): ReactNode => {
    const tone = isYou
        ? "bg-warning/15 text-warning ring-warning/40"
        : zone === "top"
          ? "bg-[#e1f4eb] text-success ring-success/30"
          : zone === "bottom"
            ? "bg-[#fbe7ed] text-danger ring-danger/30"
            : "bg-overlay text-ink-muted ring-transparent";

    return (
        <span
            className={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 tabular",
                tone,
            )}
        >
            {rank}
        </span>
    );
};
