import { logger } from "../logger";

/**
 * Phase 14: Enterprise Auth Providers — SSO/SAML/OIDC abstraction.
 * Supports: Okta, Microsoft Entra ID (Azure AD), Google Workspace, Custom SAML/OIDC
 * $0 budget — uses open-source libraries and standard protocols.
 */

export type AuthProviderType = "okta" | "entra-id" | "google-workspace" | "saml" | "oidc" | "local";

export interface AuthProviderConfig {
  type: AuthProviderType;
  name: string;
  enabled: boolean;
  /** Display name for UI */
  displayName: string;
  /** Icon identifier */
  icon?: string;
  /** Provider-specific configuration */
  config: Record<string, unknown>;
  /** Auto-provision users on first login */
  autoProvision?: boolean;
  /** Default role for auto-provisioned users */
  defaultRole?: string;
  /** Allowed domains (for email-based routing) */
  allowedDomains?: string[];
  /** Attribute mapping from IdP to user profile */
  attributeMapping?: AttributeMapping;
  /** Group/role mapping from IdP groups to Infinity roles */
  groupMapping?: GroupMapping[];
}

export interface AttributeMapping {
  /** IdP attribute for user ID */
  userId: string;
  /** IdP attribute for email */
  email: string;
  /** IdP attribute for display name */
  name?: string;
  /** IdP attribute for given name */
  givenName?: string;
  /** IdP attribute for family name */
  familyName?: string;
  /** IdP attribute for groups/roles */
  groups?: string;
  /** IdP attribute for avatar URL */
  avatarUrl?: string;
}

export interface GroupMapping {
  /** IdP group identifier (name, ID, or claim value) */
  idpGroup: string;
  /** Infinity role to assign */
  infinityRole: string;
  /** Optional: project ID for project-scoped role */
  projectId?: string;
}

export interface UserProfile {
  userId: string;
  email: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  groups: string[];
  avatarUrl?: string;
  rawAttributes: Record<string, unknown>;
}

export interface AuthResult {
  success: boolean;
  user?: UserProfile;
  tokens?: {
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
    expiresAt?: number;
  };
  error?: string;
  redirectUrl?: string;
}

export interface AuthProvider {
  readonly type: AuthProviderType;
  readonly name: string;

  /** Generate authorization URL for login flow */
  getAuthorizationUrl(state: string, redirectUri: string): string;

  /** Exchange authorization code for tokens and user profile */
  exchangeCode(code: string, redirectUri: string): Promise<AuthResult>;

  /** Refresh access token using refresh token */
  refreshToken(refreshToken: string): Promise<AuthResult>;

  /** Validate ID token and return user profile */
  validateIdToken(idToken: string): Promise<UserProfile | null>;

  /** Get user info from access token */
  getUserInfo(accessToken: string): Promise<UserProfile | null>;

  /** Initiate logout (revoke tokens, redirect to IdP logout) */
  logout(tokens: AuthResult["tokens"], redirectUri: string): string;

  /** Check if provider is configured and enabled */
  isConfigured(): boolean;
}

/**
 * Base class for OIDC-based providers (Okta, Entra ID, Google Workspace, Generic OIDC)
 */
export abstract class OIDCProvider implements AuthProvider {
  abstract readonly type: AuthProviderType;
  abstract readonly name: string;

  protected clientId: string;
  protected clientSecret: string;
  protected issuer: string;
  protected scopes: string[];
  protected attributeMapping: AttributeMapping;
  protected allowedDomains?: string[];

  constructor(config: AuthProviderConfig) {
    this.clientId = config.config.clientId as string;
    this.clientSecret = config.config.clientSecret as string;
    this.issuer = config.config.issuer as string;
    this.scopes = (config.config.scopes as string[]) || ["openid", "profile", "email", "groups"];
    this.attributeMapping = config.attributeMapping || this.getDefaultAttributeMapping();
    this.allowedDomains = config.allowedDomains;
  }

