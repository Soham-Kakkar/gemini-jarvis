import type { ChildProcess } from "node:child_process";
import * as acp from "@agentclientprotocol/sdk";
import { createGeminiConnection } from "./connection.js";
import { spawnGeminiTransport } from "./transport.js";
import type {
  GeminiClientOptions,
  GeminiPromptResult,
  PermissionHandler,
  SessionUpdateHandler,
} from "./types.js";

export class GeminiClient {
  private readonly cwd: string;
  private readonly command: string;

  private process: ChildProcess | null = null;
  private connection: acp.ClientConnection | null = null;
  private sessionId: string | null = null;

  private updateHandler: SessionUpdateHandler | null = null;
  private permissionHandler: PermissionHandler | null = null;

  private assistantText = "";

  private promptQueue: Promise<void> = Promise.resolve();

  constructor(options: GeminiClientOptions) {
    this.cwd = options.cwd;
    this.command = options.command ?? "gemini";
  }

  onUpdate(handler: SessionUpdateHandler): void {
    this.updateHandler = handler;
  }

  onPermissionRequest(handler: PermissionHandler): void {
    this.permissionHandler = handler;
  }

  async start(): Promise<void> {
    if (this.process || this.connection) {
      throw new Error("Gemini client is already running");
    }

    const transport = spawnGeminiTransport(this.command, this.cwd);
    const child = transport.child;

    this.process = child;

    child.on("error", (error) => { console.error("Gemini process error:", error); });

    child.on("exit", (code, signal) => {
      console.log(`Gemini exited: code=${code}, signal=${signal}`);

      this.process = null;
      this.connection = null;
      this.sessionId = null;
    });

    const connection = createGeminiConnection(
      transport.stream,
      {
        onPermissionRequest: this.permissionHandler,
        onUpdate: this.updateHandler,
        onAssistantText: (text) => {this.assistantText += text;},
      },
    );

    this.connection = connection;

    try {
      const initialized = await connection.agent.request(
        acp.methods.agent.initialize,
        {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        },
      );

      console.log(
        `Connected to ${initialized.agentInfo?.name ?? "Gemini"} ` +
        `v${initialized.agentInfo?.version ?? "unknown"}`,
      );

      const session = await connection.agent.request(
        acp.methods.agent.session.new,
        {
          cwd: this.cwd,
          mcpServers: [],
        },
      );

      this.sessionId = session.sessionId;

      console.log(`Gemini session: ${this.sessionId}`);
    } catch (error) {
      connection.close(error);
      await connection.closed.catch(() => { });
      throw error;
    }
  }

  async prompt(text: string): Promise<GeminiPromptResult> {
    const run = this.promptQueue.then(async () => {
      const connection = this.connection;

      if (!connection) {
        throw new Error("Gemini client is not started");
      }

      if (!this.sessionId) {
        throw new Error("Gemini session has not been created");
      }

      this.assistantText = "";

      const response = await connection.agent.request(
        acp.methods.agent.session.prompt,
        {
          sessionId: this.sessionId,
          prompt: [
            {
              type: "text",
              text,
            },
          ],
        },
      );

      return { response, text: this.assistantText };
    });

    // If this prompt fails, don't permanently poison the queue.
    this.promptQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async stop(): Promise<void> {
    const connection = this.connection;
    const child = this.process;

    this.connection = null;
    this.sessionId = null;
    this.process = null;

    if (connection) {
      console.log("Closing ACP connection...");
      connection.close();
      // Wait for the ACP connection to actually close.
      await connection.closed.catch(() => { });
    }

    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    console.log("Waiting for Gemini process to exit...");

    // Closing the ACP connection should ultimately close the transport.
    // Give Gemini a moment to perform its normal shutdown.
    const exited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        resolve(false);
      }, 2000);

      child.once("exit", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });

    if (!exited && child.exitCode === null && child.signalCode === null) {

      console.log("Gemini did not exit; terminating process.");
      child.kill("SIGTERM");

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
          resolve();
        }, 2000);

        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  getSessionId(): string | null { return this.sessionId; }
  get running(): boolean { return this.process !== null; }
}