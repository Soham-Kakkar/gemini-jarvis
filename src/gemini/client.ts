import { spawn } from "node:child_process";
import * as acp from "@agentclientprotocol/sdk";

export type SessionUpdateHandler = (
  update: acp.SessionUpdate,
) => void | Promise<void>;

export type PermissionHandler = (
  request: acp.RequestPermissionRequest,
) => Promise<acp.RequestPermissionResponse>;

export interface GeminiClientOptions {
  cwd: string;
  command?: string;
}

export interface GeminiPromptResult {
  response: acp.PromptResponse;
  text: string;
}

export class GeminiClient {
  private readonly cwd: string;
  private readonly command: string;

  private process: ReturnType<typeof spawn> | null = null;
  private connection: acp.ClientConnection | null = null;
  private sessionId: string | null = null;

  private updateHandler: SessionUpdateHandler | null = null;
  private permissionHandler: PermissionHandler | null = null;

  private assistantText = "";

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

    const child = spawn(this.command, ["--acp"], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "inherit"],
    });

    this.process = child;

    child.on("error", (error) => {
      console.error("Gemini process error:", error);
    });

    child.on("exit", (code, signal) => {
      console.log(`Gemini exited: code=${code}, signal=${signal}`);

      this.process = null;
      this.connection = null;
      this.sessionId = null;
    });

    const stdin = child.stdin;
    const stdout = child.stdout;

    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        stdout.on("data", (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
        });

        stdout.on("end", () => {
          controller.close();
        });

        stdout.on("error", (error) => {
          controller.error(error);
        });
      },

      cancel() {
        stdout.destroy();
      },
    });

    const output = new WritableStream<Uint8Array>({
      write(chunk) {
        return new Promise<void>((resolve, reject) => {
          if (stdin.destroyed) {
            reject(new Error("Gemini stdin is closed"));
            return;
          }

          stdin.write(Buffer.from(chunk), (error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
      },

      close() {
        if (!stdin.destroyed) {
          stdin.end();
        }
      },

      abort(reason) {
        stdin.destroy(
          reason instanceof Error ? reason : undefined,
        );
      },
    });

    const stream = acp.ndJsonStream(output, input);

    const client = acp
      .client({
        name: "gemini-jarvis",
      })
      .onRequest(
        acp.methods.client.session.requestPermission,
        async (ctx) => {
          if (!this.permissionHandler) {
            return {
              outcome: {
                outcome: "cancelled",
              },
            };
          }

          return this.permissionHandler(ctx.params);
        },
      )
      .onNotification(
        acp.methods.client.session.update,
        async (ctx) => {
          const update = ctx.params.update;

          if (
            update.sessionUpdate === "agent_message_chunk" &&
            update.content.type === "text"
          ) {
            this.assistantText += update.content.text;
          }

          if (this.updateHandler) {
            await this.updateHandler(update);
          }
        },
      );

    // IMPORTANT:
    // connect(), unlike connectWith(), keeps the ACP connection alive.
    const connection = client.connect(stream);

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
    const connection = this.connection;

    if (!connection) {
      throw new Error("Gemini client is not started");
    }

    if (!this.sessionId) {
      throw new Error("Gemini session has not been created");
    }

    this.assistantText = "";

    const start = performance.now();

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

    console.log(
      `ACP prompt completed in ` +
      `${((performance.now() - start) / 1000).toFixed(2)}s`,
    );

    return {
      response,
      text: this.assistantText,
    };
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

    if (!child) {
      return;
    }

    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }

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
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
          }

          resolve();
        }, 2000);

        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  get running(): boolean {
    return this.process !== null;
  }
}