  protected getDefaultAttributeMapping(): AttributeMapping {
    return {
      userId: "sub",
      email: "email",
      name: "name",
      givenName: "given_name",
      familyName: "family_name",
      groups: "groups",
      avatarUrl: "picture",
    };
  }

  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret && this.issuer);
  }

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: this.scopes.join(" "),
      state,
      access_type: "offline",
      prompt: "consent",
    });
    return `${this.issuer}/v1/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<AuthResult> {
    try {
      const tokenUrl = `${this.issuer}/v1/token`;
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      });

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      const data = await response.json() as Record<string, unknown>;

      if (!response.ok) {
        return { success: false, error: (data.error_description as string) || "Token exchange failed" };
      }

      const userProfile = await this.validateIdToken(data.id_token as string);
      if (!userProfile) {
        return { success: false, error: "Failed to validate ID token" };
      }

      // Check allowed domains
      if (this.allowedDomains?.length && !this.isEmailAllowed(userProfile.email)) {
        return { success: false, error: `Email domain not allowed. Allowed: ${this.allowedDomains.join(", ")}` };
      }

      return {
        success: true,
        user: userProfile,
        tokens: {
          accessToken: data.access_token as string,
          refreshToken: data.refresh_token as string | undefined,
          idToken: data.id_token as string,
          expiresAt: Date.now() + ((data.expires_in as number) * 1000),
        },
      };
    } catch (err) {
      logger.error({ err, provider: this.type }, "OIDC code exchange failed");
      return { success: false, error: err instanceof Error ? err.message : "Code exchange failed" };
    }
  }

  async refreshToken(refreshToken: string): Promise<AuthResult> {
    try {
      const tokenUrl = `${this.issuer}/v1/token`;
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      });

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      const data = await response.json() as Record<string, unknown>;

      if (!response.ok) {
        return { success: false, error: (data.error_description as string) || "Token refresh failed" };
      }

      const userProfile = await this.validateIdToken(data.id_token as string);

      return {
        success: true,
        user: userProfile || undefined,
        tokens: {
          accessToken: data.access_token as string,
          refreshToken: (data.refresh_token as string) || refreshToken,
          idToken: data.id_token as string,
          expiresAt: Date.now() + ((data.expires_in as number) * 1000),
        },
      };
    } catch (err) {
      logger.error({ err, provider: this.type }, "OIDC token refresh failed");
      return { success: false, error: err instanceof Error ? err.message : "Token refresh failed" };
    }
  }

  async validateIdToken(idToken: string): Promise<UserProfile | null> {
    try {
      // In production, use jose library to verify JWT signature against JWKS
      // For now, decode payload (NOT secure for production without verification)
      const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64").toString());
      return this.mapProfile(payload);
    } catch (err) {
      logger.error({ err, provider: this.type }, "ID token validation failed");
      return null;
    }
  }

  async getUserInfo(accessToken: string): Promise<UserProfile | null> {
    try {
      const userInfoUrl = `${this.issuer}/v1/userinfo`;
      const response = await fetch(userInfoUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) return null;

      const data = await response.json() as Record<string, unknown>;
      return this.mapProfile(data);
    } catch (err) {
      logger.error({ err, provider: this.type }, "UserInfo request failed");
      return null;
    }
  }

  logout(tokens: AuthResult["tokens"] | undefined, redirectUri: string): string {
    if (!tokens?.idToken) return redirectUri;

    const params = new URLSearchParams({
      id_token_hint: tokens.idToken,
      post_logout_redirect_uri: redirectUri,
    });
    return `${this.issuer}/v1/logout?${params.toString()}`;
  }

  protected mapProfile(payload: Record<string, unknown>): UserProfile {
    const getAttr = (key: string) => payload[this.attributeMapping[key as keyof AttributeMapping] || key];

    const email = getAttr("email") as string;
    const groups = (getAttr("groups") as string[]) || [];

    return {
      userId: getAttr("userId") as string,
      email,
      name: getAttr("name") as string | undefined,
      givenName: getAttr("givenName") as string | undefined,
      familyName: getAttr("familyName") as string | undefined,
      groups,
      avatarUrl: getAttr("avatarUrl") as string | undefined,
      rawAttributes: payload,
    };
  }

  protected isEmailAllowed(email: string): boolean {
    if (!this.allowedDomains?.length) return true;
    const domain = email.split("@")[1]?.toLowerCase();
    return this.allowedDomains.some(d => d.toLowerCase() === domain);
  }
}

/**
 * Okta OIDC Provider
 */
export class OktaProvider extends OIDCProvider {
  readonly type = "okta" as const;
  readonly name = "Okta";

  constructor(config: AuthProviderConfig) {
    // Okta uses org-specific issuer: https://{your-domain}.okta.com
    super({
      ...config,
      config: {
        ...config.config,
        issuer: config.config.issuer || `https://${config.config.oktaDomain}.okta.com`,
      },
    });
  }
}

