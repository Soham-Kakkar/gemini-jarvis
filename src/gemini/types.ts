import type * as acp from "@agentclientprotocol/sdk";

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
