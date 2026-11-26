import { createSign } from "node:crypto";
import { GitHubError } from "./errors.js";

/** Renew this long before GitHub's expiry so a token never dies mid-request. */
const REFRESH_MARGIN_MS = 5 * 60_000;
/** GitHub accepts an app JWT for at most 10 minutes. */
const JWT_LIFETIME_S = 9 * 60;
/** Backdate `iat` to tolerate clock drift between this host and GitHub. */
const JWT_CLOCK_SKEW_S = 60;

export interface GitHubAppOptions {
    appId: string;
    installationId: string;
    /** PEM, as downloaded from the app's Credentials page. */
    privateKey: string;
    apiUrl?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    /** Injection point for tests. */
    now?: () => number;
}

export interface AppTokenProvider {
    /** A valid installation token, minted on demand and cached until it nears expiry. */
    getToken: () => Promise<string>;
    /** Forget the cached token (GitHub rejected it); the next call mints a new one. */
    invalidate: () => void;
}

const base64Url = (value: object): string => Buffer.from(JSON.stringify(value)).toString("base64url");

/** The short-lived JWT that proves we are the app; it is only used to mint installation tokens. */
export const signAppJwt = (appId: string, privateKey: string, nowMs: number): string => {
    const issuedAt = Math.floor(nowMs / 1000);
    const unsigned = `${base64Url({ alg: "RS256", typ: "JWT" })}.${base64Url({
        iat: issuedAt - JWT_CLOCK_SKEW_S,
        exp: issuedAt + JWT_LIFETIME_S,
        iss: appId,
    })}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey).toString("base64url");
    return `${unsigned}.${signature}`;
};

/**
 * Installation tokens for a GitHub App. They carry their own quota (it grows with the
 * organization's size) instead of sharing a person's, and expire after an hour.
 */
export const createAppTokenProvider = (options: GitHubAppOptions): AppTokenProvider => {
    const apiUrl = (options.apiUrl ?? "https://api.github.com").replace(/\/+$/, "");
    const fetchImpl = options.fetchImpl ?? fetch;
    const now = options.now ?? Date.now;
    const timeoutMs = options.timeoutMs ?? 15_000;

    let cached: { token: string; expiresAt: number } | undefined;
    let inFlight: Promise<string> | undefined;

    const mint = async (): Promise<string> => {
        let response: Response;
        try {
            response = await fetchImpl(
                `${apiUrl}/app/installations/${encodeURIComponent(options.installationId)}/access_tokens`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${signAppJwt(options.appId, options.privateKey, now())}`,
                        Accept: "application/vnd.github+json",
                        "User-Agent": "wawachi-leaderboard",
                        "X-GitHub-Api-Version": "2022-11-28",
                    },
                    signal: AbortSignal.timeout(timeoutMs),
                },
            );
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new GitHubError(`Could not reach GitHub to mint an app token: ${detail}`, 0);
        }

        if (!response.ok) {
            throw new GitHubError(`GitHub App token request failed with status ${response.status}`, response.status);
        }

        const body = (await response.json()) as { token?: unknown; expires_at?: unknown };
        const expiresAt = typeof body.expires_at === "string" ? Date.parse(body.expires_at) : Number.NaN;
        if (typeof body.token !== "string" || body.token.length === 0 || Number.isNaN(expiresAt)) {
            throw new GitHubError("GitHub App token response was missing the token or its expiry", 0);
        }

        cached = { token: body.token, expiresAt };
        return body.token;
    };

    return {
        getToken: async () => {
            if (cached !== undefined && cached.expiresAt - now() > REFRESH_MARGIN_MS) return cached.token;

            // Concurrent callers share one request instead of minting several tokens.
            inFlight ??= mint().finally(() => {
                inFlight = undefined;
            });
            return inFlight;
        },
        invalidate: () => {
            cached = undefined;
        },
    };
};
