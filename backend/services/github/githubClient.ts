import { config } from "../../config/config.js";
import { createAppTokenProvider } from "./appAuth.js";
import { createGitHubClient } from "./client.js";

/**
 * The shared client used by the leaderboard collectors. Built once at import
 * time from validated config, so a missing GITHUB_TOKEN fails at boot.
 */
export const githubClient = createGitHubClient({
    token: config.GitHub.Token || undefined,
    appAuth:
        config.GitHub.App === undefined
            ? undefined
            : createAppTokenProvider({
                  appId: config.GitHub.App.AppId,
                  installationId: config.GitHub.App.InstallationId,
                  privateKey: config.GitHub.App.PrivateKey,
                  apiUrl: config.GitHub.ApiUrl,
              }),
    fallbackToken: config.GitHub.FallbackToken,
    apiUrl: config.GitHub.ApiUrl,
    timeoutMs: config.GitHub.TimeoutMs,
});
