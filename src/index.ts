import "dotenv/config";
import os from "node:os";
import { DiscordBot } from "./discord/bot.js";
import { DiscordStreamer } from "./discord/streamer.js";
import { GeminiClient } from "./gemini/client.js";

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

discord.onMessage(async (message) => {
  console.log(`DM: ${message.content}`);

  const start = performance.now();

  try {
    const reply = await message.reply("Thinking...");
    const streamer = new DiscordStreamer(reply);

    const result = await gemini.prompt(message.content, (chunk) => streamer.push(chunk));

    await streamer.finish();
    const elapsed = performance.now() - start;

    console.log(`Gemini finished: ${result.response.stopReason} in ${(elapsed / 1000).toFixed(2)}s`);
    console.log(`Total Discord round trip: ${((performance.now() - start) / 1000).toFixed(2)}s`);
  } catch (error) {
    console.error("Gemini error:", error);

    await message.reply("Something went wrong while talking to Gemini.");
  }
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