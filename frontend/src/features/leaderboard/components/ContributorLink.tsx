import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

interface ContributorLinkProps {
    login: string;
    avatarUrl: string;
    /** Classes for the avatar image (size, background). */
    avatarClassName?: string;
    /** Classes for the login text (size, weight, color). */
    nameClassName?: string;
    className?: string;
}

/** Every login on the board is a GitHub account, so its profile lives at github.com/<login>. */
const githubProfileUrl = (login: string): string =>
    `https://github.com/${encodeURIComponent(login)}`;

/**
 * Avatar + login, linked to the contributor's GitHub profile. Opens in a new
 * tab so the visitor keeps their place (page, period, scope) on the board.
 */
export const ContributorLink = ({
    login,
    avatarUrl,
    avatarClassName,
    nameClassName,
    className,
}: ContributorLinkProps): ReactNode => (
    <a
        href={githubProfileUrl(login)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${login} on GitHub (opens in a new tab)`}
        className={cn(
            "group flex min-w-0 items-center gap-3 rounded-md",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500",
            className,
        )}
    >
        <img
            src={avatarUrl}
            alt=""
            loading="lazy"
            className={cn("size-8 shrink-0 rounded-full object-cover", avatarClassName)}
        />
        <span
            className={cn(
                "min-w-0 truncate underline-offset-2 group-hover:underline",
                nameClassName,
            )}
        >
            {login}
        </span>
    </a>
);
