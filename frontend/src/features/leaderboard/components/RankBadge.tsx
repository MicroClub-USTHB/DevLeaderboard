import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import type { RankZone } from "../rankZone";

interface RankBadgeProps {
    rank: number;
    zone: RankZone;
}

/** Rank medallion: green for the top four, red for the bottom three. */
export const RankBadge = ({ rank, zone }: RankBadgeProps): ReactNode => {
    const tone =
        zone === "top"
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
