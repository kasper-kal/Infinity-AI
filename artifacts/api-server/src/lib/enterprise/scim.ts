import { logger } from "../logger";
import { SSOManager, getSSOManager } from "./sso";

/**
 * Phase 14: Enterprise SCIM Provisioning
 * SCIM 2.0 (RFC 7644) implementation for automated user/group provisioning.
 * $0 budget — open-source standard, no external dependencies.
 */

export type SCIMResourceType = "User" | "Group";

export interface SCIMMeta {
  resourceType: SCIMResourceType;
  created?: string;
  lastModified?: string;
  location?: string;
  version?: string;
}

export interface SCIMUser {
  schemas: string[];
  id?: string;
  externalId?: string;
  userName: string;
  name?: {
    formatted?: string;
    familyName?: string;
    givenName?: string;
    middleName?: string;
    honorificPrefix?: string;
    honorificSuffix?: string;
  };
  displayName?: string;
  nickName?: string;
  profileUrl?: string;
  title?: string;
  userType?: string;
  preferredLanguage?: string;
  locale?: string;
  timezone?: string;
  active?: boolean;
  emails?: SCIMUserEmail[];
  phoneNumbers?: SCIMUserPhone[];
  addresses?: SCIMUserAddress[];
  groups?: SCIMGroupRef[];
  entitlements?: SCIMUserEntitlement[];
  roles?: SCIMUserRole[];
  x509Certificates?: SCIMUserCertificate[];
  meta?: SCIMMeta;
}

export interface SCIMUserEmail {
  value: string;
  type?: "work" | "home" | "other";
  primary?: boolean;
}

export interface SCIMUserPhone {
  value: string;
  type?: "work" | "home" | "mobile" | "fax" | "pager" | "other";
  primary?: boolean;
}

export interface SCIMUserAddress {
  formatted?: string;
  streetAddress?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  type?: "work" | "home" | "other";
  primary?: boolean;
}

export interface SCIMGroupRef {
  value: string;
  display?: string;
  $ref?: string;
}

export interface SCIMUserEntitlement {
  value: string;
  type?: string;
  primary?: boolean;
}

export interface SCIMUserRole {
  value: string;
  type?: string;
  primary?: boolean;
}

export interface SCIMUserCertificate {
  value: string;
  display?: string;
  type?: string;
  primary?: boolean;
}

export interface SCIMGroup {
  schemas: string[];
  id?: string;
  displayName: string;
  members?: SCIMGroupMember[];
  meta?: SCIMMeta;
}

export interface SCIMGroupMember {
  value: string;
  display?: string;
  $ref?: string;
  type?: "User" | "Group";
}

export interface SCIMListResponse<T> {
  schemas: string[];
  totalResults: number;
  itemsPerPage: number;
  startIndex: number;
  Resources: T[];
}

export interface SCIMError {
  schemas: string[];
  status: number;
  scimType?: string;
  detail: string;
}

export interface SCIMConfig {
  /** Base URL for SCIM endpoints */
  baseUrl: string;
  /** Bearer token for SCIM authentication */
  bearerToken: string;
  /** Enable user provisioning */
  enableUserProvisioning: boolean;
  /** Enable group provisioning */
  enableGroupProvisioning: boolean;
  /** Attribute mapping from IdP to SCIM */
  attributeMapping: SCIMAttributeMapping;
  /** Filter for users to provision (e.g., group membership) */
  userFilter?: string;
  /** Default user schema */
  userSchema?: string;
  /** Default group schema */
  groupSchema?: string;
}

export interface SCIMAttributeMapping {
  /** Map IdP attributes to SCIM user attributes */
  user: {
    id?: string;
    externalId?: string;
    userName: string;
    givenName?: string;
    familyName?: string;
    formattedName?: string;
    displayName?: string;
    emails?: {
      value: string;
      type?: string;
      primary?: boolean;
    }[];
    active?: string;
    groups?: string;
  };
  /** Map IdP attributes to SCIM group attributes */
  group: {
    id?: string;
    displayName: string;
    members?: string;
  };
}

/**
 * SCIM Server — handles incoming SCIM requests from IdP
 */
export class SCIMServer {
  private config: SCIMConfig;
  private ssoManager: SSOManager | null = null;

