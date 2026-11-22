import { GitHubError } from "../github/errors.js";
import { githubClient } from "../github/githubClient.js";
import { drain, paginateGraphql } from "../github/pagination.js";
import type { GraphqlPage } from "../github/types.js";
import { mapWithConcurrency } from "../../lib/concurrency.js";
import { isBotLogin } from "./aggregator.js";
import {
    resolveWindow,
    splitWindow,
    type CustomRange,
    type Period,
    type TimeWindow,
} from "./periods.js";
import type { CollectResult, RawContributor } from "./types.js";

/** Users per GraphQL request. Keeps query complexity (and cost) predictable. */
const BATCH_SIZE = 10;

/**
 * GitHub allows plenty of parallelism; these caps keep the refresh fast
 * without tripping secondary rate limits.
 */
const REPO_CONCURRENCY = 5;
const CONTRIBUTION_CONCURRENCY = 4;

const ORG_MEMBERS_QUERY = `
query ($login: String!, $cursor: String) {
  organization(login: $login) {
    id
    login
    createdAt
    membersWithRole(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { id login avatarUrl }
    }
  }
}`;

/**
 * Identity-only query. Unlike `membersWithRole`, this is readable by any
 * token that can see the organization — including fine-grained tokens that
 * have not been approved for the org.
 */
const ORG_IDENTITY_QUERY = `
query ($login: String!) {
  organization(login: $login) {
    id
    login
    createdAt
  }
}`;

/**
 * Aliased batch: one request pulls identity + contributions for up to
 * BATCH_SIZE users. Logins travel as variables ($l0, $l1, ...) — never
 * interpolated into the query string — so no escaping rules to get wrong.
 */
const buildContributionsQuery = (batchSize: number): string => {
    const variableDefs = Array.from({ length: batchSize }, (_, index) => `$l${index}: String!`).join(", ");
    const fields = Array.from(
        { length: batchSize },
        (_, index) => `u${index}: user(login: $l${index}) {
      id
      login
      avatarUrl
      contributionsCollection(organizationID: $orgId, from: $from, to: $to) {
        totalCommitContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        totalIssueContributions
      }
    }`,
    ).join("\n");

    return `query ($orgId: ID!, $from: DateTime!, $to: DateTime!, ${variableDefs}) {\n${fields}\n}`;
};

interface UserNode {
    id: string;
    login: string;
    avatarUrl: string;
}

interface OrgNode {
    id: string;
    login: string;
    createdAt: string;
}

interface ContributionsCollection {
    totalCommitContributions: number;
    totalPullRequestContributions: number;
    totalPullRequestReviewContributions: number;
    totalIssueContributions: number;
}

interface BatchUser {
    id: string;
    login: string;
    avatarUrl: string;
    contributionsCollection: ContributionsCollection | null;
}

type BatchResponse = Record<string, BatchUser | null>;

interface OrgMembersResponse {
    organization:
        | {
              id: string;
              login: string;
              createdAt: string;
              membersWithRole: NodesPage<UserNode>;
          }
        | null;
}

interface OrgIdentityResponse {
    organization: OrgNode | null;
}

interface OutsideCollaboratorRest {
    id: number;
    node_id?: string;
    login: string;
    avatar_url: string;
}

interface RepoRest {
    full_name: string;
    fork: boolean;
    private: boolean;
    default_branch: string;
}

/** What GraphQL actually sends over the wire for a connection field. */
interface NodesPage<T> {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: T[];
}

/** GraphQL returns `nodes`; paginateGraphql consumes `items`. */
const asItemsPage = <T>(page: NodesPage<T>): GraphqlPage<T> => ({
    items: page.nodes,
    pageInfo: page.pageInfo,
});

/** The subset of the client the collector needs — trivial to fake in tests. */
export interface CollectorClient {
    graphql: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;
    paginateRest: <T>(path: string) => AsyncGenerator<T, void, undefined>;
    /** Optional so existing fakes stay valid; absent means "no scope header". */
    getScopes?: () => Promise<string[] | undefined>;
}

/** Which API produced the member list — surfaced only in logs. */
export type MemberSource = "membersWithRole" | "fallback";

