import type { ReactNode } from "react";
import { Link, Outlet } from "react-router-dom";
import { Trophy } from "lucide-react";
import { DEFAULT_ORG } from "@/shared/lib/org";

/**
 * Shared page chrome, in the Micro Club status-page style: the club mark and a
 * "Micro Club | Leaderboard" wordmark, a skip link, and the routed outlet.
 */
export const AppLayout = (): ReactNode => (
    <div className="flex min-h-screen flex-col">
        <a
            href="#main"
            className="fixed left-3 top-3 z-20 -translate-y-[160%] rounded-md bg-surface px-3.5 py-2.5 text-sm focus:translate-y-0"
        >
            Skip to the leaderboard
        </a>

        <header className="border-b border-line">
            <div className="mx-auto flex min-h-[4.65rem] w-[min(100%-clamp(2rem,7vw,6rem),76rem)] items-center gap-6">
                <Link
                    to={`/leaderboard/${DEFAULT_ORG}`}
                    className="flex shrink-0 items-center gap-2.5 font-display text-lg font-extrabold tracking-[-0.04em]"
                >
                    <img
                        src="/favicon.png"
                        alt=""
                        width={36}
                        height={36}
                        className="rounded-[0.55rem]"
                    />
                    <span>
                        Micro Club{" "}
                        <span className="ml-1.5 border-l border-[#bbc5df] pl-2.5 font-sans text-[0.85rem] font-semibold tracking-normal text-ink-muted">
                            Leaderboard
                        </span>
                    </span>
                </Link>

                <span className="ml-auto hidden items-center gap-2 whitespace-nowrap text-[0.8125rem] font-semibold text-ink-muted sm:flex">
                    <Trophy size={16} className="text-accent-600" aria-hidden />
                    Ranked by GitHub activity
                </span>
            </div>
        </header>

        <main
            id="main"
            tabIndex={-1}
            className="mx-auto w-[min(100%-clamp(2rem,7vw,6rem),76rem)] flex-1 py-[clamp(1.25rem,3.1vw,3rem)] pb-16"
        >
            <Outlet />
        </main>
    </div>
);