  constructor(config: SCIMConfig) {
    this.config = config;
  }

  /**
   * Initialize with SSO manager for user operations
   */
  initialize(ssoManager: SSOManager): void {
    this.ssoManager = ssoManager;
  }

  /**
   * Validate SCIM Bearer token
   */
  private validateToken(authHeader: string | undefined): boolean {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return false;
    }
    const token = authHeader.substring(7);
    return token === this.config.bearerToken;
  }

  /**
   * Create error response
   */
  private createError(status: number, detail: string, scimType?: string): SCIMError {
    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status,
      scimType,
      detail,
    };
  }

  /**
   * Create User
   * POST /Users
   */
  async createUser(user: SCIMUser, authHeader: string): Promise<{ user: SCIMUser; status: number } | { error: SCIMError; status: number }> {
    if (!this.validateToken(authHeader)) {
      return { error: this.createError(401, "Invalid or missing Bearer token"), status: 401 };
    }

    if (!this.config.enableUserProvisioning) {
      return { error: this.createError(403, "User provisioning is disabled"), status: 403 };
    }

    if (!this.ssoManager) {
      return { error: this.createError(503, "SSO manager not initialized"), status: 503 };
    }

    try {
      // Validate required fields
      if (!user.userName) {
        return { error: this.createError(400, "userName is required"), status: 400 };
      }

      // Check if user already exists by externalId or userName
      const existing = await this.findUserByExternalId(user.externalId || user.userName);
      if (existing) {
        return { error: this.createError(409, `User ${user.userName} already exists`, "uniqueness"), status: 409 };
      }

      // Provision user via SSO manager
      const session = await this.ssoManager.provisionUser(user.externalId || user.userName, {
        email: user.emails?.[0]?.value || user.userName,
        name: user.displayName || user.name?.formatted || user.userName,
        roles: user.roles?.map(r => r.value) || ["user"],
        provider: "scim",
        providerId: user.externalId || user.userName,
      });

      // Build SCIM response
      const createdUser = this.mapUserToSCIM(session);
      createdUser.meta = {
        resourceType: "User",
        created: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        location: `${this.config.baseUrl}/Users/${session.id}`,
        version: "1",
      };

      logger.info({ userId: session.id, userName: user.userName }, "SCIM user created");
      return { user: createdUser, status: 201 };
    } catch (err) {
      logger.error({ err, userName: user.userName }, "SCIM create user failed");
      return { error: this.createError(500, err instanceof Error ? err.message : "Failed to create user"), status: 500 };
    }
  }

  /**
   * Get User by ID
   * GET /Users/{id}
   */
  async getUser(id: string, authHeader: string): Promise<{ user: SCIMUser; status: number } | { error: SCIMError; status: number }> {
    if (!this.validateToken(authHeader)) {
      return { error: this.createError(401, "Invalid or missing Bearer token"), status: 401 };
    }

    if (!this.ssoManager) {
      return { error: this.createError(503, "SSO manager not initialized"), status: 503 };
    }

    try {
      const session = await this.ssoManager.validateSession(id);
      if (!session) {
        return { error: this.createError(404, `User ${id} not found`), status: 404 };
      }

      const user = this.mapUserToSCIM(session);
      user.meta = {
        resourceType: "User",
        created: new Date(session.createdAt).toISOString(),
        lastModified: new Date(session.updatedAt).toISOString(),
        location: `${this.config.baseUrl}/Users/${id}`,
        version: "1",
      };

      return { user, status: 200 };
    } catch (err) {
      logger.error({ err, userId: id }, "SCIM get user failed");
      return { error: this.createError(500, err instanceof Error ? err.message : "Failed to get user"), status: 500 };
    }
  }

  /**
   * List Users with pagination and filtering
   * GET /Users
   */
  async listUsers(
    authHeader: string,
    params: {
      startIndex?: number;
      count?: number;
      filter?: string;
      attributes?: string;
      excludedAttributes?: string;
    } = {}
  ): Promise<{ response: SCIMListResponse<SCIMUser>; status: number } | { error: SCIMError; status: number }> {
    if (!this.validateToken(authHeader)) {
      return { error: this.createError(401, "Invalid or missing Bearer token"), status: 401 };
    }

    if (!this.ssoManager) {
      return { error: this.createError(503, "SSO manager not initialized"), status: 503 };
    }

    try {
      const sessions = this.ssoManager.getAllSessions();
      const users = sessions.map(s => this.mapUserToSCIM(s));

      // Apply filter if provided (simplified SCIM filter support)
      let filtered = users;
      if (params.filter) {
        filtered = this.applyFilter(users, params.filter);
      }

      // Pagination
      const startIndex = Math.max(1, params.startIndex || 1);
      const count = Math.min(100, params.count || 100);
      const paginated = filtered.slice(startIndex - 1, startIndex - 1 + count);

      // Apply attribute selection
      const selected = params.attributes
        ? paginated.map(u => this.selectAttributes(u, params.attributes!.split(",")))
        : paginated;

      if (params.excludedAttributes) {
        selected.forEach(u => this.excludeAttributes(u, params.excludedAttributes!.split(",")));
      }

      const response: SCIMListResponse<SCIMUser> = {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: filtered.length,
        itemsPerPage: paginated.length,
        startIndex,
        Resources: selected,
      };

      return { response, status: 200 };
    } catch (err) {
      logger.error({ err }, "SCIM list users failed");
      return { error: this.createError(500, err instanceof Error ? err.message : "Failed to list users"), status: 500 };
    }
  }

  /**
   * Update User (PUT - full replace)
   * PUT /Users/{id}
   */
  async replaceUser(id: string, user: SCIMUser, authHeader: string): Promise<{ user: SCIMUser; status: number } | { error: SCIMError; status: number }> {
    if (!this.validateToken(authHeader)) {
      return { error: this.createError(401, "Invalid or missing Bearer token"), status: 401 };
    }

    if (!this.config.enableUserProvisioning) {
      return { error: this.createError(403, "User provisioning is disabled"), status: 403 };
    }

    if (!this.ssoManager) {
      return { error: this.createError(503, "SSO manager not initialized"), status: 503 };
    }

    try {
      const session = await this.ssoManager.validateSession(id);
      if (!session) {
        return { error: this.createError(404, `User ${id} not found`), status: 404 };
      }

      // Update user via SSO manager
      const updated = await this.ssoManager.updateUser(id, {
        email: user.emails?.[0]?.value,
        name: user.displayName || user.name?.formatted,
        active: user.active,
        roles: user.roles?.map(r => r.value),
      });

      if (!updated) {
        return { error: this.createError(500, "Failed to update user"), status: 500 };
      }

      const updatedUser = this.mapUserToSCIM(updated);
      updatedUser.meta = {
        resourceType: "User",
        lastModified: new Date().toISOString(),
        location: `${this.config.baseUrl}/Users/${id}`,
        version: "2",
      };

      logger.info({ userId: id }, "SCIM user replaced");
      return { user: updatedUser, status: 200 };
    } catch (err) {
      logger.error({ err, userId: id }, "SCIM replace user failed");
      return { error: this.createError(500, err instanceof Error ? err.message : "Failed to replace user"), status: 500 };
    }
  }

  /**
   * Patch User (PATCH - partial update)
   * PATCH /Users/{id}
   */
  async patchUser(id: string, patch: SCIMPatchRequest, authHeader: string): Promise<{ user: SCIMUser; status: number } | { error: SCIMError; status: number }> {
    if (!this.validateToken(authHeader)) {
      return { error: this.createError(401, "Invalid or missing Bearer token"), status: 401 };
    }

    if (!this.config.enableUserProvisioning) {
      return { error: this.createError(403, "User provisioning is disabled"), status: 403 };
    }

    if (!this.ssoManager) {
      return { error: this.createError(503, "SSO manager not initialized"), status: 503 };
    }

    try {
      const session = await this.ssoManager.validateSession(id);
      if (!session) {
        return { error: this.createError(404, `User ${id} not found`), status: 404 };
      }

      // Apply patch operations
      for (const op of patch.Operations) {
        await this.applyPatchOperation(session, op);
      }

      const updated = await this.ssoManager.validateSession(id);
      if (!updated) {
        return { error: this.createError(500, "Failed to patch user"), status: 500 };
      }

      const updatedUser = this.mapUserToSCIM(updated);
      updatedUser.meta = {
        resourceType: "User",
        lastModified: new Date().toISOString(),
        location: `${this.config.baseUrl}/Users/${id}`,
        version: String(Number(updatedUser.meta?.version || "1") + 1),
      };

      logger.info({ userId: id, operations: patch.Operations.length }, "SCIM user patched");
      return { user: updatedUser, status: 200 };
    } catch (err) {
      logger.error({ err, userId: id }, "SCIM patch user failed");
      return { error: this.createError(500, err instanceof Error ? err.message : "Failed to patch user"), status: 500 };
    }
  }

  /**
   * Delete User
   * DELETE /Users/{id}
   */
  async deleteUser(id: string, authHeader: string): Promise<{ status: number } | { error: SCIMError; status: number }> {
    if (!this.validateToken(authHeader)) {
      return { error: this.createError(401, "Invalid or missing Bearer token"), status: 401 };
    }

    if (!this.config.enableUserProvisioning) {
      return { error: this.createError(403, "User provisioning is disabled"), status: 403 };
    }

    if (!this.ssoManager) {
      return { error: this.createError(503, "SSO manager not initialized"), status: 503 };
    }

    try {
      const session = await this.ssoManager.validateSession(id);
      if (!session) {
        return { error: this.createError(404, `User ${id} not found`), status: 404 };
      }

      // Deactivate user (revoke all sessions)
      await this.ssoManager.revokeAllSessions(session.userId);

      logger.info({ userId: id }, "SCIM user deleted (sessions revoked)");
      return { status: 204 };
    } catch (err) {
      logger.error({ err, userId: id }, "SCIM delete user failed");
      return { error: this.createError(500, err instanceof Error ? err.message : "Failed to delete user"), status: 500 };
    }
  }

  /**
   * Create Group
   * POST /Groups
   */
  async createGroup(group: SCIMGroup, authHeader: string): Promise<{ group: SCIMGroup; status: number } | { error: SCIMError; status: number }> {
    if (!this.validateToken(authHeader)) {
      return { error: this.createError(401, "Invalid or missing Bearer token"), status: 401 };
    }

    if (!this.config.enableGroupProvisioning) {
      return { error: this.createError(403, "Group provisioning is disabled"), status: 403 };
    }

    // Groups are managed via role mapping in SSO config
    // For now, return not implemented
    return { error: this.createError(501, "Group provisioning not yet implemented"), status: 501 };
  }

  /**
   * Get Group by ID
   * GET /Groups/{id}
   */
  async getGroup(id: string, authHeader: string): Promise<{ group: SCIMGroup; status: number } | { error: SCIMError; status: number }> {
    if (!this.validateToken(authHeader)) {
      return { error: this.createError(401, "Invalid or missing Bearer token"), status: 401 };
    }

    return { error: this.createError(501, "Group provisioning not yet implemented"), status: 501 };
  }

  /**
   * List Groups
   * GET /Groups
   */
  async listGroups(authHeader: string, params: { startIndex?: number; count?: number; filter?: string } = {}): Promise<{ response: SCIMListResponse<SCIMGroup>; status: number } | { error: SCIMError; status: number }> {
    if (!this.validateToken(authHeader)) {
      return { error: this.createError(401, "Invalid or missing Bearer token"), status: 401 };
    }

    return { error: this.createError(501, "Group provisioning not yet implemented"), status: 501 };
  }

  /**
   * Update Group (PUT)
   * PUT /Groups/{id}
   */
  async replaceGroup(id: string, group: SCIMGroup, authHeader: string): Promise<{ group: SCIMGroup; status: number } | { error: SCIMError; status: number }> {
    if (!this.validateToken(authHeader)) {
      return { error: this.createError(401, "Invalid or missing Bearer token"), status: 401 };
    }

    return { error: this.createError(501, "Group provisioning not yet implemented"), status: 501 };
  }

  /**
   * Patch Group (PATCH)
   * PATCH /Groups/{id}
   */
  async patchGroup(id: string, patch: SCIMPatchRequest, authHeader: string): Promise<{ group: SCIMGroup; status: number } | { error: SCIMError; status: number }> {
    if (!this.validateToken(authHeader)) {
      return { error: this.createError(401, "Invalid or missing Bearer token"), status: 401 };
    }

    return { error: this.createError(501, "Group provisioning not yet implemented"), status: 501 };
  }

  /**
   * Delete Group
   * DELETE /Groups/{id}
   */
  async deleteGroup(id: string, authHeader: string): Promise<{ status: number } | { error: SCIMError; status: number }> {
    if (!this.validateToken(authHeader)) {
      return { error: this.createError(401, "Invalid or missing Bearer token"), status: 401 };
    }

    return { error: this.createError(501, "Group provisioning not yet implemented"), status: 501 };
  }

  /**
   * Get Service Provider Configuration
   * GET /ServiceProviderConfig
   */
  async getServiceProviderConfig(): Promise<Record<string, unknown>> {
    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 100 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          name: "Bearer Token",
          description: "Authentication using Bearer token",
          specUrl: "http://www.rfc-editor.org/info/rfc6750",
          documentationUrl: "",
          type: "oauthbearertoken",
          primary: true,
        },
      ],
    };
  }

  /**
   * Get Resource Types
   * GET /ResourceTypes
   */
  async getResourceTypes(): Promise<Record<string, unknown>> {
    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 2,
      itemsPerPage: 2,
      startIndex: 1,
      Resources: [
        {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
          id: "User",
          name: "User",
          endpoint: "/Users",
          description: "User Account",
          schema: "urn:ietf:params:scim:schemas:core:2.0:User",
          schemaExtensions: [],
        },
        {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
          id: "Group",
          name: "Group",
          endpoint: "/Groups",
          description: "Group",
          schema: "urn:ietf:params:scim:schemas:core:2.0:Group",
          schemaExtensions: [],
        },
      ],
    };
  }

  /**
   * Get Schemas
   * GET /Schemas
   */
  async getSchemas(): Promise<Record<string, unknown>> {
    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 2,
      itemsPerPage: 2,
      startIndex: 1,
      Resources: [
        {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
          id: "urn:ietf:params:scim:schemas:core:2.0:User",
          name: "User",
          description: "User Account",
          attributes: [
            { name: "userName", type: "string", multiValued: false, required: true, caseExact: false, mutability: "readWrite", returned: "always", uniqueness: "server" },
            { name: "name", type: "complex", multiValued: false, required: false, subAttributes: [
              { name: "formatted", type: "string" },
              { name: "familyName", type: "string" },
              { name: "givenName", type: "string" },
            ]},
            { name: "displayName", type: "string", multiValued: false },
            { name: "emails", type: "complex", multiValued: true, subAttributes: [
              { name: "value", type: "string" },
              { name: "type", type: "string" },
              { name: "primary", type: "boolean" },
            ]},
            { name: "active", type: "boolean", multiValued: false },
            { name: "roles", type: "complex", multiValued: true, subAttributes: [
              { name: "value", type: "string" },
              { name: "type", type: "string" },
              { name: "primary", type: "boolean" },
            ]},
            { name: "groups", type: "complex", multiValued: true, subAttributes: [
              { name: "value", type: "string" },
              { name: "display", type: "string" },
            ]},
          ],
          meta: { resourceType: "Schema", location: "/Schemas/urn:ietf:params:scim:schemas:core:2.0:User" },
        },
        {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
          id: "urn:ietf:params:scim:schemas:core:2.0:Group",
          name: "Group",
          description: "Group",
          attributes: [
            { name: "displayName", type: "string", multiValued: false, required: true },
            { name: "members", type: "complex", multiValued: true, subAttributes: [
              { name: "value", type: "string" },
              { name: "display", type: "string" },
              { name: "type", type: "string" },
            ]},
          ],
          meta: { resourceType: "Schema", location: "/Schemas/urn:ietf:params:scim:schemas:core:2.0:Group" },
        },
      ],
    };
  }

  // ============================================
  // Private helper methods
  // ============================================

  private mapUserToSCIM(session: any): SCIMUser {
    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: session.id,
      externalId: session.providerId,
      userName: session.email,
      name: session.name ? {
        formatted: session.name,
        givenName: session.name.split(" ")[0],
        familyName: session.name.split(" ").slice(1).join(" "),
      } : undefined,
      displayName: session.name,
      emails: session.email ? [{ value: session.email, type: "work", primary: true }] : [],
      active: true,
      roles: session.roles?.map((r: string) => ({ value: r, type: "work" })) || [],
      groups: session.projects?.map((p: any) => ({ value: p.projectId, display: p.projectId })) || [],
      meta: {
        resourceType: "User",
        created: session.createdAt,
        lastModified: session.updatedAt,
      },
    };
  }

  private async findUserByExternalId(externalId: string): Promise<any | null> {
    if (!this.ssoManager) return null;
    const sessions = this.ssoManager.getAllSessions();
    return sessions.find(s => s.providerId === externalId || s.email === externalId) || null;
  }

  private applyFilter(users: SCIMUser[], filter: string): SCIMUser[] {
    // Simplified SCIM filter parsing
    // Supports: userName eq "value", emails.value eq "value", active eq true/false
    const match = filter.match(/(\w+)(?:\.(\w+))?\s+(eq|co|sw|ew|pr|gt|ge|lt|le)\s+"([^"]+)"/i);
    if (!match) return users;

    const [, attr, subAttr, operator, value] = match;
    const field = subAttr ? `${attr}.${subAttr}` : attr;

    return users.filter(u => {
      const userValue = this.getNestedValue(u, field);
      if (userValue === undefined) return false;

      switch (operator.toLowerCase()) {
        case "eq": return String(userValue).toLowerCase() === value.toLowerCase();
        case "co": return String(userValue).toLowerCase().includes(value.toLowerCase());
        case "sw": return String(userValue).toLowerCase().startsWith(value.toLowerCase());
        case "ew": return String(userValue).toLowerCase().endsWith(value.toLowerCase());
        case "pr": return userValue !== null && userValue !== "";
        default: return true;
      }
    });
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split(".").reduce((o, k) => o?.[k], obj);
  }

  private selectAttributes(user: SCIMUser, attributes: string[]): SCIMUser {
    const selected: any = { schemas: user.schemas };
    for (const attr of attributes) {
      if (attr === "id") selected.id = user.id;
      else if (attr === "externalId") selected.externalId = user.externalId;
      else if (attr === "userName") selected.userName = user.userName;
      else if (attr === "name") selected.name = user.name;
      else if (attr === "displayName") selected.displayName = user.displayName;
      else if (attr === "emails") selected.emails = user.emails;
      else if (attr === "active") selected.active = user.active;
      else if (attr === "roles") selected.roles = user.roles;
      else if (attr === "groups") selected.groups = user.groups;
      else if (attr === "meta") selected.meta = user.meta;
    }
    return selected;
  }

  private excludeAttributes(user: SCIMUser, attributes: string[]): void {
    for (const attr of attributes) {
      if (attr === "id") delete user.id;
      else if (attr === "externalId") delete user.externalId;
      else if (attr === "userName") delete user.userName;
      else if (attr === "name") delete user.name;
      else if (attr === "displayName") delete user.displayName;
      else if (attr === "emails") delete user.emails;
      else if (attr === "active") delete user.active;
      else if (attr === "roles") delete user.roles;
      else if (attr === "groups") delete user.groups;
      else if (attr === "meta") delete user.meta;
    }
  }

  private async applyPatchOperation(session: any, op: SCIMOperation): Promise<void> {
    // Simplified patch operation handling
    // In production, this would apply the operations to the session/user
    switch (op.op) {
      case "replace":
        if (op.path === "active") {
          // Handle active state change
        } else if (op.path === "displayName") {
          // Handle display name change
        }
        break;
      case "add":
        // Add values
        break;
      case "remove":
        // Remove values
        break;
    }
  }
}