interface OrgWithMembers {
    id: string;
    login: string;
    createdAt: Date;
    members: UserNode[];
    memberSource: MemberSource;
    /** Every repository the token can see, forks included. */
    repos: RepoRest[];
}

const requireOrg = <T>(organization: T | null | undefined, orgLogin: string): T => {
    if (organization === null || organization === undefined) {
        throw new GitHubError(`Organization not found: ${orgLogin}`, 404);
    }
    return organization;
};

/**
 * GitHub refuses `membersWithRole` to tokens that cannot see org membership:
 * a fine-grained PAT that was never approved by the org, or a classic token
 * without `read:org`. Those tokens can still read the public profile and the
 * public member list, which is enough for a public leaderboard.
 */
const isPermissionError = (error: unknown): boolean =>
    error instanceof GitHubError &&
    (error.status === 403 ||
        error.type === "FORBIDDEN" ||
        error.type === "INSUFFICIENT_SCOPES" ||
        /not accessible|must be an owner|not have permission/i.test(error.message));

/**
 * A repository that cannot be read (permission, missing, or empty) is safe to
 * skip. Rate limits, network failures and 5xx must fail the refresh so the
 * previous snapshot stays on screen instead of being replaced by a partial one.
 */
const isSkippableRepoError = (error: unknown): boolean =>
    error instanceof GitHubError &&
    (error.status === 403 || error.status === 404 || error.status === 409) &&
    error.rateLimit?.remaining !== 0;

const fetchOrgIdentity = async (
    orgLogin: string,
    client: CollectorClient,
): Promise<OrgNode> => {
    const data = await client.graphql<OrgIdentityResponse>(ORG_IDENTITY_QUERY, { login: orgLogin });
    return requireOrg(data.organization, orgLogin);
};

const fetchMembersWithRole = async (
    orgLogin: string,
    client: CollectorClient,
): Promise<{ org: OrgNode; members: UserNode[] }> => {
    let org: OrgNode | undefined;

    const memberPages = async (cursor: string | null): Promise<GraphqlPage<UserNode>> => {
        const data = await client.graphql<OrgMembersResponse>(ORG_MEMBERS_QUERY, {
            login: orgLogin,
            cursor,
        });
        const organization = requireOrg(data.organization, orgLogin);
        org ??= {
            id: organization.id,
            login: organization.login,
            createdAt: organization.createdAt,
        };
        return asItemsPage(organization.membersWithRole);
    };

    const members = await drain(paginateGraphql(memberPages));
    if (org === undefined) {
        // Unreachable: the generator always fetches at least one page.
        throw new GitHubError(`GitHub returned no organization for ${orgLogin}`, 404);
    }

    return { org, members };
};

/** Public members are readable without org membership; paginated like any REST list. */
const fetchPublicMembers = async (
    orgLogin: string,
    client: CollectorClient,
): Promise<UserNode[]> => {
    const path = `/orgs/${encodeURIComponent(orgLogin)}/public_members?per_page=100`;
    const members: UserNode[] = [];

    for await (const member of client.paginateRest<OutsideCollaboratorRest>(path)) {
        if (member.login === undefined || member.login.length === 0) continue;
        members.push({
            id: member.node_id ?? String(member.id),
            login: member.login,
            avatarUrl: member.avatar_url ?? "",
        });
    }

    return members;
};

/**
 * Every repository the token can see, private ones included. A forbidden or
 * missing repository list degrades to an empty list; rate limits and network
 * failures propagate so a partial snapshot is never cached.
 */
const fetchOrgRepos = async (
    orgLogin: string,
    client: CollectorClient,
): Promise<RepoRest[]> => {
    const reposPath = `/orgs/${encodeURIComponent(orgLogin)}/repos?per_page=100&type=all`;
    try {
        return await drain(client.paginateRest<RepoRest>(reposPath));
    } catch (error) {
        if (isSkippableRepoError(error)) return [];
        throw error;
    }
};

/**
 * Contributors of every repository in the org. Without `read:org` this is the
 * most complete contributor list available: it includes people whose org
 * membership is private, which the public member list misses entirely.
 */
