/**
 * Calendar days in a named timezone (IANA, e.g. "Africa/Algiers"), whatever
 * timezone the server itself runs in. Uses only Intl, so no dependency and the
 * offset (and any daylight saving) comes from the runtime's tz database.
 */

export interface CalendarDay {
    year: number;
    /** 1 to 12. */
    month: number;
    day: number;
}

/** True when the runtime knows this IANA timezone name. */
export const isValidTimeZone = (timeZone: string): boolean => {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone });
        return true;
    } catch {
        return false;
    }
};

const partsIn = (instant: Date, timeZone: string): Record<string, number> => {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
    }).formatToParts(instant);

    const values: Record<string, number> = {};
    for (const part of parts) {
        if (part.type !== "literal") values[part.type] = Number(part.value);
    }
    return values;
};

/** How far the zone's wall clock is ahead of UTC at this instant, in ms. */
const offsetAt = (instant: Date, timeZone: string): number => {
    const p = partsIn(instant, timeZone);
    const wall = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
    return wall - Math.floor(instant.getTime() / 1000) * 1000;
};

/** The calendar day the zone is in at this instant. */
export const dayIn = (instant: Date, timeZone: string): CalendarDay => {
    const p = partsIn(instant, timeZone);
    return { year: p.year!, month: p.month!, day: p.day! };
};

/** The day before (or after, with a negative count) on the calendar. */
export const shiftDay = (day: CalendarDay, days: number): CalendarDay => {
    const date = new Date(Date.UTC(day.year, day.month - 1, day.day + days));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
};

/** The instant the day starts (00:00) in the zone. */
export const startOfDayIn = (day: CalendarDay, timeZone: string): Date => {
    const midnightAsUtc = Date.UTC(day.year, day.month - 1, day.day);
    // Two passes: the second corrects for an offset change (DST) near midnight.
    let instant = midnightAsUtc - offsetAt(new Date(midnightAsUtc), timeZone);
    instant = midnightAsUtc - offsetAt(new Date(instant), timeZone);
    return new Date(instant);
};

/** The day as an instant range: its 00:00 up to the last millisecond before the next 00:00. */
export const dayRangeIn = (day: CalendarDay, timeZone: string): { from: Date; to: Date } => ({
    from: startOfDayIn(day, timeZone),
    to: new Date(startOfDayIn(shiftDay(day, 1), timeZone).getTime() - 1),
});

/** `2026-11-27`. */
export const formatDay = (day: CalendarDay): string =>
    `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
