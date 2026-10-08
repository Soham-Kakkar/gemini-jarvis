import * as acp from "@agentclientprotocol/sdk";
import type {
  PermissionHandler,
  SessionUpdateHandler,
} from "./types.js";
import type { GeminiTransportStream } from "./transport.js";

export interface GeminiConnectionHandlers {
  onPermissionRequest: PermissionHandler | null;
  onUpdate: SessionUpdateHandler | null;
  onAssistantText: (text: string) => void;
}

export function createGeminiConnection(
  stream: GeminiTransportStream, handlers: GeminiConnectionHandlers,
): acp.ClientConnection {
  return acp
    .client({ name: "gemini-jarvis" })
    .onRequest(
      acp.methods.client.session.requestPermission,
      async (ctx) => {
        if (!handlers.onPermissionRequest) {
          return { outcome: { outcome: "cancelled" } };
        }
        return handlers.onPermissionRequest(ctx.params);
      },
    )
    .onNotification(
      acp.methods.client.session.update,
      async (ctx) => {
        const update = ctx.params.update;

        if (update.sessionUpdate === "agent_message_chunk" &&
            update.content.type === "text") handlers.onAssistantText(update.content.text);

        if (handlers.onUpdate) await handlers.onUpdate(update);
      },
    )
    .connect(stream);
}
