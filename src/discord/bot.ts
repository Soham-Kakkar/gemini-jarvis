import "dotenv/config";
import {
  Client, GatewayIntentBits, Partials,
  type Message, type ButtonInteraction,
} from "discord.js";

export interface DiscordBotOptions {
  token: string;
  ownerId: string;
}

export type MessageHandler = (message: Message) => Promise<void>;

export type ButtonHandler = (interaction: ButtonInteraction) => Promise<void>;

export class DiscordBot {
  private readonly token: string;
  private readonly ownerId: string;

  private readonly client: Client;
  private messageHandler: MessageHandler | null = null;
  private buttonHandler: ButtonHandler | null = null;

  constructor(options: DiscordBotOptions) {
    this.token = options.token;
    this.ownerId = options.ownerId;

    this.client = new Client({
      intents: [GatewayIntentBits.DirectMessages],
      partials: [Partials.Channel],
    });

    this.client.once("clientReady", (client) => {
      console.log(`Discord logged in as ${client.user.tag}`);
    });

    this.client.on("messageCreate", async (message) => {
      if (message.author.bot ||
        message.author.id !== this.ownerId ||
        !message.channel.isDMBased()
      ) return;

      if (this.messageHandler) await this.messageHandler(message);
    });

    this.client.on("interactionCreate", async (interaction) => {
      if (!interaction.isButton() ||
          interaction.user.id !== this.ownerId ||
          !interaction.channel?.isDMBased()
      ) return;

      if (this.buttonHandler) await this.buttonHandler(interaction);
    });
  }

  getClient(): Client {
    return this.client;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onButton(handler: ButtonHandler): void {
    this.buttonHandler = handler;
  }

  async start(): Promise<void> {
    await this.client.login(this.token);
  }

  async stop(): Promise<void> {
    this.client.destroy();
  }
}