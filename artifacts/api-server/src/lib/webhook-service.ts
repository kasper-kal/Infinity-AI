/**
 * Webhook Service — Generic webhook delivery with Slack/Discord special handling
 *
 * Supports: Generic webhooks (HMAC signed), Slack incoming webhooks, Discord webhooks
 * Budget: $0 — uses free incoming webhook URLs
 */

import crypto from "crypto";

export interface WebhookConfig {
  url: string;
  headers?: Record<string, string>;
  secret?: string; // HMAC secret for signature verification
  timeout?: number; // ms
  retries?: number;
  retryDelay?: number; // ms
}

export interface SlackWebhookPayload {
  channel?: string;
  username?: string;
  icon_emoji?: string;
  icon_url?: string;
  text?: string;
  blocks?: any[];
  attachments?: any[];
  thread_ts?: string;
  reply_broadcast?: boolean;
}

export interface DiscordWebhookPayload {
  username?: string;
  avatar_url?: string;
  content?: string;
  embeds?: DiscordEmbed[];
  allowed_mentions?: any;
  components?: any[];
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: { text: string; icon_url?: string };
  image?: { url: string };
  thumbnail?: { url: string };
  author?: { name: string; url?: string; icon_url?: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

export interface WebhookResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  response?: string;
}

export class WebhookService {
  private defaultConfig: Required<WebhookConfig> = {
    url: "",
    headers: { "Content-Type": "application/json" },
    secret: "",
    timeout: 10000,
    retries: 3,
    retryDelay: 1000,
  };

  async send(
    config: WebhookConfig,
    payload: any,
    extraHeaders?: Record<string, string>,
    secret?: string
  ): Promise<WebhookResult> {
    const finalConfig = { ...this.defaultConfig, ...config };
    const finalSecret = secret || finalConfig.secret;
    const headers = { ...finalConfig.headers, ...extraHeaders };

    // Add signature if secret provided
    let body = JSON.stringify(payload);
    if (finalSecret) {
      const signature = crypto
        .createHmac("sha256", finalSecret)
        .update(body)
        .digest("hex");
      headers["X-Signature"] = `sha256=${signature}`;
      headers["X-Timestamp"] = Date.now().toString();
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= finalConfig.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), finalConfig.timeout);

        const response = await fetch(finalConfig.url, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const responseText = await response.text();

        if (response.ok) {
          return { success: true, statusCode: response.status, response: responseText };
        }

        lastError = new Error(`HTTP ${response.status}: ${responseText}`);

        // Don't retry on client errors (4xx)
        if (response.status >= 400 && response.status < 500) {
          break;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on abort (timeout)
        if (lastError.name === "AbortError") {
          break;
        }
      }

      // Wait before retry
      if (attempt < finalConfig.retries) {
        await new Promise((resolve) => setTimeout(resolve, finalConfig.retryDelay * (attempt + 1)));
      }
    }

    return {
      success: false,
      error: lastError?.message || "Unknown error",
    };
  }

  async sendSlack(webhookUrl: string, payload: SlackWebhookPayload): Promise<WebhookResult> {
    return this.send(
      { url: webhookUrl, headers: { "Content-Type": "application/json" } },
      payload
    );
  }

  async sendDiscord(webhookUrl: string, payload: DiscordWebhookPayload): Promise<WebhookResult> {
    return this.send(
      { url: webhookUrl, headers: { "Content-Type": "application/json" } },
      payload
    );
  }

  async sendBatch(
    webhooks: Array<{ config: WebhookConfig; payload: any }>
  ): Promise<WebhookResult[]> {
    const results = await Promise.all(
      webhooks.map(({ config, payload }) => this.send(config, payload))
    );
    return results;
  }

  // Verify incoming webhook signature (for receiving webhooks)
  static verifySignature(
    payload: string | Buffer,
    signature: string,
    secret: string
  ): boolean {
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    const providedSignature = signature.replace("sha256=", "");

    // Timing-safe comparison
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(providedSignature)
    );
  }

  // Generate a test payload for webhook verification
  static generateTestPayload(source: string = "safety-watcher"): any {
    return {
      test: true,
      source,
      timestamp: new Date().toISOString(),
      message: "This is a test webhook from Infinity Safety Watcher",
    };
  }
}

let webhookServiceInstance: WebhookService | null = null;

export function getWebhookService(): WebhookService {
  if (!webhookServiceInstance) {
    webhookServiceInstance = new WebhookService();
  }
  return webhookServiceInstance;
}

export function resetWebhookService(): void {
  webhookServiceInstance = null;
}