/**
 * Sends the daily Discord report once, right now, and exits.
 *
 *   npm run discord:report
 *
 * Uses the same config as the server (DISCORD_WEBHOOK_URL, LEADERBOARD_ORGS, ...).
 */
import mongoose from "mongoose";
import { config } from "../config/config.js";
import { connectDB } from "../infra/db/config/connectionDB.js";
import { sendDiscordReports } from "../jobs/discordCron.js";

if (config.Discord === undefined) {
    console.error("DISCORD_WEBHOOK_URL is not set, nothing to send.");
    process.exit(1);
}

await connectDB();
let failures = 1;
try {
    failures = await sendDiscordReports();
} finally {
    await mongoose.disconnect();
}
process.exit(failures === 0 ? 0 : 1);
