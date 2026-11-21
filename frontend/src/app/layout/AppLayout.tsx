import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { Search, Trophy } from "lucide-react";
import { DEFAULT_ORG, isValidOrgLogin } from "@/shared/lib/org";

/**
 * Shared page chrome: brand, a compact org switcher, and the routed outlet.
 * The app is not locked to one organization — the default is just where the
 * root route lands.
 */
export const AppLayout = (): ReactNode => {
    const navigate = useNavigate();
    const [value, setValue] = useState("");
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();

        const org = value.trim();
        if (!isValidOrgLogin(org)) {
            setError("Enter a valid GitHub organization.");
            return;
        }

        setError(null);
        setValue("");
        navigate(`/leaderboard/${encodeURIComponent(org)}`);
    };

    return (
        <div className="flex min-h-screen flex-col">
            <header className="sticky top-0 z-10 border-b border-line bg-canvas/85 backdrop-blur">
                <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
                    <Link
                        to={`/leaderboard/${DEFAULT_ORG}`}
                        className="flex items-center gap-2.5 font-semibold tracking-tight"
                    >
                        <span className="flex size-8 items-center justify-center rounded-lg bg-accent-600 text-white">
                            <Trophy size={16} aria-hidden />
                        </span>
                        <span className="text-[15px]">DevLeaderboard</span>
                    </Link>

                    <form onSubmit={handleSubmit} className="relative" noValidate>
                        <Search
                            size={14}
                            aria-hidden
                            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
                        />
                        <input
                            value={value}
                            onChange={(event) => {
                                setValue(event.target.value);
                                if (error !== null) setError(null);
                            }}
                            placeholder="Switch org"
                            aria-label="GitHub organization name"
                            aria-invalid={error !== null}
                            autoComplete="off"
                            spellCheck={false}
                            className="h-8 w-36 rounded-lg border border-line bg-surface pl-8 pr-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/25 sm:w-44"
                        />
                        {error !== null && (
                            <p
                                role="alert"
                                className="absolute right-0 top-full mt-1 w-56 rounded-md border border-danger/30 bg-surface px-2.5 py-1.5 text-xs text-danger shadow-lg"
                            >
                                {error}
                            </p>
                        )}
                    </form>
                </div>
            </header>

            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
                <Outlet />
            </main>

            <footer className="border-t border-line">
                <div className="mx-auto w-full max-w-6xl px-4 py-6 text-sm text-ink-faint sm:px-6">
                    DevLeaderboard — contribution rankings, refreshed from GitHub.
                </div>
            </footer>
        </div>
    );
};