const fetchRepoContributors = async (
    repos: RepoRest[],
    client: CollectorClient,
): Promise<UserNode[]> => {
    // Forks are copies of someone else's history; their contributors are not
    // necessarily contributors to this organization.
    const sources = repos.filter((repo) => !repo.fork);

    const lists = await mapWithConcurrency(sources, REPO_CONCURRENCY, async (repo) => {
        try {
            const path = `/repos/${repo.full_name}/contributors?per_page=100`;
            return await drain(client.paginateRest<OutsideCollaboratorRest>(path));
        } catch (error) {
            // One inaccessible or empty repository must not fail the whole run.
            if (isSkippableRepoError(error)) return [];
            throw error;
        }
    });

    const users: UserNode[] = [];
    for (const contributor of lists.flat()) {
        if (contributor.login === undefined || contributor.login.length === 0) continue;
        users.push({
            id: contributor.node_id ?? String(contributor.id),
            login: contributor.login,
            avatarUrl: contributor.avatar_url ?? "",
        });
    }

    return users;
};

const toOrgDate = (value: string, orgLogin: string): Date => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new GitHubError(`GitHub returned an invalid creation date for ${orgLogin}`, 502);
    }
    return date;
};

/**
 * Resolves the org and its members, degrading from the full member list to
 * public members when the token is not allowed to see membership.
 */
const fetchOrgWithMembers = async (
    orgLogin: string,
    client: CollectorClient,
): Promise<OrgWithMembers> => {
    let memberResult: { org: OrgNode; members: UserNode[] };

    try {
        memberResult = await fetchMembersWithRole(orgLogin, client);
    } catch (error) {
        if (!isPermissionError(error)) throw error;

        // Fine-grained tokens that are not approved for the org can read the
        // public profile, the public member list and every public repository.
        // Union both sources so private members are not silently dropped.
        const org = await fetchOrgIdentity(orgLogin, client);
        const [publicMembers, repos] = await Promise.all([
            fetchPublicMembers(orgLogin, client),
            fetchOrgRepos(orgLogin, client),
        ]);
        const repoContributors = await fetchRepoContributors(repos, client);

        return {
            id: org.id,
            login: org.login,
            createdAt: toOrgDate(org.createdAt, orgLogin),
            members: [...publicMembers, ...repoContributors],
            memberSource: "fallback",
            repos,
        };
    }

    const { org, members } = memberResult;
    const repos = await fetchOrgRepos(orgLogin, client);

    // The member list alone is not enough: someone can contribute to an
    // organization repository without being a member or an outside
    // collaborator (a one-off PR, a drive-by commit, a bot-owned account).
    // Unioning repository contributors closes that gap for every token,
    // not just the permission-limited fallback above. Private repositories
    // are included automatically when the token can see them.
    const repoContributors = await fetchRepoContributors(repos, client);

    return {
        id: org.id,
        login: org.login,
        createdAt: toOrgDate(org.createdAt, orgLogin),
        members: [...members, ...repoContributors],
        memberSource: "membersWithRole",
        repos,
    };
};

/**
 * GitHub resolves `user(login:)` to null for accounts that no longer exist and
 * rejects bot logins (`dependabot[bot]`) outright. A single bad login must not
 * fail a whole batch, so such errors are retried one user at a time.
 */
const isUnresolvableUser = (error: unknown): boolean =>
    error instanceof GitHubError &&
    (error.status === 404 ||
        error.type === "NOT_FOUND" ||
        /could not resolve to a user/i.test(error.message));

/** Private repositories are scanned with bounded parallelism, like public ones. */
const PRIVATE_REPO_CONCURRENCY = 3;

/**
 * Review counting costs one request per PR, so cap it. PR/issue/commit counts
 * are unaffected; only the review scan of very busy private repositories is
 * bounded.
 */
const MAX_REVIEW_PRS_PER_REPO = 500;

/** Activity discovered by reading a private repository directly. */
interface PrivateActivity {
    user: UserNode;
    commits: number;
    pullRequests: number;
    reviews: number;
    issues: number;
}

interface RestUser {
    login: string;
    id: number;
    node_id?: string;
    avatar_url?: string;
}

interface CommitRest {
    author: RestUser | null;
}

