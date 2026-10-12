import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  type ButtonInteraction,
  type Client,
} from "discord.js";

import type { PermissionHandler } from "../gemini/types.js";

type PermissionParams = Parameters<PermissionHandler>[0];
type PermissionResponse = Awaited<ReturnType<PermissionHandler>>;

interface PendingRequest {
  resolve: (response: PermissionResponse) => void;
  messageId: string;
  options: PermissionParams["options"];
}

export class PermissionRelayer {
  private readonly client: Client;
  private readonly ownerId: string;

  private readonly pending = new Map<string, PendingRequest>();

  constructor(client: Client, ownerId: string) {
    this.client = client;
    this.ownerId = ownerId;
  }

  async request(params: PermissionParams): Promise<PermissionResponse> {
    const requestId = crypto.randomUUID();

    const user = await this.client.users.fetch(this.ownerId);

    const container = new ContainerBuilder()
      .addTextDisplayComponents((text) => text.setContent("## Permission required"))
      .addTextDisplayComponents((text) =>
        text.setContent(params.toolCall.title ?? "Gemini wants to perform an operation.")
      );

    const row = new ActionRowBuilder<ButtonBuilder>();

    for (const [index, option] of params.options.entries()) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`permission:${requestId}:${index}`)
          .setLabel(option.name)
          .setStyle(option.kind.startsWith("allow") ? 
                    ButtonStyle.Success : ButtonStyle.Danger),
      );
    }

    container.addActionRowComponents(row);

    const message = await user.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });

    return new Promise((resolve) => {
      this.pending.set(requestId, { resolve, messageId: message.id, options: params.options });
    });
  }

  async handleButton(interaction: ButtonInteraction): Promise<boolean> {
    const match = interaction.customId.match(/^permission:([^:]+):(\d+)$/);

    if (!match) return false;

    if (interaction.user.id !== this.ownerId) {
      await interaction.deferUpdate();
      return true;
    }

    const [, requestId, indexString] = match;
    const pending = this.pending.get(requestId);

    if (!pending || pending.messageId !== interaction.message.id) {
      await interaction.deferUpdate();
      return true;
    }

    const option = pending.options[Number(indexString)];

    if (!option) {
      await interaction.deferUpdate();
      return true;
    }

    this.pending.delete(requestId);

    await interaction.deferUpdate();
    await interaction.message.delete().catch(() => {});

    pending.resolve({ outcome: { outcome: "selected", optionId: option.optionId } });

    return true;
  }
}