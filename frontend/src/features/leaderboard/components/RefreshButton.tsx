import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import type { Period } from "@/shared/api/types";
import { useAuth } from "@/features/auth/authContext";
import { Button } from "@/shared/ui/Button";
import { useRefresh } from "../api";

interface RefreshButtonProps {
    org: string;
    /** Refresh only this period; omit to refresh all three (backend default). */
    period?: Period;
    label: string;
}

/**
 * The only way to trigger a GitHub re-sync from the UI.
 *
 * - Disabled while signed out (refresh requires a Bearer token).
 * - `loading` both disables the button and swaps in a spinner, so a rapid
 *   double-click can never start two overlapping syncs.
 */
export const RefreshButton = ({ org, period, label }: RefreshButtonProps): ReactNode => {
    const { user } = useAuth();
    const { mutate, isPending } = useRefresh(org);

    const signedOut = user === null;

    const handleClick = (): void => {
        // Belt-and-braces: the button is disabled too, but never fire twice.
        if (isPending || signedOut) return;
        mutate(period);
    };

    return (
        <Button
            variant="secondary"
            loading={isPending}
            disabled={signedOut}
            onClick={handleClick}
            title={signedOut ? "Sign in to trigger a refresh" : undefined}
        >
            {!isPending && <RefreshCw size={15} aria-hidden />}
            {label}
        </Button>
    );
};
