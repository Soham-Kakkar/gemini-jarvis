import "dotenv/config";
import os from "node:os";
import { DiscordBot } from "./discord/bot.js";
import { PermissionRelayer } from "./discord/permissions.js";
import { GeminiClient } from "./gemini/client.js";
import { TaskManager } from "./tasks/manager.js";

const discordToken = process.env.DISCORD_TOKEN;
const discordOwnerId = process.env.DISCORD_OWNER_ID;

if (!discordToken) {
  throw new Error("DISCORD_TOKEN is not set");
}

if (!discordOwnerId) {
  throw new Error("DISCORD_OWNER_ID is not set");
}

const gemini = new GeminiClient({
  cwd: os.homedir(),
});

const discord = new DiscordBot({
  token: discordToken,
  ownerId: discordOwnerId,
});

const permissions = new PermissionRelayer(discord.getClient(), discordOwnerId);

gemini.onPermissionRequest((params) => permissions.request(params));

const tasks = new TaskManager(gemini);

discord.onMessage(async (message) => {
  const content = message.content.trim();
  if (!content && message.attachments.size === 0) return;
  await tasks.enqueue(content, message);
});

discord.onButton(async (interaction) => {
  if (await permissions.handleButton(interaction)) return;
  await tasks.handleButton(interaction);
});

try {
  await gemini.start();
  await discord.start();
  console.log("Jarvis is ready.");

} catch (error) {
  console.error("Startup failed:", error);

  await discord.stop();
  await gemini.stop();

  process.exitCode = 1;
}

const shutdown = async () => {
  console.log("\nShutting down Jarvis...");

  await discord.stop();
  await gemini.stop();

  console.log("Jarvis stopped.");
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);