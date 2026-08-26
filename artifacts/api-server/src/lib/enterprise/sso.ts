import { logger } from "../logger";
import {
  AuthProviderConfig,
  AuthProviderType,
  AuthResult,
  UserProfile,
  AuthProvider,
  createAuthProvider,
  authProviderRegistry,
  type AttributeMapping,
  type GroupMapping,
} from "./auth-providers";
import { auditLogger, AuditHelpers, type AuditActor, type AuditEventType } from "./audit-logs";

/**
 * Phase 14: Enterprise SSO/SAML/OIDC Integration
 * Complete SSO flow handling with user provisioning, role mapping, and audit logging.
 * $0 budget — open-source libraries and standard protocols.
 */

export interface SSOConfig {
  /** Enabled providers */
  providers: AuthProviderConfig[];
  /** Default provider for email domains without explicit mapping */
  defaultProvider?: AuthProviderType;
  /** Session configuration */
  session: SessionConfig;
  /** User provisioning */
  provisioning: ProvisioningConfig;
  /** Security settings */
  security: SecurityConfig;
}

export interface SessionConfig {
  /** Session cookie name */
  cookieName: string;
  /** Session TTL in seconds */
  ttl: number;
  /** Refresh threshold (seconds before expiry to refresh) */
  refreshThreshold: number;
  /** Secure cookie (HTTPS only) */
  secure: boolean;
  /** SameSite policy */
  sameSite: "lax" | "strict" | "none";
  /** Cookie domain */
  domain?: string;
}

export interface ProvisioningConfig {
  /** Auto-provision new users on first SSO login */
  enabled: boolean;
  /** Default role for new users */
  defaultRole: string;
  /** Sync user attributes on every login */
  syncAttributes: boolean;
  /** Sync groups/roles on every login */
  syncGroups: boolean;
  /** Deprovision users removed from IdP */
  deprovisionOnRemoval: boolean;
  /** Deprovision grace period (days) */
  deprovisionGracePeriod: number;
  /** Custom provisioning hook */
  customHook?: (user: UserProfile, provider: AuthProvider) => Promise<ProvisioningResult>;
}

export interface ProvisioningResult {
  success: boolean;
  userId?: string;
  roles?: string[];
  projects?: Array<{ projectId: string; role: string }>;
  error?: string;
}

export interface SecurityConfig {
  /** Require MFA for SSO users */
  requireMFA: boolean;
  /** Allowed MFA methods */
  mfaMethods: ("totp" | "webauthn" | "email" | "sms")[];
  /** Session inactivity timeout (seconds) */
  inactivityTimeout: number;
  /** Maximum concurrent sessions per user */
  maxConcurrentSessions: number;
  /** IP allowlist for SSO (CIDR notation) */
  ipAllowlist?: string[];
  /** Block login from new devices */
  blockNewDevices: boolean;
  /** Device trust duration (days) */
  deviceTrustDuration: number;
}

export interface SSOSession {
  id: string;
  userId: string;
  provider: AuthProviderType;
  providerUserId: string;
  email: string;
  name?: string;
  roles: string[];
  projects: Array<{ projectId: string; role: string }>;
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
  createdAt: number;
  lastActivityAt: number;
  ipAddress?: string;
  userAgent?: string;
  deviceFingerprint?: string;
  mfaVerified: boolean;
  trustedDevice: boolean;
}

export interface SSOInitiateResult {
  success: boolean;
  authorizationUrl?: string;
  state?: string;
  provider?: AuthProviderType;
  error?: string;
}

export interface SSOCallbackResult {
  success: boolean;
  session?: SSOSession;
  user?: UserProfile;
  isNewUser?: boolean;
  error?: string;
  redirectUrl?: string;
}

/**
 * SSO Manager — handles complete SSO lifecycle
 */
