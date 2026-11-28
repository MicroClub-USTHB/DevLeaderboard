import type { WebhookPayload } from "./format.js";

const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
/** Discord says how long to wait on a 429; never wait longer than this. */
const MAX_RETRY_WAIT_MS = 30_000;

/** A file uploaded with the message, referenced from embeds as `attachment://<name>`. */
export interface WebhookFile {
    name: string;
    contentType: string;
    data: Buffer;
}

/** JSON when there is nothing to upload, multipart (payload_json + files[n]) otherwise. */
const bodyFor = (payload: WebhookPayload, files: readonly WebhookFile[]): { body: BodyInit; headers: Record<string, string> } => {
    if (files.length === 0) {
        return { body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } };
    }
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    files.forEach((file, index) => {
        form.append(`files[${index}]`, new Blob([new Uint8Array(file.data)], { type: file.contentType }), file.name);
    });
    // fetch sets the multipart Content-Type with its boundary.
    return { body: form, headers: {} };
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Posts one message to a Discord channel webhook. Retries a 429 (after the wait
 * Discord asks for) and 5xx answers; anything else fails at once. The error
 * never contains the webhook URL, which is a secret.
 */
export const postToDiscord = async (
    webhookUrl: string,
    payload: WebhookPayload,
    files: readonly WebhookFile[] = [],
): Promise<void> => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        let response: Response;
        try {
            // A fresh body per attempt: a sent FormData cannot be reused.
            const { body, headers } = bodyFor(payload, files);
            response = await fetch(`${webhookUrl}?wait=true`, {
                method: "POST",
                headers,
                body,
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