/**
 * Microsoft Entra ID (Azure AD) Provider
 */
export class EntraIdProvider extends OIDCProvider {
  readonly type = "entra-id" as const;
  readonly name = "Microsoft Entra ID";

  constructor(config: AuthProviderConfig) {
    // Entra ID uses tenant-specific issuer: https://login.microsoftonline.com/{tenantId}/v2.0
    const tenantId = config.config.tenantId as string || "common";
    super({
      ...config,
      config: {
        ...config.config,
        issuer: config.config.issuer || `https://login.microsoftonline.com/${tenantId}/v2.0`,
      },
    });
    // Entra ID uses different scopes
    this.scopes = (config.config.scopes as string[]) || ["openid", "profile", "email", "User.Read", "Group.Read.All"];
  }

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: this.scopes.join(" "),
      state,
      response_mode: "query",
    });
    return `${this.issuer}/authorize?${params.toString()}`;
  }

  protected getDefaultAttributeMapping(): AttributeMapping {
    return {
      userId: "oid", // Object ID in Entra ID
      email: "preferred_username", // or "email"
      name: "name",
      givenName: "given_name",
      familyName: "family_name",
      groups: "groups", // Requires Group.Read.All scope
      avatarUrl: "picture",
    };
  }
}

/**
 * Google Workspace Provider
 */
export class GoogleWorkspaceProvider extends OIDCProvider {
  readonly type = "google-workspace" as const;
  readonly name = "Google Workspace";

  constructor(config: AuthProviderConfig) {
    super({
      ...config,
      config: {
        ...config.config,
        issuer: "https://accounts.google.com",
      },
    });
    this.scopes = (config.config.scopes as string[]) || ["openid", "profile", "email"];
  }

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: this.scopes.join(" "),
      state,
      access_type: "offline",
      prompt: "consent",
      hd: this.allowedDomains?.[0] || "", // Hosted domain restriction
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  protected getDefaultAttributeMapping(): AttributeMapping {
    return {
      userId: "sub",
      email: "email",
      name: "name",
      givenName: "given_name",
      familyName: "family_name",
      groups: "hd", // Hosted domain
      avatarUrl: "picture",
    };
  }
}

/**
 * Generic SAML 2.0 Provider
 * Uses @node-saml/passport-saml for SAML support
 */
export class SAMLProvider implements AuthProvider {
  readonly type = "saml" as const;
  readonly name: string;

  private entryPoint: string;
  private issuer: string;
  private cert: string;
  private privateKey?: string;
  private attributeMapping: AttributeMapping;
  private allowedDomains?: string[];

  constructor(config: AuthProviderConfig) {
    this.name = config.name;
    this.entryPoint = config.config.entryPoint as string; // IdP SSO URL
    this.issuer = config.config.issuer as string; // SP Entity ID
    this.cert = config.config.cert as string; // IdP public certificate
    this.privateKey = config.config.privateKey as string; // SP private key (for signed requests)
    this.attributeMapping = config.attributeMapping || this.getDefaultAttributeMapping();
    this.allowedDomains = config.allowedDomains;
  }

  private getDefaultAttributeMapping(): AttributeMapping {
    return {
      userId: "NameID",
      email: "email",
      name: "name",
      givenName: "firstName",
      familyName: "lastName",
      groups: "groups",
      avatarUrl: "avatar",
    };
  }

  isConfigured(): boolean {
    return !!(this.entryPoint && this.issuer && this.cert);
  }