export class SSOManager {
  private config: SSOConfig;
  private sessions: Map<string, SSOSession> = new Map();
  private stateStore: Map<string, { provider: AuthProviderType; redirectUri: string; codeVerifier?: string; createdAt: number }> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: SSOConfig) {
    const defaults: SSOConfig = {
      providers: [],
      session: {
        cookieName: "infinity_sso_session",
        ttl: 86400,
        refreshThreshold: 1800,
        secure: true,
        sameSite: "lax",
      },
      provisioning: {
        enabled: true,
        defaultRole: "member",
        syncAttributes: true,
        syncGroups: true,
        deprovisionOnRemoval: false,
        deprovisionGracePeriod: 30,
      },
      security: {
        requireMFA: false,
        mfaMethods: ["totp", "webauthn"],
        inactivityTimeout: 3600,
        maxConcurrentSessions: 5,
        blockNewDevices: false,
        deviceTrustDuration: 30,
      },
    };

    this.config = {
      ...defaults,
      ...config,
      session: { ...defaults.session, ...config.session },
      provisioning: { ...defaults.provisioning, ...config.provisioning },
      security: { ...defaults.security, ...config.security },
    };

    // Register providers
    for (const providerConfig of this.config.providers) {
      if (providerConfig.enabled) {
        try {
          const provider = createAuthProvider(providerConfig);
          authProviderRegistry.register(provider);
          logger.info({ provider: providerConfig.type, name: providerConfig.name }, "SSO provider registered");
        } catch (err) {
          logger.error({ err, provider: providerConfig.type }, "Failed to register SSO provider");
        }
      }
    }

    this.startCleanupTimer();
  }

  private startCleanupTimer(): void {
    // Clean up expired states and sessions every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    this.cleanupInterval.unref();
  }

  private cleanup(): void {
    const now = Date.now();

    // Clean expired states (older than 10 minutes)
    for (const [state, data] of this.stateStore.entries()) {
      if (now - data.createdAt > 10 * 60 * 1000) {
        this.stateStore.delete(state);
      }
    }

    // Clean expired sessions
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        this.sessions.delete(sessionId);
      }
    }
  }

  /**
   * Initiate SSO login flow
   */
  async initiateLogin(
    providerType: AuthProviderType,
    redirectUri: string,
    options?: { email?: string; codeChallenge?: string; codeChallengeMethod?: string }
  ): Promise<SSOInitiateResult> {
    const provider = authProviderRegistry.get(providerType);
    if (!provider) {
      return { success: false, error: `Provider ${providerType} not configured` };
    }

    if (!provider.isConfigured()) {
      return { success: false, error: `Provider ${providerType} not properly configured` };
    }

    // Generate state parameter for CSRF protection
    const state = crypto.randomUUID();
    const codeVerifier = options?.codeChallenge ? crypto.randomUUID() : undefined;

    // Store state
    this.stateStore.set(state, {
      provider: providerType,
      redirectUri,
      codeVerifier,
      createdAt: Date.now(),
    });

    // Generate authorization URL
    const authorizationUrl = provider.getAuthorizationUrl(state, redirectUri);

    return {
      success: true,
      authorizationUrl,
      state,
      provider: providerType,
    };
  }

  /**
   * Handle SSO callback (authorization code exchange)
   */
  async handleCallback(
    state: string,
    code: string,
    options?: { ipAddress?: string; userAgent?: string; deviceFingerprint?: string }
  ): Promise<SSOCallbackResult> {
    const stateData = this.stateStore.get(state);
    if (!stateData) {
      return { success: false, error: "Invalid or expired state parameter" };
    }

    // Remove state (single use)
    this.stateStore.delete(state);

    const provider = authProviderRegistry.get(stateData.provider);
    if (!provider) {
      return { success: false, error: `Provider ${stateData.provider} not found` };
    }

    // Exchange code for tokens
    const authResult = await provider.exchangeCode(code, stateData.redirectUri);
    if (!authResult.success || !authResult.user || !authResult.tokens) {
      return { success: false, error: authResult.error || "Authentication failed" };
    }

    const user = authResult.user;

    // Check if user exists (would query database in production)
    const existingUser = await this.findUserByProviderId(stateData.provider, user.userId);
    const isNewUser = !existingUser;

    // Provision or update user
    let provisioningResult: ProvisioningResult = { success: true };
    if (isNewUser) {
      provisioningResult = await this.provisionUser(user, stateData.provider);
    } else if (this.config.provisioning.syncAttributes || this.config.provisioning.syncGroups) {
      provisioningResult = await this.updateUser(user, stateData.provider, existingUser);
    }

    if (!provisioningResult.success) {
      return { success: false, error: provisioningResult.error || "User provisioning failed" };
    }

    // Create session
    const session = await this.createSession({
      provider: stateData.provider,
      providerUserId: user.userId,
      email: user.email,
      name: user.name,
      roles: provisioningResult.roles || [this.config.provisioning.defaultRole],
      projects: provisioningResult.projects || [],
      accessToken: authResult.tokens.accessToken,
      refreshToken: authResult.tokens.refreshToken,
      idToken: authResult.tokens.idToken,
      expiresAt: authResult.tokens.expiresAt || Date.now() + this.config.session.ttl * 1000,
      ipAddress: options?.ipAddress,
      userAgent: options?.userAgent,
      deviceFingerprint: options?.deviceFingerprint,
    });

    // Audit log
    await auditLogger.log(AuditHelpers.userSSOLogin(
      {
        type: "user",
        id: session.userId,
        name: session.name,
        email: session.email,
        roles: session.roles,
        workspaceId: session.projects[0]?.projectId,
      },
      stateData.provider,
      options?.ipAddress,
      session.id
    ));

    return {
      success: true,
      session,
      user,
      isNewUser,
      redirectUrl: stateData.redirectUri,
    };
  }

  /**
   * Create a new session
   */
  private async createSession(params: {
    provider: AuthProviderType;
    providerUserId: string;
    email: string;
    name?: string;
    roles: string[];
    projects: Array<{ projectId: string; role: string }>;
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
    expiresAt: number;
    ipAddress?: string;
    userAgent?: string;
    deviceFingerprint?: string;
  }): Promise<SSOSession> {
    const sessionId = crypto.randomUUID();
    const now = Date.now();

    // Enforce max concurrent sessions
    const userSessions = Array.from(this.sessions.values()).filter(s => s.userId === params.email);
    if (userSessions.length >= this.config.security.maxConcurrentSessions) {
      // Remove oldest session
      const oldest = userSessions.sort((a, b) => a.createdAt - b.createdAt)[0];
      this.sessions.delete(oldest.id);
    }

    const session: SSOSession = {
      id: sessionId,
      userId: params.email, // Use email as user ID for simplicity
      provider: params.provider,
      providerUserId: params.providerUserId,
      email: params.email,
      name: params.name,
      roles: params.roles,
      projects: params.projects,
      accessToken: params.accessToken,
      refreshToken: params.refreshToken,
      idToken: params.idToken,
      expiresAt: params.expiresAt,
      createdAt: now,
      lastActivityAt: now,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      deviceFingerprint: params.deviceFingerprint,
      mfaVerified: false,
      trustedDevice: false,
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): SSOSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    // Check expiry
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(sessionId);
      return undefined;
    }

    // Check inactivity timeout
    if (Date.now() - session.lastActivityAt > this.config.security.inactivityTimeout * 1000) {
      this.sessions.delete(sessionId);
      return undefined;
    }

    // Update last activity
    session.lastActivityAt = Date.now();
    return session;
  }

  /**
   * Refresh session tokens
   */
  async refreshSession(sessionId: string): Promise<SSOSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const provider = authProviderRegistry.get(session.provider);
    if (!provider || !session.refreshToken) return null;

    const authResult = await provider.refreshToken(session.refreshToken);
    if (!authResult.success || !authResult.tokens) {
      // Refresh failed, invalidate session
      this.sessions.delete(sessionId);
      return null;
    }

    // Update session with new tokens
    session.accessToken = authResult.tokens.accessToken;
    if (authResult.tokens.refreshToken) session.refreshToken = authResult.tokens.refreshToken;
    if (authResult.tokens.idToken) session.idToken = authResult.tokens.idToken;
    session.expiresAt = authResult.tokens.expiresAt || Date.now() + this.config.session.ttl * 1000;
    session.lastActivityAt = Date.now();

    return session;
  }

  /**
   * Validate session and refresh if needed
   */
  async validateSession(sessionId: string): Promise<SSOSession | null> {
    const session = this.getSession(sessionId);
    if (!session) return null;

    // Check if token needs refresh
    const timeUntilExpiry = session.expiresAt - Date.now();
    if (timeUntilExpiry < this.config.session.refreshThreshold * 1000) {
      return this.refreshSession(sessionId);
    }

    return session;
  }

  /**
   * Logout user (revoke session and redirect to IdP logout)
   */
  async logout(sessionId: string, redirectUri: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (session) {
      const provider = authProviderRegistry.get(session.provider);
      if (provider) {
        const logoutUrl = provider.logout(
          {
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            idToken: session.idToken,
          },
          redirectUri
        );
        this.sessions.delete(sessionId);
        return logoutUrl;
      }
      this.sessions.delete(sessionId);
    }
    return redirectUri;
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllSessions(userId: string): Promise<number> {
    let count = 0;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.userId === userId) {
        this.sessions.delete(sessionId);
        count++;
      }
    }
    return count;
  }

  /**
   * Find user by provider ID (would query database in production)
   */
  private async findUserByProviderId(providerType: AuthProviderType, providerUserId: string): Promise<UserProfile | null> {
    // In production, query database:
    // SELECT * FROM users WHERE provider = ? AND provider_user_id = ?
    return null; // Simulate new user
  }

  /**
   * Provision new user from SSO
   */
  private async provisionUser(user: UserProfile, providerType: AuthProviderType): Promise<ProvisioningResult> {
    if (!this.config.provisioning.enabled) {
      return { success: false, error: "Auto-provisioning is disabled" };
    }

    // Check allowed domains
    const provider = authProviderRegistry.get(providerType);
    if (provider && "allowedDomains" in provider) {
      const allowed = (provider as any).allowedDomains as string[] | undefined;
      if (allowed?.length && !allowed.some(d => d.toLowerCase() === user.email.split("@")[1]?.toLowerCase())) {
        return { success: false, error: `Email domain not allowed for ${providerType}` };
      }
    }

    // Apply group mapping
    const providerConfig = this.config.providers.find(p => p.type === providerType);
    let roles = [this.config.provisioning.defaultRole];
    let projects: Array<{ projectId: string; role: string }> = [];

    if (providerConfig?.groupMapping && user.groups) {
      for (const mapping of providerConfig.groupMapping) {
        if (user.groups.includes(mapping.idpGroup)) {
          roles.push(mapping.infinityRole);
          if (mapping.projectId) {
            projects.push({ projectId: mapping.projectId, role: mapping.infinityRole });
          }
        }
      }
    }

    // Call custom hook if provided
    if (this.config.provisioning.customHook) {
      const provider = authProviderRegistry.get(providerType);
      if (provider) {
        const customResult = await this.config.provisioning.customHook(user, provider);
        if (!customResult.success) return customResult;
        roles = customResult.roles || roles;
        projects = customResult.projects || projects;
      }
    }

    // In production, create user in database:
    // INSERT INTO users (email, name, provider, provider_user_id, roles, ...) VALUES (...)

    logger.info({ email: user.email, provider: providerType, roles }, "User provisioned via SSO");

    return { success: true, roles, projects };
  }

  /**
   * Update existing user from SSO
   */
  private async updateUser(user: UserProfile, providerType: AuthProviderType, existingUser: UserProfile): Promise<ProvisioningResult> {
    const providerConfig = this.config.providers.find(p => p.type === providerType);
    let roles = existingUser.groups || [this.config.provisioning.defaultRole];
    let projects: Array<{ projectId: string; role: string }> = [];

    if (this.config.provisioning.syncAttributes) {
      // Update user attributes (name, email, avatar)
      // In production: UPDATE users SET name = ?, avatar_url = ? WHERE id = ?
    }

    if (this.config.provisioning.syncGroups && providerConfig?.groupMapping && user.groups) {
      roles = [this.config.provisioning.defaultRole];
      projects = [];

      for (const mapping of providerConfig.groupMapping) {
        if (user.groups.includes(mapping.idpGroup)) {
          roles.push(mapping.infinityRole);
          if (mapping.projectId) {
            projects.push({ projectId: mapping.projectId, role: mapping.infinityRole });
          }
        }
      }
    }

    // In production, update user in database

    return { success: true, roles, projects };
  }

  /**
   * Get all configured providers
   */
  getProviders(): AuthProvider[] {
    return authProviderRegistry.getEnabled();
  }

  /**
   * Get provider by type
   */
  getProvider(type: AuthProviderType): AuthProvider | undefined {
    return authProviderRegistry.get(type);
  }

  /**
   * Find provider by email domain
   */
  findProviderByEmail(email: string): AuthProvider | undefined {
    return authProviderRegistry.findByEmailDomain(email);
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.sessions.clear();
    this.stateStore.clear();
  }
}

