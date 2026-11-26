export interface RateLimitInfo {
    limit?: number;
    remaining?: number;
    resetAt?: Date;
    /** GraphQL only: points consumed by the last request. */
    cost?: number;
    resource?: string;
}

export interface RestClientOptions {
    /** Personal access token. Optional when `appAuth` is set. */
    token?: string;
    /** GitHub App installation tokens; tried first because they have their own, larger quota. */
    appAuth?: { getToken: () => Promise<string>; invalidate: () => void };
    /**
     * Optional second token, ideally from a different GitHub account (the 5,000/hour
     * quota is per user, so a second token of the same user shares it). Used only
     * while the primary is rate limited; the primary is preferred again after its
     * quota resets.
     */
    fallbackToken?: string;
    apiUrl?: string;
    timeoutMs?: number;
    /** How many times a rate-limited, 5xx or timed-out request is retried. */
    maxRetries?: number;
    /** Hard bound on pages followed per paginated call. */
    maxPages?: number;
    /** Injection points so tests never touch the network or a clock. */
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
}

export interface GitHubRequestOptions {
    method?: "GET" | "POST";
    body?: string;
}

/** One page of a cursor-based GraphQL connection. */
export interface GraphqlPage<T> {
    items: T[];
    pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
    };
}

export interface GitHubClient {
    /** Single GraphQL request against /graphql. Throws on any `errors` entry. */
    graphql: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;
    /** Walks a paginated REST collection (Link header) yielding every item. */
    paginateRest: <T>(path: string) => AsyncGenerator<T, void, undefined>;
    getRateLimit: () => RateLimitInfo | undefined;
    /**
     * OAuth scopes reported by `GET /`. Classic tokens return a list;
     * fine-grained tokens send no scope header, so this resolves to undefined.
     */
    getScopes: () => Promise<string[] | undefined>;
}
