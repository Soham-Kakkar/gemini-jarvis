import type { ButtonInteraction, Message } from "discord.js";
import { DiscordStreamer } from "../discord/streamer.js";
import type { GeminiClient } from "../gemini/client.js";

type TaskStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

interface Task {
  id: string;
  prompt: string;
  status: TaskStatus;

  streamer: DiscordStreamer;

  cancelRequested: boolean;

  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export class TaskManager {
  private readonly gemini: GeminiClient;

  private readonly tasks = new Map<string, Task>();
  private readonly queue: string[] = [];

  private activeTaskId: string | null = null;
  private processing = false;

  constructor(gemini: GeminiClient) {
    this.gemini = gemini;
  }

  async enqueue(
    prompt: string,
    source: Message,
  ): Promise<void> {
    const taskId = this.createTaskId();

    const streamer = await DiscordStreamer.create(
      source,
      taskId,
    );

    const task: Task = {
      id: taskId,
      prompt,
      status: "queued",
      streamer,
      cancelRequested: false,
      createdAt: Date.now(),
    };

    this.tasks.set(taskId, task);
    this.queue.push(taskId);

    void this.processQueue();
  }

  async cancel(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);

    if (!task) {
      return false;
    }

    if (
      task.status === "completed" ||
      task.status === "failed" ||
      task.status === "cancelled"
    ) {
      return false;
    }

    if (task.status === "queued") {
      task.cancelRequested = true;
      task.status = "cancelled";

      const index = this.queue.indexOf(taskId);

      if (index !== -1) {
        this.queue.splice(index, 1);
      }

      await task.streamer.cancel();

      return true;
    }

    if (task.status === "running") {
      task.cancelRequested = true;
      task.status = "cancelling";

      task.streamer.setCancelling();

      await this.gemini.cancel();

      return true;
    }

    return false;
  }

  async handleButton(
    interaction: ButtonInteraction,
  ): Promise<void> {
    const [action, taskId] = interaction.customId.split(":");

    if (action !== "cancel" || !taskId) {
      await interaction.deferUpdate();
      return;
    }

    await interaction.deferUpdate();

    await this.cancel(taskId);
  }

  getStatus(): string {
    if (!this.activeTaskId) {
      return "Idle.";
    }

    const task = this.tasks.get(this.activeTaskId);

    if (!task) {
      return "Idle.";
    }

    return [
      `Status: ${task.status}`,
      `Queued: ${this.queue.length}`,
    ].join("\n");
  }

  getTasks(): string {
    if (this.tasks.size === 0) {
      return "No tasks.";
    }

    return [...this.tasks.values()]
      .slice(-10)
      .reverse()
      .map((task) => `${task.id}: ${task.status}`)
      .join("\n");
  }

  private async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const taskId = this.queue.shift();

        if (!taskId) {
          continue;
        }

        const task = this.tasks.get(taskId);

        if (!task || task.cancelRequested) {
          continue;
        }

        await this.runTask(task);
      }
    } finally {
      this.activeTaskId = null;
      this.processing = false;
    }
  }

  private async runTask(task: Task): Promise<void> {
    this.activeTaskId = task.id;

    task.status = "running";
    task.startedAt = Date.now();

    try {
      await this.gemini.prompt(
        task.prompt,
        (chunk) => {
          task.streamer.push(chunk);
        },
      );

      if (task.cancelRequested) {
        task.status = "cancelled";
        task.finishedAt = Date.now();

        await task.streamer.cancel();

        return;
      }

      task.status = "completed";
      task.finishedAt = Date.now();

      await task.streamer.finish();
    } catch (error) {
      if (task.cancelRequested) {
        task.status = "cancelled";
        task.finishedAt = Date.now();

        await task.streamer.cancel();

        return;
      }

      task.status = "failed";
      task.finishedAt = Date.now();
      task.error =
        error instanceof Error
          ? error.message
          : String(error);

      await task.streamer.fail(task.error);
    }
  }

  private createTaskId(): string {
    return Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase();
  }
}