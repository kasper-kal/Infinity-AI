/**
 * Email Service — Free tier email delivery via Resend or SendGrid
 *
 * Supports multiple providers with automatic failover.
 * Budget: $0 — Resend free tier (3,000 emails/month), SendGrid free tier (100/day).
 */

import { Resend } from "resend";
import sgMail from "@sendgrid/mail";

export type EmailProvider = "resend" | "sendgrid" | "console";

export interface EmailConfig {
  provider: EmailProvider;
  resendApiKey?: string;
  sendgridApiKey?: string;
  fromEmail: string;
  fromName: string;
  replyTo?: string;
}

export interface EmailPayload {
  to: string | string[];
  from?: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  tags?: Record<string, string>;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider: EmailProvider;
}

export class EmailService {
  private config: EmailConfig | null = null;
  private resend: Resend | null = null;
  private initialized = false;
  private providerOrder: EmailProvider[] = ["resend", "sendgrid", "console"];

  async initialize(projectId: string, config?: Partial<EmailConfig>): Promise<void> {
    if (this.initialized && !config) return;

    // Load config from environment or provided config
    this.config = {
      provider: (config?.provider || process.env.EMAIL_PROVIDER || "console") as EmailProvider,
      resendApiKey: config?.resendApiKey || process.env.RESEND_API_KEY,
      sendgridApiKey: config?.sendgridApiKey || process.env.SENDGRID_API_KEY,
      fromEmail: config?.fromEmail || process.env.FROM_EMAIL || "safety@infinity.local",
      fromName: config?.fromName || "Infinity Safety Watcher",
      replyTo: config?.replyTo || process.env.REPLY_TO_EMAIL,
    };

    // Initialize providers
    if (this.config.resendApiKey) {
      this.resend = new Resend(this.config.resendApiKey);
    }

    if (this.config.sendgridApiKey) {
      sgMail.setApiKey(this.config.sendgridApiKey);
    }

    this.initialized = true;
  }

  async send(payload: EmailPayload): Promise<EmailResult> {
    if (!this.initialized) {
      await this.initialize("");
    }

    // Try providers in order until one succeeds
    for (const provider of this.providerOrder) {
      if (provider === "resend" && this.config?.resendApiKey) {
        const result = await this.sendViaResend(payload);
        if (result.success) return result;
      } else if (provider === "sendgrid" && this.config?.sendgridApiKey) {
        const result = await this.sendViaSendGrid(payload);
        if (result.success) return result;
      } else if (provider === "console") {
        return this.sendViaConsole(payload);
      }
    }

    return {
      success: false,
      error: "All email providers failed",
      provider: "none",
    };
  }

  private async sendViaResend(payload: EmailPayload): Promise<EmailResult> {
    if (!this.resend || !this.config) {
      return { success: false, error: "Resend not configured", provider: "resend" };
    }

    try {
      const result = await this.resend.emails.send({
        from: `${this.config.fromName} <${this.config.fromEmail}>`,
        to: Array.isArray(payload.to) ? payload.to : [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        replyTo: payload.replyTo || this.config.replyTo,
        headers: payload.headers,
        tags: payload.tags ? Object.entries(payload.tags).map(([k, v]) => ({ name: k, value: v })) : undefined,
      });

      if (result.error) {
        return { success: false, error: result.error.message, provider: "resend" };
      }

      return { success: true, messageId: result.data?.id, provider: "resend" };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Resend error", provider: "resend" };
    }
  }

  private async sendViaSendGrid(payload: EmailPayload): Promise<EmailResult> {
    if (!this.config?.sendgridApiKey) {
      return { success: false, error: "SendGrid not configured", provider: "sendgrid" };
    }

    try {
      await sgMail.send({
        from: { email: this.config.fromEmail, name: this.config.fromName },
        to: Array.isArray(payload.to) ? payload.to : [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        replyTo: payload.replyTo || this.config.replyTo,
        customArgs: payload.tags,
      });

      return { success: true, messageId: `sg-${Date.now()}`, provider: "sendgrid" };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "SendGrid error", provider: "sendgrid" };
    }
  }

  private async sendViaConsole(payload: EmailPayload): Promise<EmailResult> {
    // Development fallback - log to console
    console.log("📧 [EMAIL] Would send:");
    console.log(`  To: ${Array.isArray(payload.to) ? payload.to.join(", ") : payload.to}`);
    console.log(`  Subject: ${payload.subject}`);
    console.log(`  From: ${this.config?.fromName} <${this.config?.fromEmail}>`);
    console.log(`  HTML: ${payload.html.substring(0, 200)}...`);
    console.log(`  Text: ${payload.text?.substring(0, 200) || "(no text version)"}...`);

    return { success: true, messageId: `console-${Date.now()}`, provider: "console" };
  }

  async sendBatch(payloads: EmailPayload[]): Promise<EmailResult[]> {
    const results: EmailResult[] = [];
    for (const payload of payloads) {
      results.push(await this.send(payload));
    }
    return results;
  }

  setProviderOrder(order: EmailProvider[]): void {
    this.providerOrder = order;
  }

  getConfig(): EmailConfig | null {
    return this.config ? { ...this.config, resendApiKey: "***", sendgridApiKey: "***" } : null;
  }

  destroy(): void {
    this.resend = null;
    this.config = null;
    this.initialized = false;
  }
}

let emailServiceInstance: EmailService | null = null;

export function getEmailService(): EmailService {
  if (!emailServiceInstance) {
    emailServiceInstance = new EmailService();
  }
  return emailServiceInstance;
}

export function resetEmailService(): void {
  if (emailServiceInstance) {
    emailServiceInstance.destroy();
    emailServiceInstance = null;
  }
}