interface PullRest {
    number: number;
    user: RestUser | null;
    created_at: string;
    updated_at: string;
}

interface ReviewRest {
    user: RestUser | null;
    submitted_at: string | null;
}

interface IssueRest {
    user: RestUser | null;
    created_at: string;
    pull_request?: unknown;
}

const toRestUser = (user: RestUser | null): UserNode | undefined => {
    if (user === null || user.login.length === 0) return undefined;
    return {
        id: user.node_id ?? String(user.id),
        login: user.login,
        avatarUrl: user.avatar_url ?? "",
    };
};

const activityFor = (
    activity: Map<string, PrivateActivity>,
    user: UserNode,
): PrivateActivity => {
    const key = user.login.toLowerCase();
    const existing = activity.get(key);
    if (existing !== undefined) return existing;

    const created: PrivateActivity = {
        user,
        commits: 0,
        pullRequests: 0,
        reviews: 0,
        issues: 0,
    };
    activity.set(key, created);
    return created;
};

const timeOf = (value: string): number => Date.parse(value);

/**
 * Counts one private repository's activity in the window. Mirrors the
 * definitions of GitHub's `contributionsCollection`: commits on the default
 * branch, PRs opened, issues opened, and one review per person per PR.
 */
const countPrivateRepoActivity = async (
    repo: RepoRest,
    window: TimeWindow,
    client: CollectorClient,
    activity: Map<string, PrivateActivity>,
): Promise<void> => {
    const from = window.from.getTime();
    const to = window.to.getTime();
    const fromIso = window.from.toISOString();
    const toIso = window.to.toISOString();

    // Commits on the default branch, restricted to the window by the API.
    const commitsPath = `/repos/${repo.full_name}/commits?since=${encodeURIComponent(
        fromIso,
    )}&until=${encodeURIComponent(toIso)}&per_page=100`;
    for await (const commit of client.paginateRest<CommitRest>(commitsPath)) {
        const user = toRestUser(commit.author);
        if (user === undefined) continue;
        activityFor(activity, user).commits += 1;
    }

    // PRs updated in the window. A PR opened in the window is necessarily
    // updated in it too, so one listing covers both PR counts and reviews.
    const pullsPath = `/repos/${repo.full_name}/pulls?state=all&sort=updated&direction=desc&per_page=100`;
    let reviewScans = 0;
    for await (const pull of client.paginateRest<PullRest>(pullsPath)) {
        if (timeOf(pull.updated_at) < from) break;

        const createdAt = timeOf(pull.created_at);
        if (createdAt >= from && createdAt <= to) {
            const author = toRestUser(pull.user);
            if (author !== undefined) activityFor(activity, author).pullRequests += 1;
        }

        if (reviewScans >= MAX_REVIEW_PRS_PER_REPO) continue;
        reviewScans += 1;

        const reviewsPath = `/repos/${repo.full_name}/pulls/${pull.number}/reviews?per_page=100`;
        const reviewers = new Set<string>();
        for await (const review of client.paginateRest<ReviewRest>(reviewsPath)) {
            if (review.submitted_at === null) continue;
            const submittedAt = timeOf(review.submitted_at);
            if (submittedAt < from || submittedAt > to) continue;

            const reviewer = toRestUser(review.user);
            if (reviewer === undefined) continue;
            reviewers.add(reviewer.login.toLowerCase());
            activityFor(activity, reviewer);
        }

        // GraphQL counts a review contribution once per person per PR.
        for (const login of reviewers) {
            const entry = activity.get(login);
            if (entry !== undefined) entry.reviews += 1;
        }
    }

    // Issues opened in the window. This endpoint also returns pull requests.
    const issuesPath = `/repos/${repo.full_name}/issues?state=all&sort=created&direction=desc&per_page=100`;
    for await (const issue of client.paginateRest<IssueRest>(issuesPath)) {
        if (timeOf(issue.created_at) < from) break;
        if (issue.pull_request !== undefined) continue;
        if (timeOf(issue.created_at) > to) continue;

        const author = toRestUser(issue.user);
        if (author === undefined) continue;
        activityFor(activity, author).issues += 1;
    }
};

