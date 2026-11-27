import type { ReactNode } from "react";
import { Trophy } from "lucide-react";
import type { LeaderboardSnapshot, Scope } from "@/shared/api/types";
import { formatDate, formatNumber, formatRelativeTime } from "@/shared/lib/format";
import { ContributorLink } from "./ContributorLink";

interface LeaderboardHeroProps {
    org: string;
    scope: Scope;
    /** The loaded snapshot, or null while loading or when none exists yet. */
    snapshot: LeaderboardSnapshot | null;
    /** Rows skipped before this page: the podium is only the real top three on page one. */
    offset: number;
}

const PODIUM_SIZE = 3;

/**
 * The navy hero of the status page, for the leaderboard: the board name and a
 * short summary on the left, the podium (top three) in the panel on the right.
 */
export const LeaderboardHero = ({
    org,
    scope,
    snapshot,
    offset,
}: LeaderboardHeroProps): ReactNode => {
    const podium = snapshot !== null && offset === 0 ? snapshot.entries.slice(0, PODIUM_SIZE) : [];
    const plural = snapshot !== null && snapshot.total !== 1;
    const who =
        scope === "dev"
            ? plural
                ? "Dev department members"
                : "Dev department member"
            : plural
              ? "contributors"
              : "contributor";

    return (
        <section
            aria-label="Summary"
            className={`grid items-center gap-[clamp(1.5rem,5vw,5rem)] rounded-3xl bg-navy p-[clamp(1.5rem,3.85vw,3.35rem)] text-white md:min-h-[18rem] ${
                podium.length > 0 ? "md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.85fr)]" : ""
            }`}
        >
            <div className="min-w-0">
                <span className="mb-3.5 inline-grid size-[2.6rem] place-items-center rounded-[0.8rem] border border-[#555f90] bg-[#303a67] text-[#d4ddff]">
                    <Trophy size={20} aria-hidden />
                </span>
                <h1 className="max-w-[17ch] text-balance font-display text-[clamp(2.4rem,5vw,4.45rem)] font-bold leading-[0.99] tracking-[-0.058em]">
                    {org}
                </h1>
                <p className="mt-4 text-[0.95rem] text-hero-muted">
                    {scope === "dev"
                        ? "GitHub activity of the Dev department."
                        : "GitHub activity of everyone who contributed."}
                </p>

                {snapshot !== null && (
                    <ul className="mt-6 grid gap-x-5 gap-y-2 text-sm font-medium text-hero-muted sm:grid-cols-2">
                        <HeroFact>
                            <span className="tabular text-white">{formatNumber(snapshot.total)}</span>{" "}
                            {who}
                        </HeroFact>
                        <HeroFact>
                            {formatDate(snapshot.windowFrom)} – {formatDate(snapshot.windowTo)}
                        </HeroFact>
                        <HeroFact>Updated {formatRelativeTime(snapshot.generatedAt)}</HeroFact>
                    </ul>
                )}
            </div>

            {podium.length > 0 && (
                <div className="min-w-0 rounded-[0.95rem] border border-hero-line bg-hero-panel px-5 pb-4 pt-5">
                    <h2 className="mb-2.5 font-display text-[1.14rem] font-bold text-[#f6f7ff]">
                        Podium
                    </h2>
                    <ol>
                        {podium.map((entry, index) => (
                            <li
                                key={entry.key}
                                className={`flex items-center gap-3 py-2.5 ${
                                    index > 0 ? "border-t border-[#414d76]" : ""
                                }`}
                            >
                                <span className="grid size-6 shrink-0 place-items-center rounded-md bg-[#303a67] text-xs font-bold tabular text-[#d4ddff]">
                                    {entry.rank}
                                </span>
                                <ContributorLink
                                    login={entry.login}
                                    avatarUrl={entry.avatarUrl}
                                    className="flex-1 focus-visible:outline-[#d4ddff]"
                                    avatarClassName="bg-hero-line"
                                    nameClassName="text-sm font-semibold text-white"
                                />
                                <span className="text-sm font-bold tabular text-[#9cebd1]">
                                    {formatNumber(entry.score)}
                                </span>
                            </li>
                        ))}
                    </ol>
                </div>
            )}
        </section>
    );
};

const HeroFact = ({ children }: { children: ReactNode }): ReactNode => (
    <li className="flex items-baseline gap-2.5">
        <span className="mt-[0.46rem] size-1.5 shrink-0 self-start rounded-full bg-[#aab5e3]" aria-hidden />
        <span>{children}</span>
    </li>
);
