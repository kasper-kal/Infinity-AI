import { pgTable, text, timestamp, uuid, jsonb, integer, boolean, index } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

/**
 * Multi-factor authentication tables (Phase 42).
 *
 * - `mfa_totp_secrets`  — one row per account with an AES-256-GCM encrypted TOTP secret,
 *                         plus a JSONB array of hashed single-use backup codes.
 * - `mfa_passkeys`      — WebAuthn (FIDO2) credentials. `publicKey` is stored as a base64url
 *                         string of the CBOR-encoded public key (matches @simplewebauthn/server's
 *                         `WebAuthnCredential.publicKey`). `transports`/`counter` are stored for
 *                         replay-attack counter checks on every authentication.
 * - `mfa_trusted_devices` — "remember this device for 30 days" rows keyed by a fingerprint.
 * - `mfa_pending_logins` — transient token rows for the two-step login flow: after a correct
 *                         password the server issues a short-lived pending login token; the MFA
 *                         challenge (passkey / TOTP / backup code) is then verified against it.
 *                         Also holds the WebAuthn challenge issued during that pending login.
 */
export const mfaTotpSecrets = pgTable(
  "mfa_totp_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .unique()
      .references(() => accounts.id, { onDelete: "cascade" }),
    encryptedSecret: text("encrypted_secret").notNull(),
    confirmedAt: timestamp("confirmed_at"),
    backupCodes: jsonb("backup_codes").notNull().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("mfa_totp_secrets_account_idx").on(t.accountId)],
);

export const mfaPasskeys = pgTable(
  "mfa_passkeys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull().unique(),
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    transports: jsonb("transports").notNull().default([]),
    aaguid: text("aaguid"),
    name: text("name").notNull().default("Passkey"),
    deviceType: text("device_type"), // singleDevice | multiDevice
    backedUp: boolean("backed_up").notNull().default(false),
    userVerified: boolean("user_verified").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
  },
  (t) => [
    index("mfa_passkeys_account_idx").on(t.accountId),
    index("mfa_passkeys_credential_idx").on(t.credentialId),
  ],
);

export const mfaTrustedDevices = pgTable(
  "mfa_trusted_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    deviceFingerprint: text("device_fingerprint").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => [index("mfa_trusted_account_idx").on(t.accountId)],
);

export const mfaPendingLogins = pgTable(
  "mfa_pending_logins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().unique(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    challenge: text("challenge"), // WebAuthn challenge for passkey authentication step
    requestedMethods: jsonb("requested_methods").notNull().default([]), // ["passkey","totp","backup"]
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("mfa_pending_token_idx").on(t.token),
    index("mfa_pending_account_idx").on(t.accountId),
  ],
);

export type MfaTotpSecret = typeof mfaTotpSecrets.$inferSelect;
export type MfaTotpSecretInsert = typeof mfaTotpSecrets.$inferInsert;
export type MfaPasskey = typeof mfaPasskeys.$inferSelect;
export type MfaPasskeyInsert = typeof mfaPasskeys.$inferInsert;
export type MfaTrustedDevice = typeof mfaTrustedDevices.$inferSelect;
export type MfaTrustedDeviceInsert = typeof mfaTrustedDevices.$inferInsert;
export type MfaPendingLogin = typeof mfaPendingLogins.$inferSelect;
export type MfaPendingLoginInsert = typeof mfaPendingLogins.$inferInsert;