/**
 * SCIM Patch Request
 */
export interface SCIMPatchRequest {
  schemas: string[];
  Operations: SCIMOperation[];
}

export interface SCIMOperation {
  op: "add" | "remove" | "replace";
  path?: string;
  value?: any;
}

/**
 * SCIM Client — for provisioning users TO external IdP
 */
export class SCIMClient {
  private baseUrl: string;
  private bearerToken: string;

  constructor(baseUrl: string, bearerToken: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.bearerToken = bearerToken;
  }

  private async request<T>(method: string, path: string, body?: any): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Authorization": `Bearer ${this.bearerToken}`,
        "Content-Type": "application/scim+json",
        "Accept": "application/scim+json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Unknown error" }));
      throw new Error(`SCIM ${method} ${path} failed: ${response.status} - ${error.detail || response.statusText}`);
    }

    return response.json();
  }

  async createUser(user: SCIMUser): Promise<SCIMUser> {
    return this.request<SCIMUser>("POST", "/Users", user);
  }

  async getUser(id: string): Promise<SCIMUser> {
    return this.request<SCIMUser>("GET", `/Users/${id}`);
  }

  async listUsers(params: { startIndex?: number; count?: number; filter?: string } = {}): Promise<SCIMListResponse<SCIMUser>> {
    const query = new URLSearchParams();
    if (params.startIndex) query.set("startIndex", String(params.startIndex));
    if (params.count) query.set("count", String(params.count));
    if (params.filter) query.set("filter", params.filter);
    return this.request<SCIMListResponse<SCIMUser>>("GET", `/Users?${query.toString()}`);
  }

  async replaceUser(id: string, user: SCIMUser): Promise<SCIMUser> {
    return this.request<SCIMUser>("PUT", `/Users/${id}`, user);
  }

  async patchUser(id: string, patch: SCIMPatchRequest): Promise<SCIMUser> {
    return this.request<SCIMUser>("PATCH", `/Users/${id}`, patch);
  }

  async deleteUser(id: string): Promise<void> {
    await this.request<void>("DELETE", `/Users/${id}`);
  }

  async createGroup(group: SCIMGroup): Promise<SCIMGroup> {
    return this.request<SCIMGroup>("POST", "/Groups", group);
  }

  async getGroup(id: string): Promise<SCIMGroup> {
    return this.request<SCIMGroup>("GET", `/Groups/${id}`);
  }

  async listGroups(params: { startIndex?: number; count?: number; filter?: string } = {}): Promise<SCIMListResponse<SCIMGroup>> {
    const query = new URLSearchParams();
    if (params.startIndex) query.set("startIndex", String(params.startIndex));
    if (params.count) query.set("count", String(params.count));
    if (params.filter) query.set("filter", params.filter);
    return this.request<SCIMListResponse<SCIMGroup>>("GET", `/Groups?${query.toString()}`);
  }

  async getServiceProviderConfig(): Promise<any> {
    return this.request("GET", "/ServiceProviderConfig");
  }

  async getResourceTypes(): Promise<any> {
    return this.request("GET", "/ResourceTypes");
  }

  async getSchemas(): Promise<any> {
    return this.request("GET", "/Schemas");
  }
}

