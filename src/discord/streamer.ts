import type { Message } from "discord.js";

export class DiscordStreamer {
  private readonly message: Message;
  private readonly intervalMs: number;

  private text = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastEdit = 0;

  constructor(message: Message, intervalMs = 300) {
    this.message = message;
    this.intervalMs = intervalMs;
  }

  async start(): Promise<void> {
    await this.message.edit("Thinking...");
    this.lastEdit = performance.now();
  }

  push(chunk: string): void {
    this.text += chunk;
    const elapsed = performance.now() - this.lastEdit;

    if (elapsed >= this.intervalMs) {
      void this.flush();
      return;
    }

    if (!this.timer) {
      this.timer = setTimeout(() => { void this.flush(); }, this.intervalMs - elapsed);
    }
  }

  async finish(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    await this.flush();
  }

  private async flush(): Promise<void> {
    this.timer = null;

    if (!this.text) return;

    try {
      await this.message.edit(this.text);
      this.lastEdit = performance.now();
    } catch (error) {
      console.error("Discord edit failed:", error);
    }
  }
}