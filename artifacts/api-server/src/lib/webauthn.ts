/**
 * PHASE 42: Passkeys (WebAuthn / FIDO2)
 *
 * Registration + authentication ceremonies via @simplewebauthn/server (free).
 * Registration challenges are cached in-memory per account (the account is
 * already authenticated when registering). Authentication challenges for the
 * login flow are persisted inside the pending-login row (the account is NOT yet
 * authenticated at that point), so they survive across the two-step exchange.
 */

import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import type { WebAuthnCredential } from "@simplewebauthn/server";
import type { MfaPasskey } from "@workspace/db/schema/auth-mfa.js";

export type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
};

export interface RegistrablePasskey {
  credentialId: string;
  transports?: string[];
}

export interface RegistrationInfo {
  credentialId: string;
  publicKeyBase64Url: string;
  counter: number;
  aaguid: string;
  transports: string[];
  deviceType: string;
  backedUp: boolean;
  userVerified: boolean;
}

export interface AuthenticationInfo {
  credentialId: string;
  newCounter: number;
}

export const TOTP_ISSUER = "Infinity AI";

interface RelyingParty {
  rpID: string;
  rpName: string;
  origin: string | string[];
}

/**
 * Resolve the relying-party config.
 *
 * Precedence: `origin`/`rpID` sent by the frontend (so the deployed frontend
 * URL always wins over whatever host the API is running on) → env vars →
 * localhost dev defaults.
 */
export function getRpConfig(reqOrigin?: string | string[], reqRpID?: string): RelyingParty {
  const frontendUrl = process.env.FRONTEND_URL;
  let origin: string | string[] = reqOrigin || frontendUrl || "http://localhost:5173";
  if (typeof origin === "string") {
    try {
      // Just verify it's parseable so we don't ship garbage into expectedOrigin
      new URL(origin);
    } catch {
      origin = "http://localhost:5173";
    }
  }
  let rpID = reqRpID || process.env.WEBAUTHN_RP_ID;
  if (!rpID && frontendUrl) {
    try {
      rpID = new URL(frontendUrl).hostname;
    } catch {
      rpID = "localhost";
    }
  }
  rpID = rpID || "localhost";
  return { rpID, rpName: TOTP_ISSUER, origin };
}

// In-memory registration challenge cache. Registration is only reachable while
// authenticated, so keying by accountId is safe; a short TTL bounds memory.
const registrationChallenges = new Map<
  string,
  { challenge: string; userId: string; rpID: string; origin: string | string[]; expiresAt: number }
>();

function getRegistrationChallenge(accountId: string) {
  const entry = registrationChallenges.get(accountId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    registrationChallenges.delete(accountId);
    return null;
  }
  registrationChallenges.delete(accountId); // single-use
  return entry;
}

export const webauthn = {
  /** Server-side half of the registration ceremony: build the options the browser passes to navigator.credentials.create(). */
  async startRegistration(params: {
    accountId: string;
    userId: string; // stable, unique per account
    userName: string; // email
    userDisplayName?: string;
    excludeCredentials?: RegistrablePasskey[];
    origin?: string | string[];
    rpID?: string;
  }): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const { accountId, userId, userName, userDisplayName } = params;
    const rp = getRpConfig(params.origin, params.rpID);

    const options = await generateRegistrationOptions({
      rpName: rp.rpName,
      rpID: rp.rpID,
      userName,
      userID: Buffer.from(userId, "utf8"),
      userDisplayName: userDisplayName || userName,
      excludeCredentials: (params.excludeCredentials || []).map((c) => ({
        id: c.credentialId,
        transports: c.transports as string[],
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
      attestationType: "none",
      timeout: 120000,
    });

    registrationChallenges.set(accountId, {
      challenge: options.challenge,
      userId,
      rpID: rp.rpID,
      origin: rp.origin,
      expiresAt: Date.now() + 120000,
    });

    return options;
  },

  /** Complete the registration ceremony: verify attestation, return what to persist. */
  async finishRegistration(
    accountId: string,
    response: RegistrationResponseJSON,
  ): Promise<{ verified: boolean; registrationInfo: RegistrationInfo }> {
    const entry = getRegistrationChallenge(accountId);
    if (!entry) {
      return { verified: false, registrationInfo: null as unknown as RegistrationInfo };
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: entry.challenge,
        expectedOrigin: entry.origin,
        expectedRPID: entry.rpID,
        requireUserPresence: true,
        requireUserVerification: false, // widest authenticator compatibility; "preferred" at the ceremony
      });
    } catch (err) {
      return { verified: false, registrationInfo: null as unknown as RegistrationInfo };
    }

    if (!verification.verified || !verification.registrationInfo) {
      return { verified: false, registrationInfo: null as unknown as RegistrationInfo };
    }

    const info = verification.registrationInfo;
    return {
      verified: true,
      registrationInfo: {
        credentialId: info.credentialID,
        publicKeyBase64Url: Buffer.from(info.credentialPublicKey).toString("base64url"),
        counter: info.counter,
        aaguid: info.aaguid,
        transports: (info.transports || []) as string[],
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        userVerified: info.userVerified,
      },
    };
  },

  /** Server-side half of the login ceremony: options for navigator.credentials.get(). */
  async startAuthentication(params: {
    challenge?: string;
    rpID?: string;
    origin?: string | string[];
    allowCredentials?: RegistrablePasskey[];
  }): Promise<{ options: PublicKeyCredentialRequestOptionsJSON; challenge: string }> {
    const rp = getRpConfig(params.origin, params.rpID);
    const options = await generateAuthenticationOptions({
      rpID: rp.rpID,
      allowCredentials: (params.allowCredentials || []).map((c) => ({
        id: c.credentialId,
        transports: c.transports as string[],
      })),
      userVerification: "preferred",
      timeout: 120000,
      challenge: params.challenge ? Buffer.from(params.challenge, "base64url") : undefined,
    });
    return { options, challenge: options.challenge };
  },

  /** Verify an authentication assertion against a persisted credential. */
  async verifyAuthentication(params: {
    response: AuthenticationResponseJSON;
    expectedChallenge: string;
    rpID?: string;
    origin?: string | string[];
    credential: Pick<MfaPasskey, "credentialId" | "publicKey" | "counter" | "transports">;
    requireUserVerification?: boolean;
  }): Promise<{ verified: boolean; authenticationInfo: AuthenticationInfo }> {
    const rp = getRpConfig(params.origin, params.rpID);
    const webAuthnCredential: WebAuthnCredential = {
      id: params.credential.credentialId,
      publicKey: Buffer.from(params.credential.publicKey, "base64url"),
      counter: params.credential.counter,
      transports: (params.credential.transports || []) as string[],
    };

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: params.response,
        expectedChallenge: params.expectedChallenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        credential: webAuthnCredential,
        requireUserVerification: params.requireUserVerification ?? false,
      });
    } catch (err) {
      return { verified: false, authenticationInfo: null as unknown as AuthenticationInfo };
    }

    return {
      verified: verification.verified,
      authenticationInfo: verification.verified
        ? {
            credentialId: verification.authenticationInfo.credentialID,
            newCounter: verification.authenticationInfo.newCounter,
          }
        : (null as unknown as AuthenticationInfo),
    };
  },
};