/** True when the token's scope lets GraphQL include private contributions. */
const privateContributionsAreVisible = async (client: CollectorClient): Promise<boolean> => {
    if (client.getScopes === undefined) return false;
    try {
        const scopes = await client.getScopes();
        return scopes?.includes("read:user") ?? false;
    } catch {
        return false;
    }
};

const collectPrivateActivity = async (
    repos: RepoRest[],
    window: TimeWindow,
    client: CollectorClient,
): Promise<Map<string, PrivateActivity>> => {
    const perRepo = await mapWithConcurrency(repos, PRIVATE_REPO_CONCURRENCY, async (repo) => {
        const activity = new Map<string, PrivateActivity>();
        try {
            await countPrivateRepoActivity(repo, window, client, activity);
        } catch (error) {
            // One unreadable private repository must not fail the whole run.
            if (!isSkippableRepoError(error)) throw error;
        }
        return activity;
    });

    const merged = new Map<string, PrivateActivity>();
    for (const activity of perRepo) {
        for (const [login, counts] of activity) {
            const existing = merged.get(login);
            if (existing === undefined) {
                merged.set(login, { ...counts });
                continue;
            }
            existing.commits += counts.commits;
            existing.pullRequests += counts.pullRequests;
            existing.reviews += counts.reviews;
            existing.issues += counts.issues;
        }
    }
    return merged;
};

/**
 * Adds private-repository counts to the GraphQL totals. Merging is by login
 * because direct REST reads do not share GraphQL's node-id key for every
 * contributor (for example, issue authors who never committed).
 */
const mergePrivateActivity = (
    contributors: RawContributor[],
    activity: Map<string, PrivateActivity>,
): RawContributor[] => {
    const byLogin = new Map(contributors.map((entry) => [entry.login.toLowerCase(), entry]));

    for (const [login, counts] of activity) {
        const existing = byLogin.get(login);
        if (existing !== undefined) {
            existing.commits += counts.commits;
            existing.pullRequests += counts.pullRequests;
            existing.reviews += counts.reviews;
            existing.issues += counts.issues;
            continue;
        }

        const created: RawContributor = {
            key: counts.user.id,
            login: counts.user.login,
            avatarUrl: counts.user.avatarUrl,
            commits: counts.commits,
            pullRequests: counts.pullRequests,
            reviews: counts.reviews,
            issues: counts.issues,
        };
        byLogin.set(login, created);
        contributors.push(created);
    }

    return contributors;
};

interface BatchResult {
    user: BatchUser | null;
    error?: string;
}

const queryContributionBatch = async (
    batch: UserNode[],
    orgId: string,
    window: TimeWindow,
    client: CollectorClient,
): Promise<BatchResult[]> => {
    const variables: Record<string, unknown> = {
        orgId,
        from: window.from.toISOString(),
        to: window.to.toISOString(),
    };
    batch.forEach((user, index) => {
        variables[`l${index}`] = user.login;
    });

    try {
        const data = await client.graphql<BatchResponse>(
            buildContributionsQuery(batch.length),
            variables,
        );
        return batch.map((_, index) => ({ user: data[`u${index}`] ?? null }));
    } catch (error) {
        if (!isUnresolvableUser(error)) throw error;

        if (batch.length === 1) {
            const detail = error instanceof Error ? error.message : String(error);
            return [{ user: null, error: `Skipped "${batch[0].login}": ${detail}` }];
        }

        const results: BatchResult[] = [];
        for (const user of batch) {
            results.push(...(await queryContributionBatch([user], orgId, window, client)));
        }
        return results;
    }
};

