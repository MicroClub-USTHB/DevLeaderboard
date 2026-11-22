import type { Period } from "@/shared/api/types";

export const DEFAULT_PERIOD: Period = "month";

/**
 * The API caps `limit` at 100. Request the maximum so a typical organization's
 * all-time board is not silently truncated (the page still shows "N of M" if
 * an organization ever exceeds it).
 */
export const DEFAULT_LIMIT = 100;

/** Mirrors the backend's cap so the picker rejects oversized ranges locally. */
export const MAX_CUSTOM_DAYS = 366;

export const PERIOD_LABELS: Record<Period, string> = {
    month: "This month",
    all: "All time",
    custom: "Custom range",
};