  getAuthorizationUrl(state: string, redirectUri: string): string {
    // SAML doesn't use authorization URL in the same way
    // The SP initiates login by redirecting to IdP SSO URL with SAMLRequest
    // This would be handled by passport-saml middleware
    const params = new URLSearchParams({
      SAMLRequest: "generated_by_passport_saml",
      RelayState: state,
    });
    return `${this.entryPoint}?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<AuthResult> {
    // SAML uses Assertion Consumer Service (ACS) endpoint, not code exchange
    // This is handled by passport-saml strategy
    return { success: false, error: "SAML uses ACS endpoint, not code exchange" };
  }

  async refreshToken(refreshToken: string): Promise<AuthResult> {
    return { success: false, error: "SAML does not support token refresh" };
  }

  async validateIdToken(idToken: string): Promise<UserProfile | null> {
    // SAML uses SAML assertions, not ID tokens
    return null;
  }

  async getUserInfo(accessToken: string): Promise<UserProfile | null> {
    // SAML doesn't use access tokens for userinfo
    return null;
  }

  logout(tokens: AuthResult["tokens"] | undefined, redirectUri: string): string {
    // SAML Single Logout (SLO) - redirect to IdP SLO endpoint
    return redirectUri; // Simplified
  }
}

/**
 * Generic OIDC Provider (for custom OIDC providers)
 */
export class GenericOIDCProvider extends OIDCProvider {
  readonly type = "oidc" as const;
  readonly name: string;

  constructor(config: AuthProviderConfig) {
    super(config);
    this.name = config.displayName || "Custom OIDC";
  }
}

/**
 * Local authentication provider (email/password)
 */
export class LocalAuthProvider implements AuthProvider {
  readonly type = "local" as const;
  readonly name = "Local";

  private config: AuthProviderConfig;

  constructor(config: AuthProviderConfig) {
    this.config = config;
  }

  isConfigured(): boolean {
    return true; // Always configured
  }

  getAuthorizationUrl(state: string, redirectUri: string): string {
    return `${redirectUri}?local_login=true&state=${state}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<AuthResult> {
    // Local auth uses email/password, not authorization code
    return { success: false, error: "Local auth uses credentials, not code exchange" };
  }

  async refreshToken(refreshToken: string): Promise<AuthResult> {
    return { success: false, error: "Not implemented" };
  }

  async validateIdToken(idToken: string): Promise<UserProfile | null> {
    return null;
  }

  async getUserInfo(accessToken: string): Promise<UserProfile | null> {
    return null;
  }

  logout(tokens: AuthResult["tokens"] | undefined, redirectUri: string): string {
    return redirectUri;
  }
}

/**
 * Auth Provider Registry — manages all configured providers
 */
export class AuthProviderRegistry {
  private providers: Map<string, AuthProvider> = new Map();
  private defaultProvider?: string;

  register(provider: AuthProvider): void {
    this.providers.set(provider.type, provider);
    if (!this.defaultProvider && provider.isConfigured()) {
      this.defaultProvider = provider.type;
    }
  }

  unregister(type: AuthProviderType): void {
    this.providers.delete(type);
    if (this.defaultProvider === type) {
      this.defaultProvider = this.providers.keys().next().value;
    }
  }

  get(type: AuthProviderType): AuthProvider | undefined {
    return this.providers.get(type);
  }

  getDefault(): AuthProvider | undefined {
    return this.defaultProvider ? this.providers.get(this.defaultProvider) : undefined;
  }

  getAll(): AuthProvider[] {
    return Array.from(this.providers.values());
  }

  getEnabled(): AuthProvider[] {
    return this.getAll().filter(p => p.isConfigured());
  }

  /** Find provider by allowed domain (for email-based routing) */
  findByEmailDomain(email: string): AuthProvider | undefined {
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain) return undefined;

    for (const provider of this.getEnabled()) {
      if ("allowedDomains" in provider) {
        const allowed = (provider as any).allowedDomains as string[] | undefined;
        if (allowed?.some(d => d.toLowerCase() === domain)) {
          return provider;
        }
      }
    }
    return undefined;
  }
}

/**
 * Factory function to create provider from config
 */
export function createAuthProvider(config: AuthProviderConfig): AuthProvider {
  switch (config.type) {
    case "okta":
      return new OktaProvider(config);
    case "entra-id":
      return new EntraIdProvider(config);
    case "google-workspace":
      return new GoogleWorkspaceProvider(config);
    case "saml":
      return new SAMLProvider(config);
    case "oidc":
      return new GenericOIDCProvider(config);
    case "local":
      return new LocalAuthProvider(config);
    default:
      throw new Error(`Unknown auth provider type: ${config.type}`);
  }
}

/**
 * Default registry instance
 */
export const authProviderRegistry = new AuthProviderRegistry();

// Register default local provider
authProviderRegistry.register(new LocalAuthProvider({
  type: "local",
  name: "local",
  displayName: "Email/Password",
  enabled: true,
  config: {},
  icon: "mail",
}));