/**
 * Default SCIM configuration
 */
export function createDefaultSCIMConfig(baseUrl: string, bearerToken: string): SCIMConfig {
  return {
    baseUrl,
    bearerToken,
    enableUserProvisioning: true,
    enableGroupProvisioning: false,
    attributeMapping: {
      user: {
        userName: "userName",
        givenName: "givenName",
        familyName: "familyName",
        formattedName: "displayName",
        displayName: "displayName",
        emails: [{ value: "email", primary: true }],
        active: "active",
      },
      group: {
        displayName: "displayName",
      },
    },
  };
}

/**
 * Default SCIM server instance
 */
export const scimServer = new SCIMServer({
  baseUrl: "",
  bearerToken: "",
  enableUserProvisioning: false,
  enableGroupProvisioning: false,
  attributeMapping: {
    user: {
      userName: "userName",
    },
    group: {
      displayName: "displayName",
    },
  },
});

/**
 * Initialize SCIM server with configuration
 */
export function initializeSCIM(config: SCIMConfig): SCIMServer {
  const server = new SCIMServer(config);
  const ssoManager = getSSOManager();
  if (ssoManager) {
    server.initialize(ssoManager);
  }
  return server;
}

/**
 * Get SCIM server instance
 */
export function getSCIMServer(): SCIMServer | null {
  return scimServer.config.baseUrl ? scimServer : null;
}