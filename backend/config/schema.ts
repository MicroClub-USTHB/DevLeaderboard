import { validate as validateCron } from "node-cron";
import { z } from "zod";

// Atlas hands out `mongodb+srv://`, local/self-hosted uses `mongodb://`.
const MONGODB_URL_PATTERN = /^mongodb(\+srv)?:\/\//i;

const databaseConfigSchema = z
    .object({
        /**
         * Full connection string (Atlas). When set it wins over every field
         * below, which exist for local/self-hosted development only.
         */
        Url: z
            .string()
            .trim()
            .refine(
                (value) => MONGODB_URL_PATTERN.test(value),
                "DATABASE_URL must be a mongodb:// or mongodb+srv:// connection string",
            )
            .optional(),
        /** URI scheme built from the discrete fields; Atlas requires srv. */
        Scheme: z.enum(["mongodb", "mongodb+srv"], "DATABASE_SCHEME must be mongodb or mongodb+srv"),
        Host: z.string().min(1, "Database host is required"),
        Port: z.coerce.number().int().positive(),
        // Empty credentials are valid: a local MongoDB usually runs without auth.
        User: z.string().trim(),
        Password: z.string().trim(),
        Name: z.string().min(1, "Database name is required"),
    })
    .superRefine((database, ctx) => {
        // A lone half of the credentials would silently skip authentication,
        // so refuse to boot instead of connecting without it.
        const hasUser = database.User.length > 0;
        const hasPassword = database.Password.length > 0;
        if (hasUser !== hasPassword) {
            ctx.addIssue({
                code: "custom",
                path: [hasUser ? "Password" : "User"],
                message: "DATABASE_USER and DATABASE_PASSWORD must be set together (or both left empty)",
            });
        }
    });

const rateLimitConfigSchema = z.object({
    // Manual refreshes hit GitHub, so they get a tight budget per IP.
    RefreshWindowMs: z.coerce.number().int().positive(),
    RefreshMax: z.coerce.number().int().positive(),
});

const githubAppSchema = z.object({
    AppId: z.string().min(1, "GITHUB_APP_ID is required"),
    InstallationId: z.string().min(1, "GITHUB_APP_INSTALLATION_ID is required"),
    PrivateKey: z.string().min(1, "the GitHub App private key is empty"),
});

const githubConfigSchema = z
    .object({
        // No default on purpose: leaderboard refresh is pointless without credentials.
        // Optional only when a GitHub App is configured (checked below).
        Token: z.string(),
        // Second token (another account) used while the others are rate limited.
        FallbackToken: z.string().min(1).optional(),
        // A GitHub App installation: own quota, no person's account involved. Preferred when set.
        App: githubAppSchema.optional(),
        ApiUrl: z.string().url("GITHUB_API_URL must be a valid URL"),
        TimeoutMs: z.coerce.number().int().positive(),
    })
    .refine((github) => github.Token.length > 0 || github.App !== undefined, {
        message: "GITHUB_TOKEN is required unless a GitHub App (GITHUB_APP_ID) is configured",
        path: ["Token"],
    });

const scoreWeightsSchema = z.object({
    Commit: z.coerce.number().nonnegative("SCORE_COMMIT must be >= 0"),
    PullRequest: z.coerce.number().nonnegative("SCORE_PR must be >= 0"),
    Review: z.coerce.number().nonnegative("SCORE_REVIEW must be >= 0"),
    Issue: z.coerce.number().nonnegative("SCORE_ISSUE must be >= 0"),
});

const leaderboardConfigSchema = z.object({
    Schedule: z
        .string()
        .min(1, "LEADERBOARD_CRON is required")
        .refine(validateCron, "LEADERBOARD_CRON must be a valid cron expression"),
    // Empty disables the scheduler (manual refresh still works for any org).
    Orgs: z.array(z.string().trim().min(1, "LEADERBOARD_ORGS entries must not be empty")),
    /**
     * Extra repositories to count on top of the organization's own repos.
     * Each entry is `org=owner/repo`, for example
     * `MicroClub-USTHB=maito-guy/wildfire-dz`.
     */
    ExtraRepos: z.array(
        z
            .string()
            .trim()
            .regex(
                /^[^=\s/]+\=[^=\s/]+\/[^=\s/]+$/,
                "LEADERBOARD_EXTRA_REPOS entries must look like org=owner/repo",
            ),
    ),
});

const logConfigSchema = z.object({
    Level: z.enum(["debug", "info", "warn", "error"], "LOG_LEVEL must be debug, info, warn or error"),
});