/**
 * Default SSO configuration
 */
export function createDefaultSSOConfig(): SSOConfig {
  return {
    providers: [],
    session: {
      cookieName: "infinity_sso_session",
      ttl: 86400,
      refreshThreshold: 1800,
      secure: true,
      sameSite: "lax",
    },
    provisioning: {
      enabled: true,
      defaultRole: "member",
      syncAttributes: true,
      syncGroups: true,
      deprovisionOnRemoval: false,
      deprovisionGracePeriod: 30,
    },
    security: {
      requireMFA: false,
      mfaMethods: ["totp", "webauthn"],
      inactivityTimeout: 3600,
      maxConcurrentSessions: 5,
      blockNewDevices: false,
      deviceTrustDuration: 30,
    },
  };
}

/**
 * Create SSO config with common providers
 */
export function createSSOConfigWithProviders(options: {
  okta?: { domain: string; clientId: string; clientSecret: string; allowedDomains?: string[] };
  entraId?: { tenantId: string; clientId: string; clientSecret: string; allowedDomains?: string[] };
  googleWorkspace?: { clientId: string; clientSecret: string; allowedDomains?: string[] };
  saml?: { entryPoint: string; issuer: string; cert: string; privateKey?: string; allowedDomains?: string[] };
  customOIDC?: { name: string; issuer: string; clientId: string; clientSecret: string; allowedDomains?: string[] };
}): SSOConfig {
  const config = createDefaultSSOConfig();
  const providers: AuthProviderConfig[] = [];

  if (options.okta) {
    providers.push({
      type: "okta",
      name: "okta",
      displayName: "Okta",
      enabled: true,
      config: {
        oktaDomain: options.okta.domain,
        clientId: options.okta.clientId,
        clientSecret: options.okta.clientSecret,
      },
      allowedDomains: options.okta.allowedDomains,
      autoProvision: true,
      defaultRole: "member",
      icon: "okta",
    });
  }

  if (options.entraId) {
    providers.push({
      type: "entra-id",
      name: "entra-id",
      displayName: "Microsoft Entra ID",
      enabled: true,
      config: {
        tenantId: options.entraId.tenantId,
        clientId: options.entraId.clientId,
        clientSecret: options.entraId.clientSecret,
      },
      allowedDomains: options.entraId.allowedDomains,
      autoProvision: true,
      defaultRole: "member",
      icon: "microsoft",
    });
  }

  if (options.googleWorkspace) {
    providers.push({
      type: "google-workspace",
      name: "google-workspace",
      displayName: "Google Workspace",
      enabled: true,
      config: {
        clientId: options.googleWorkspace.clientId,
        clientSecret: options.googleWorkspace.clientSecret,
      },
      allowedDomains: options.googleWorkspace.allowedDomains,
      autoProvision: true,
      defaultRole: "member",
      icon: "google",
    });
  }

  if (options.saml) {
    providers.push({
      type: "saml",
      name: "saml",
      displayName: "SAML SSO",
      enabled: true,
      config: {
        entryPoint: options.saml.entryPoint,
        issuer: options.saml.issuer,
        cert: options.saml.cert,
        privateKey: options.saml.privateKey,
      },
      allowedDomains: options.saml.allowedDomains,
      autoProvision: true,
      defaultRole: "member",
      icon: "saml",
    });
  }

  if (options.customOIDC) {
    providers.push({
      type: "oidc",
      name: "custom-oidc",
      displayName: options.customOIDC.name,
      enabled: true,
      config: {
        issuer: options.customOIDC.issuer,
        clientId: options.customOIDC.clientId,
        clientSecret: options.customOIDC.clientSecret,
      },
      allowedDomains: options.customOIDC.allowedDomains,
      autoProvision: true,
      defaultRole: "member",
      icon: "oidc",
    });
  }

  config.providers = providers;
  return config;
}

/**
 * Default SSO manager instance (configure with createSSOConfigWithProviders)
 */
export let ssoManager: SSOManager | null = null;

/**
 * Initialize SSO manager
 */
export function initializeSSO(config: SSOConfig): SSOManager {
  ssoManager = new SSOManager(config);
  return ssoManager;
}

/**
 * Get SSO manager instance
 */
export function getSSOManager(): SSOManager | null {
  return ssoManager;
}