import { spawn } from "node:child_process";
import * as acp from "@agentclientprotocol/sdk";

export type GeminiTransportStream = ReturnType<typeof acp.ndJsonStream>;

export interface GeminiTransport {
  child: ReturnType<typeof spawn>;
  stream: GeminiTransportStream;
}

export function spawnGeminiTransport(command: string, cwd: string,): GeminiTransport {
  const child = spawn(command, [
    "--acp",
    "--include-directories", process.env.INCLUDE_DIRECTORIES || "."
  ], {
    cwd,
    stdio: ["pipe", "pipe", "inherit"],
  });

  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      child.stdout.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });

      child.stdout.on("end", () => {
        controller.close();
      });

      child.stdout.on("error", (error) => {
        controller.error(error);
      });
    },

    cancel() {
      child.stdout.destroy();
    },
  });

  const output = new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        if (child.stdin.destroyed) {
          reject(new Error("Gemini stdin is closed"));
          return;
        }

        child.stdin.write(Buffer.from(chunk), (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },

    close() {
      if (!child.stdin.destroyed) child.stdin.end();
    },

    abort(reason) {
      child.stdin.destroy(reason instanceof Error ? reason : undefined);
    },
  });

  return { child, stream: acp.ndJsonStream(output, input) };
}
