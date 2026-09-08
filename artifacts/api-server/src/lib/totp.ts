/**
 * PHASE 42: TOTP (Authenticator App) support
 *
 * Encrypted TOTP secrets + QR setup + verification + single-use backup codes.
 * $0 budget: `otplib` (free) for RFC-6238 TOTP, `qrcode` (free) for the scan
 * QR, Node's built-in crypto for AES-256-GCM secret-at-rest encryption.
 */

import crypto from "node:crypto";
import { generateSecret, generateSync, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import { db } from "@workspace/db";
import { mfaTotpSecrets } from "@workspace/db/schema/auth-mfa.js";
import { eq } from "drizzle-orm";

export const TOTP_ISSUER = "Infinity AI";
const BACKUP_CODE_COUNT = 10;

// ============================================================================
// AES-256-GCM secret-at-rest encryption (account-scoped, same scheme as the
// project-scoped secrets manager but without a projectId salt)
// ============================================================================

function getMasterKey(): string {
  return process.env.SECRETS_MASTER_KEY || "infinity-secrets-default-key-change-in-production";
}

function deriveAccountKey(accountId: string): Buffer {
  return crypto.createHash("sha256").update(getMasterKey() + ":mfa:" + accountId).digest();
}

export function encryptTotpSecret(value: string, accountId: string): string {
  const key = deriveAccountKey(accountId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptTotpSecret(value: string, accountId: string): string {
  const parts = value.split(":");
  if (parts.length !== 3) return value; // plaintext fallback (nothing we store is plaintext)
  const key = deriveAccountKey(accountId);
  const iv = Buffer.from(parts[0], "base64");
  const authTag = Buffer.from(parts[1], "base64");
  const encrypted = Buffer.from(parts[2], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

// ============================================================================
// Backup codes
// ============================================================================

export interface BackupCode {
  /** sha256 hex of the raw code; the raw code is only ever shown at setup */
  codeHash: string;
  used: boolean;
  /** ISO timestamp of when it was used (for display) */
  usedAt?: string;
}

function generateRawBackupCode(): string {
  return crypto.randomBytes(6).toString("base64url").slice(0, 8).toUpperCase();
}

export function hashBackupCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/** Generate N raw codes (returned once at setup) plus their hash rows. */
export function issueBackupCodes(count = BACKUP_CODE_COUNT): { rawCodes: string[]; records: BackupCode[] } {
  const rawCodes: string[] = [];
  const records: BackupCode[] = [];
  const seen = new Set<string>();
  while (rawCodes.length < count) {
    const raw = generateRawBackupCode();
    if (seen.has(raw)) continue;
    seen.add(raw);
    rawCodes.push(raw);
    records.push({ codeHash: hashBackupCode(raw), used: false });
  }
  return { rawCodes, records };
}

/** Verify + consume a backup code against the stored (hashed) list. */
export function consumeBackupCode(records: BackupCode[], rawCode: string): BackupCode[] {
  const hash = hashBackupCode(rawCode.trim().toUpperCase());
  let consumed = false;
  const next = records.map((r) => {
    if (!consumed && !r.used && crypto.timingSafeEqual(Buffer.from(r.codeHash, "hex"), Buffer.from(hash, "hex"))) {
      consumed = true;
      return { ...r, used: true, usedAt: new Date().toISOString() };
    }
    return r;
  });
  return consumed ? next : records;
}

// ============================================================================
// TOTP primitives
// ============================================================================

export function newTotpSecret(): string {
  return generateSecret();
}

export function totpUri(secret: string, accountName: string): string {
  return generateURI({ issuer: TOTP_ISSUER, label: accountName, secret });
}

/** Current TOTP code for a secret (used by tests / manual verification helper). */
export function currentTotpCode(secret: string): string {
  return generateSync({ secret });
}

/** Validate a user-supplied 6-digit code with one time-step of tolerance each side. */
export function totpValid(secret: string, token: string): boolean {
  try {
    return verifySync({ secret, token: token.trim(), epochTolerance: 30 });
  } catch {
    return false;
  }
}

// ============================================================================
// DB-backed setup / verification
// ============================================================================

export const totpStore = {
  /** Generate a brand-new setup: secret, otpauth URL, QR data-URL and fresh backup codes. */
  async generateSetup(accountId: string, email: string) {
    const secret = newTotpSecret();
    const uri = totpUri(secret, email);
    const qrDataUrl = await QRCode.toDataURL(uri, { width: 260, margin: 1 });
    const { rawCodes, records } = issueBackupCodes();

    // Upsert: never more than one TOTP row per account; a re-setup replaces the secret.
    const existing = await db.select({ id: mfaTotpSecrets.id }).from(mfaTotpSecrets).where(eq(mfaTotpSecrets.accountId, accountId)).limit(1);
    if (existing.length > 0) {
      await db
        .update(mfaTotpSecrets)
        .set({
          encryptedSecret: encryptTotpSecret(secret, accountId),
          confirmedAt: null,
          backupCodes: records as unknown as Record<string, unknown>[],
          updatedAt: new Date(),
        })
        .where(eq(mfaTotpSecrets.id, existing[0].id));
    } else {
      await db.insert(mfaTotpSecrets).values({
        accountId,
        encryptedSecret: encryptTotpSecret(secret, accountId),
        backupCodes: records as unknown as Record<string, unknown>[],
      });
    }

    return { secret, otpauthUrl: uri, qrCodeDataUrl: qrDataUrl, backupCodes: rawCodes };
  },

  async getRow(accountId: string) {
    const [row] = await db.select().from(mfaTotpSecrets).where(eq(mfaTotpSecrets.accountId, accountId)).limit(1);
    return row ?? null;
  },

  async getStatus(accountId: string) {
    const row = await totpStore.getRow(accountId);
    return {
      enabled: !!row?.confirmedAt,
      configured: !!row,
      confirmedAt: row?.confirmedAt ?? null,
      hasBackupCodes: Array.isArray(row?.backupCodes) && (row.backupCodes as unknown as BackupCode[]).length > 0,
    };
  },

  /**
   * Verify the first TOTP code to confirm the user scanned the QR.
   * On success the row is marked confirmed and becomes active.
   */
  async verifyAndConfirm(accountId: string, token: string) {
    const row = await totpStore.getRow(accountId);
    if (!row) return { success: false, error: "not_configured" as const };
    const secret = decryptTotpSecret(row.encryptedSecret, accountId);
    if (!totpValid(secret, token)) return { success: false, error: "invalid_code" as const };
    await db.update(mfaTotpSecrets).set({ confirmedAt: new Date(), updatedAt: new Date() }).where(eq(mfaTotpSecrets.id, row.id));
    return { success: true as const, confirmedAt: new Date() };
  },

  /** Verify a TOTP code at login (works whether confirmed or not — used by pending-login flow). */
  async verifyCode(accountId: string, token: string) {
    const row = await totpStore.getRow(accountId);
    if (!row) return false;
    const secret = decryptTotpSecret(row.encryptedSecret, accountId);
    return totpValid(secret, token);
  },

  /** Verify + consume a backup code at login. Returns the updated records on success. */
  async verifyBackupCode(accountId: string, rawCode: string) {
    const row = await totpStore.getRow(accountId);
    if (!row) return { success: false as const };
    const records = (row.backupCodes as unknown as BackupCode[]) || [];
    if (records.length === 0) return { success: false as const };
    const updated = consumeBackupCode(records, rawCode);
    if (updated === records) return { success: false as const };
    await db.update(mfaTotpSecrets).set({ backupCodes: updated as unknown as Record<string, unknown>[], updatedAt: new Date() }).where(eq(mfaTotpSecrets.id, row.id));
    return { success: true as const };
  },

  /** Issue a fresh set of backup codes for an already-enabled TOTP account. */
  async rotateBackupCodes(accountId: string) {
    const row = await totpStore.getRow(accountId);
    if (!row) return { success: false as const, error: "not_configured" as const };
    const { rawCodes, records } = issueBackupCodes();
    await db.update(mfaTotpSecrets).set({ backupCodes: records as unknown as Record<string, unknown>[], updatedAt: new Date() }).where(eq(mfaTotpSecrets.id, row.id));
    return { success: true as const, backupCodes: rawCodes };
  },

  /** List the storage records (hashes only, never raw codes) for the settings panel. */
  async listBackupCodeStatus(accountId: string) {
    const row = await totpStore.getRow(accountId);
    return ((row?.backupCodes as unknown as BackupCode[]) || []).map((r) => ({ used: r.used, usedAt: r.usedAt ?? null }));
  },

  async disable(accountId: string) {
    await db.delete(mfaTotpSecrets).where(eq(mfaTotpSecrets.accountId, accountId));
    return true;
  },
};