export const collectContributions = async (
    orgLogin: string,
    period: Period,
    now: Date,
    customRange?: CustomRange,
    client: CollectorClient = githubClient,
): Promise<CollectResult> => {
    const warnings: string[] = [];

    // 1. Organization + members. A missing org fails loudly here; a permission
    //    problem falls back to public members + repo contributors.
    const org = await fetchOrgWithMembers(orgLogin, client);
    const window = resolveWindow(period, now, { orgCreatedAt: org.createdAt, customRange });
    const chunks = splitWindow(window);
    const users: UserNode[] = [...org.members];

    // 2. Outside collaborators via REST — GitHub exposes no GraphQL field for
    //    them, and listing requires org ownership. A permission error is
    //    expected for non-owner tokens and is not a snapshot warning; any
    //    other failure is reported.
    try {
        const path = `/orgs/${encodeURIComponent(orgLogin)}/outside_collaborators?per_page=100`;
        for await (const collaborator of client.paginateRest<OutsideCollaboratorRest>(path)) {
            if (collaborator.login === undefined || collaborator.login.length === 0) continue;
            users.push({
                id: collaborator.node_id ?? String(collaborator.id),
                login: collaborator.login,
                avatarUrl: collaborator.avatar_url ?? "",
            });
        }
    } catch (error) {
        if (!isPermissionError(error)) {
            const detail = error instanceof Error ? error.message : String(error);
            warnings.push(`Outside collaborators unavailable: ${detail}`);
        }
    }

    // GitHub logins are globally unique across both sources; dedupe on them so
    // the same person is never counted twice. Bots are dropped before querying
    // because GitHub's `user(login:)` does not resolve `[bot]` accounts.
    const uniqueUsers = [
        ...new Map(
            users
                .filter((user) => user.login.length > 0 && !isBotLogin(user.login))
                .map((user) => [user.login.toLowerCase(), user] as const),
        ).values(),
    ];

    // 3. Contributions, batched. Multi-year windows are queried one chunk at a
    //    time and summed, because GitHub caps a single range at one year.
    const batches: UserNode[][] = [];
    for (let start = 0; start < uniqueUsers.length; start += BATCH_SIZE) {
        batches.push(uniqueUsers.slice(start, start + BATCH_SIZE));
    }

    const batchContributors = await mapWithConcurrency(
        batches,
        CONTRIBUTION_CONCURRENCY,
        async (batch) => {
            const totals = new Map<string, RawContributor>();
            const reported = new Set<string>();
            const reportedNoData = new Set<string>();

            for (const chunk of chunks) {
                const results = await queryContributionBatch(batch, org.id, chunk, client);

                results.forEach(({ user: result, error }, index) => {
                    const login = batch[index].login;

                    if (result === null || result === undefined) {
                        if (!reported.has(login)) {
                            reported.add(login);
                            warnings.push(error ?? `GitHub returned no user for login "${login}"`);
                        }
                        return;
                    }

                    const collection = result.contributionsCollection;
                    if (
                        (collection === null || collection === undefined) &&
                        !reportedNoData.has(result.login)
                    ) {
                        reportedNoData.add(result.login);
                        warnings.push(`No contribution data for "${result.login}"; counted as zero`);
                    }

                    const existing = totals.get(result.id);
                    if (existing === undefined) {
                        totals.set(result.id, {
                            key: result.id,
                            login: result.login,
                            avatarUrl: result.avatarUrl,
                            commits: collection?.totalCommitContributions ?? 0,
                            pullRequests: collection?.totalPullRequestContributions ?? 0,
                            reviews: collection?.totalPullRequestReviewContributions ?? 0,
                            issues: collection?.totalIssueContributions ?? 0,
                        });
                        return;
                    }

                    existing.commits += collection?.totalCommitContributions ?? 0;
                    existing.pullRequests += collection?.totalPullRequestContributions ?? 0;
                    existing.reviews += collection?.totalPullRequestReviewContributions ?? 0;
                    existing.issues += collection?.totalIssueContributions ?? 0;
                    existing.login = result.login;
                    existing.avatarUrl = result.avatarUrl;
                });
            }

            return [...totals.values()];
        },
    );

    let contributors = batchContributors.flat();

    // GitHub's contribution graph omits private activity unless the token has
    // `read:user`. When private repositories are visible but that scope is
    // missing, read them directly so private work is still ranked.
    const privateRepos = org.repos.filter((repo) => repo.private && !repo.fork);
    if (privateRepos.length > 0 && !(await privateContributionsAreVisible(client))) {
        const privateActivity = await collectPrivateActivity(privateRepos, window, client);
        contributors = mergePrivateActivity(contributors, privateActivity);
    }

    return {
        contributors,
        warnings,
        window,
        orgCreatedAt: org.createdAt,
    };
};
