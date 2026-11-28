import type { WebhookPayload } from "./format.js";

const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
/** Discord says how long to wait on a 429; never wait longer than this. */
const MAX_RETRY_WAIT_MS = 30_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Posts one message to a Discord channel webhook. Retries a 429 (after the wait
 * Discord asks for) and 5xx answers; anything else fails at once. The error
 * never contains the webhook URL, which is a secret.
 */
export const postToDiscord = async (webhookUrl: string, payload: WebhookPayload): Promise<void> => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        let response: Response;
        try {
            response = await fetch(`${webhookUrl}?wait=true`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        } catch (error) {
            if (attempt === MAX_ATTEMPTS) {
                const reason = error instanceof Error ? error.message : String(error);
                throw new Error(`Discord is unreachable: ${reason}`);
            }
            await sleep(1_000 * attempt);
            continue;
        }

        if (response.ok) return;

        const retriable = response.status === 429 || response.status >= 500;
        if (!retriable || attempt === MAX_ATTEMPTS) {
            const detail = (await response.text().catch(() => "")).slice(0, 300);
            throw new Error(`Discord answered ${response.status}: ${detail}`);
        }

        const retryAfterS = Number(response.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfterS) && retryAfterS > 0 ? retryAfterS * 1000 : 1_000 * attempt;
        await sleep(Math.min(wait, MAX_RETRY_WAIT_MS));
    }
};
