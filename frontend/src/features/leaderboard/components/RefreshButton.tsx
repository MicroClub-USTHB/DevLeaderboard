import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/Button";

interface RefreshButtonProps {
    label: string;
    onRefresh: () => void;
    /** Disables the button and swaps in a spinner while a sync runs. */
    busy: boolean;
}

/**
 * Triggers an explicit re-sync of the period on screen. The page owns the
 * mutation, so the same button can be reused for the first-run prompt.
 */
export const RefreshButton = ({ label, onRefresh, busy }: RefreshButtonProps): ReactNode => (
    <Button variant="secondary" loading={busy} onClick={onRefresh}>
        {!busy && <RefreshCw size={15} aria-hidden />}
        {label}
    </Button>
);
