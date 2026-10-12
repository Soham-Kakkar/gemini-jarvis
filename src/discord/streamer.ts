import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Message,
} from "discord.js";

const MAX_MESSAGE_LENGTH = 2000;

export type StreamStatus =
  | "working"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

export class DiscordStreamer {
  private readonly message: Message;
  private readonly taskId: string;
  private readonly intervalMs: number;

  private text = "";
  private error: string | null = null;
  private status: StreamStatus = "working";

  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastEdit = 0;
  private editQueue: Promise<void> = Promise.resolve();

  private constructor(message: Message, taskId: string, intervalMs: number) {
    this.message = message;
    this.taskId = taskId;
    this.intervalMs = intervalMs;
  }

  static async create(source: Message, taskId: string, intervalMs = 300): Promise<DiscordStreamer> {
    const message = await source.reply({
      content: "Working...",
      components: [DiscordStreamer.createCancelRow(taskId)],
      allowedMentions: {
        parse: [],
      },
    });

    return new DiscordStreamer(message, taskId, intervalMs);
  }

  push(chunk: string): void {
    if (this.status !== "working") return;
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

  setCancelling(): void {
    if (this.status !== "working") return;
    this.clearTimer();
    this.status = "cancelling";
    void this.flush(true);
  }

  async finish(): Promise<void> {
    this.clearTimer();
    this.status = "completed";
    await this.flush(true);
  }

  async fail(error: string): Promise<void> {
    this.clearTimer();
    this.status = "failed";
    this.error = error;
    await this.flush(true);
  }

  async cancel(): Promise<void> {
    this.clearTimer();
    this.status = "cancelled";
    await this.flush(true);
  }

  private static createCancelRow(taskId: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`cancel:${taskId}`)
        .setLabel(disabled ? "Cancelling..." : "Cancel")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
    );
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private renderContent(): string {
    let output = this.text || "Working...";

    if (this.status === "cancelling") output += "\n\nCancelling...";

    if (this.status === "cancelled") output += "\n\nCancelled.";

    if (this.status === "failed" && this.error) output += `\n\nError: ${this.error}`;

    if (output.length > MAX_MESSAGE_LENGTH) {
      output = output.slice(0, MAX_MESSAGE_LENGTH - 30) + "\n\n[Output truncated]";
    }

    return output;
  }

  private renderComponents(): ActionRowBuilder<ButtonBuilder>[] {
    if (this.status === "working") return [DiscordStreamer.createCancelRow(this.taskId)];
    if (this.status === "cancelling") return [DiscordStreamer.createCancelRow(this.taskId, true)];
    return [];
  }

  private async flush(force = false): Promise<void> {
    this.timer = null;

    if (!force && !this.text) return;

    const update = this.editQueue.then(async () => {
      await this.message.edit({
        content: this.renderContent(),
        components: this.renderComponents(),
        allowedMentions: {
          parse: [],
        },
      });

      this.lastEdit = performance.now();
    });

    this.editQueue = update.catch((error: unknown) => {
      console.error("Discord message update failed:", error);
    });

    await this.editQueue;
  }
}