// The Dev department filter. MCID says who that is: members holding one of
// these Discord roles, with the GitHub account they linked. Optional: without
// it the Global view works and the Dev filter answers 503.
const mcidConfigSchema = z.object({
    /** MCID API root, including /api (e.g. https://mcid-api.microclub.info/api). */
    Url: z.string().url("MCID_URL must be a valid URL").transform((url) => url.replace(/\/+$/, "")),
    ApiKey: z.string().min(1, "MCID_API_KEY is required"),
    DevRoleIds: z
        .array(z.string().regex(/^\d{17,20}$/, "MCID_DEV_ROLE_IDS entries must be Discord role ids"))
        .min(1, "MCID_DEV_ROLE_IDS needs at least one Discord role id"),
    /** How long the Dev list is reused before MCID is asked again. */
    CacheTtlMs: z.coerce.number().int().positive(),
});

// "Link your GitHub": members sign in with MCID and submit their GitHub username
// to an MCID inbound webhook (identityMapping github), which fills the Dev list.
// Optional: without it the leaderboard has no sign-in and /link/me says disabled.
const linkConfigSchema = z.object({
    /** MCID API root, including /api. */
    Url: z.string().url("MCID_URL must be a valid URL").transform((url) => url.replace(/\/+$/, "")),
    ApiKey: z.string().min(1, "MCID_API_KEY is required"),
    ProjectId: z.string().min(1, "MCID_PROJECT_ID is required"),
    ServerId: z.string().min(1, "MCID_SERVER_ID is required"),
    WebhookId: z.string().min(1, "MCID_WEBHOOK_ID is required"),
    /** Empty when the webhook does not require a signature. */
    WebhookSecret: z.string(),
    /** Public origin of this site; the MCID redirect URI is <PublicUrl>/api/auth/callback. */
    PublicUrl: z
        .string()
        .url("PUBLIC_URL must be a valid URL")
        .transform((url) => url.replace(/\/+$/, "")),
    SessionSecret: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
});

// The daily Discord report: today's top 10 and this month's top 5, posted to a
// channel webhook. Optional: without DISCORD_WEBHOOK_URL nothing is posted.
const discordConfigSchema = z.object({
    WebhookUrl: z
        .string()
        .trim()
        .regex(
            /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/,
            "DISCORD_WEBHOOK_URL must be a Discord channel webhook URL",
        ),
    Schedule: z
        .string()
        .min(1, "DISCORD_CRON is required")
        .refine(validateCron, "DISCORD_CRON must be a valid cron expression"),
    /** Public site link shown in the message; empty leaves it out. */
    SiteUrl: z.union([
        z.literal(""),
        z
            .string()
            .url("DISCORD_SITE_URL must be a valid URL")
            .transform((url) => url.replace(/\/+$/, "")),
    ]),
    /** Name the messages are posted under. Discord refuses names containing "discord". */
    Username: z
        .string()
        .trim()
        .min(1, "DISCORD_USERNAME must not be empty")
        .max(80, "DISCORD_USERNAME must be at most 80 characters")
        .refine((name) => !/discord/i.test(name), "DISCORD_USERNAME must not contain \"discord\""),
    /** Picture the messages are posted with; empty uses the webhook's own picture. */
    AvatarUrl: z.union([z.literal(""), z.string().url("DISCORD_AVATAR_URL must be a valid URL")]),
    /** People shown on today's board (Discord shows at most 10 cards per message). */
    TodayLimit: z.coerce.number().int().min(1).max(10, "DISCORD_TODAY_LIMIT must be 1 to 10"),
    /** People shown on this month's board. */
    MonthLimit: z.coerce.number().int().min(1).max(10, "DISCORD_MONTH_LIMIT must be 1 to 10"),
});

export const configSchema = z.object({
    Database: databaseConfigSchema,
    Port: z.coerce.number().int().positive(),
    RateLimit: rateLimitConfigSchema,
    GitHub: githubConfigSchema,
    Score: scoreWeightsSchema,
    Leaderboard: leaderboardConfigSchema,
    Log: logConfigSchema,
    Mcid: mcidConfigSchema.optional(),
    Link: linkConfigSchema.optional(),
    Discord: discordConfigSchema.optional(),
});

export type DiscordConfig = z.infer<typeof discordConfigSchema>;
export type McidConfig = z.infer<typeof mcidConfigSchema>;
export type LinkConfig = z.infer<typeof linkConfigSchema>;
export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;
export type Config = z.infer<typeof configSchema>;
