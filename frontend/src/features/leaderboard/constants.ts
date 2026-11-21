import type { Period } from "@/shared/api/types";

export const DEFAULT_PERIOD: Period = "month";
export const DEFAULT_LIMIT = 50;

/** Mirrors the backend's cap so the picker rejects oversized ranges locally. */
export const MAX_CUSTOM_DAYS = 366;

export const PERIOD_LABELS: Record<Period, string> = {
    month: "This month",
    all: "All time",
    custom: "Custom range",
};
