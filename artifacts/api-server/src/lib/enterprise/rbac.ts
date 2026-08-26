import { logger } from "../logger";

/**
 * Phase 14: Enterprise Role-Based Access Control (RBAC)
 * Custom roles, resource-level permissions, and policy management.
 * $0 budget — pure TypeScript implementation.
 */

export type PermissionAction =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "execute"
  | "manage"
  | "deploy"
  | "configure"
  | "admin";

export type ResourceType =
  | "project"
  | "build"
  | "artifact"
  | "deployment"
  | "secret"
  | "connector"
  | "settings"
  | "user"
  | "role"
  | "audit-log"
  | "vpc"
  | "sso"
  | "scim"
  | "agent"
  | "workspace"
  | "billing"
  | "api-key"
  | "webhook"
  | "custom";

export interface Permission {
  /** Resource type */
  resource: ResourceType;
  /** Actions allowed on this resource */
  actions: PermissionAction[];
  /** Optional: specific resource IDs (empty = all) */
  resourceIds?: string[];
  /** Optional: conditions for attribute-based access */
  conditions?: Record<string, unknown>;
}

export interface Role {
  /** Unique role ID */
  id: string;
  /** Role name */
  name: string;
  /** Description */
  description: string;
  /** Whether this is a system role (cannot be deleted) */
  isSystem: boolean;
  /** Permissions granted by this role */
  permissions: Permission[];
  /** Parent role IDs for inheritance */
  inherits?: string[];
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
  /** Created by user ID */
  createdBy: string;
}

export interface UserRoleAssignment {
  /** User ID */
  userId: string;
  /** Role ID */
  roleId: string;
  /** Project ID (for project-scoped roles) */
  projectId?: string;
  /** Workspace ID (for workspace-scoped roles) */
  workspaceId?: string;
  /** Assigned by user ID */
  assignedBy: string;
  /** Assigned timestamp */
  assignedAt: string;
  /** Expiration timestamp (optional) */
  expiresAt?: string;
}

export interface RBACConfig {
  /** System roles (cannot be modified) */
  systemRoles: Role[];
  /** Custom roles */
  customRoles: Role[];
  /** User role assignments */
  assignments: UserRoleAssignment[];
  /** Default role for new users */
  defaultRole: string;
  /** Enable resource-level permissions */
  resourceLevelPermissions: boolean;
  /** Enable attribute-based access control (ABAC) */
  enableABAC: boolean;
}

export interface PermissionCheck {
  /** User ID */
  userId: string;
  /** Resource type */
  resource: ResourceType;
  /** Action */
  action: PermissionAction;
  /** Resource ID (optional) */
  resourceId?: string;
  /** Project ID (optional) */
  projectId?: string;
  /** Workspace ID (optional) */
  workspaceId?: string;
  /** Additional context for ABAC */
  context?: Record<string, unknown>;
}

export interface PermissionResult {
  /** Whether access is allowed */
  allowed: boolean;
  /** Matched role ID */
  roleId?: string;
  /** Matched permission */
  permission?: Permission;
  /** Reason if denied */
  reason?: string;
}

export interface RBACAuditEvent {
  userId: string;
  action: string;
  resource: ResourceType;
  resourceId?: string;
  allowed: boolean;
  reason?: string;
  timestamp: string;
}

/**
 * RBAC Manager — handles roles, permissions, and access control decisions
 */
export class RBACManager {
  private config: RBACConfig;
  private roleCache: Map<string, Role> = new Map();
  private assignmentCache: Map<string, UserRoleAssignment[]> = new Map();
  private auditLog: RBACAuditEvent[] = [];
  private readonly maxAuditLogSize = 10000;

  constructor(config: Partial<RBACConfig> = {}) {
    const systemRoles = this.createSystemRoles();

    this.config = {
      systemRoles,
      customRoles: config.customRoles || [],
      assignments: config.assignments || [],
      defaultRole: config.defaultRole || "member",
      resourceLevelPermissions: config.resourceLevelPermissions ?? true,
      enableABAC: config.enableABAC ?? true,
    };

    this.buildCaches();
  }

  private createSystemRoles(): Role[] {
    const now = new Date().toISOString();

    return [
      {
        id: "owner",
        name: "Owner",
        description: "Full access to all resources in the workspace",
        isSystem: true,
        permissions: [
          { resource: "project", actions: ["create", "read", "update", "delete", "manage", "deploy", "configure", "admin"] },
          { resource: "build", actions: ["create", "read", "update", "delete", "execute", "manage", "deploy"] },
          { resource: "artifact", actions: ["create", "read", "update", "delete", "manage", "deploy"] },
          { resource: "deployment", actions: ["create", "read", "update", "delete", "manage", "deploy"] },
          { resource: "secret", actions: ["create", "read", "update", "delete", "manage", "admin"] },
          { resource: "connector", actions: ["create", "read", "update", "delete", "manage", "configure"] },
          { resource: "settings", actions: ["read", "update", "configure", "admin"] },
          { resource: "user", actions: ["create", "read", "update", "delete", "manage", "admin"] },
          { resource: "role", actions: ["create", "read", "update", "delete", "manage", "admin"] },
          { resource: "audit-log", actions: ["read", "manage", "admin"] },
          { resource: "vpc", actions: ["create", "read", "update", "delete", "manage", "configure", "admin"] },
          { resource: "sso", actions: ["create", "read", "update", "delete", "manage", "configure", "admin"] },
          { resource: "scim", actions: ["create", "read", "update", "delete", "manage", "configure", "admin"] },
          { resource: "agent", actions: ["create", "read", "update", "delete", "execute", "manage"] },
          { resource: "workspace", actions: ["create", "read", "update", "delete", "manage", "admin"] },
          { resource: "billing", actions: ["read", "manage", "admin"] },
          { resource: "api-key", actions: ["create", "read", "update", "delete", "manage", "admin"] },
          { resource: "webhook", actions: ["create", "read", "update", "delete", "manage", "configure"] },
        ],
        createdAt: now,
        updatedAt: now,
        createdBy: "system",
      },
      {
        id: "admin",
        name: "Admin",
        description: "Administrative access to most resources",
        isSystem: true,
        permissions: [
          { resource: "project", actions: ["create", "read", "update", "delete", "manage", "deploy", "configure"] },
          { resource: "build", actions: ["create", "read", "update", "delete", "execute", "manage", "deploy"] },
          { resource: "artifact", actions: ["create", "read", "update", "delete", "manage", "deploy"] },
          { resource: "deployment", actions: ["create", "read", "update", "delete", "manage", "deploy"] },
          { resource: "secret", actions: ["create", "read", "update", "delete", "manage"] },
          { resource: "connector", actions: ["create", "read", "update", "delete", "manage", "configure"] },
          { resource: "settings", actions: ["read", "update", "configure"] },
          { resource: "user", actions: ["create", "read", "update", "delete", "manage"] },
          { resource: "role", actions: ["read", "update"] },
          { resource: "audit-log", actions: ["read", "manage"] },
          { resource: "vpc", actions: ["create", "read", "update", "delete", "manage", "configure"] },
          { resource: "sso", actions: ["create", "read", "update", "delete", "manage", "configure"] },
          { resource: "scim", actions: ["create", "read", "update", "delete", "manage", "configure"] },
          { resource: "agent", actions: ["create", "read", "update", "delete", "execute", "manage"] },
          { resource: "workspace", actions: ["read", "update", "manage"] },
          { resource: "billing", actions: ["read", "manage"] },
          { resource: "api-key", actions: ["create", "read", "update", "delete", "manage"] },
          { resource: "webhook", actions: ["create", "read", "update", "delete", "manage", "configure"] },
        ],
        createdAt: now,
        updatedAt: now,
        createdBy: "system",
      },
      {
        id: "developer",
        name: "Developer",
        description: "Can create and manage builds, artifacts, and deployments",
        isSystem: true,
        permissions: [
          { resource: "project", actions: ["read", "update"] },
          { resource: "build", actions: ["create", "read", "update", "execute", "deploy"] },
          { resource: "artifact", actions: ["create", "read", "update", "delete", "deploy"] },
          { resource: "deployment", actions: ["create", "read", "update", "deploy"] },
          { resource: "secret", actions: ["read"] },
          { resource: "connector", actions: ["read", "update"] },
          { resource: "agent", actions: ["create", "read", "update", "execute"] },
          { resource: "api-key", actions: ["create", "read", "update", "delete"] },
          { resource: "webhook", actions: ["create", "read", "update", "delete"] },
        ],
        createdAt: now,
        updatedAt: now,
        createdBy: "system",
      },
      {
        id: "viewer",
        name: "Viewer",
        description: "Read-only access to projects and builds",
        isSystem: true,
        permissions: [
          { resource: "project", actions: ["read"] },
          { resource: "build", actions: ["read"] },
          { resource: "artifact", actions: ["read"] },
          { resource: "deployment", actions: ["read"] },
          { resource: "connector", actions: ["read"] },
          { resource: "audit-log", actions: ["read"] },
          { resource: "agent", actions: ["read"] },
        ],
        createdAt: now,
        updatedAt: now,
        createdBy: "system",
      },
      {
        id: "member",
        name: "Member",
        description: "Basic project member with limited permissions",
        isSystem: true,
        permissions: [
          { resource: "project", actions: ["read"] },
          { resource: "build", actions: ["read", "execute"] },
          { resource: "artifact", actions: ["read"] },
          { resource: "deployment", actions: ["read"] },
          { resource: "agent", actions: ["read", "execute"] },
        ],
        createdAt: now,
        updatedAt: now,
        createdBy: "system",
      },
    ];
  }

  private buildCaches(): void {
    this.roleCache.clear();
    this.assignmentCache.clear();

    // Add system roles
    for (const role of this.config.systemRoles) {
      this.roleCache.set(role.id, role);
    }

    // Add custom roles
    for (const role of this.config.customRoles) {
      this.roleCache.set(role.id, role);
    }

    // Build assignment cache
    for (const assignment of this.config.assignments) {
      const key = this.getAssignmentKey(assignment.userId, assignment.projectId, assignment.workspaceId);
      const existing = this.assignmentCache.get(key) || [];
      existing.push(assignment);
      this.assignmentCache.set(key, existing);
    }
  }

  private getAssignmentKey(userId: string, projectId?: string, workspaceId?: string): string {
    return `${userId}:${projectId || "global"}:${workspaceId || "global"}`;
  }

  private getAllAssignments(userId: string, projectId?: string, workspaceId?: string): UserRoleAssignment[] {
    const assignments: UserRoleAssignment[] = [];

    // Global assignments
    const globalKey = this.getAssignmentKey(userId);
    assignments.push(...(this.assignmentCache.get(globalKey) || []));

    // Workspace-scoped assignments
    if (workspaceId) {
      const wsKey = this.getAssignmentKey(userId, undefined, workspaceId);
      assignments.push(...(this.assignmentCache.get(wsKey) || []));
    }

    // Project-scoped assignments
    if (projectId) {
      const projKey = this.getAssignmentKey(userId, projectId);
      assignments.push(...(this.assignmentCache.get(projKey) || []));

      // Also check project-specific within workspace
      if (workspaceId) {
        const projWsKey = this.getAssignmentKey(userId, projectId, workspaceId);
        assignments.push(...(this.assignmentCache.get(projWsKey) || []));
      }
    }

    // Filter out expired assignments
    const now = new Date().toISOString();
    return assignments.filter(a => !a.expiresAt || a.expiresAt > now);
  }

  private getEffectiveRoles(userId: string, projectId?: string, workspaceId?: string): Role[] {
    const assignments = this.getAllAssignments(userId, projectId, workspaceId);
    const roleIds = new Set(assignments.map(a => a.roleId));

    // Always include default role if no assignments
    if (roleIds.size === 0) {
      roleIds.add(this.config.defaultRole);
    }

    const roles: Role[] = [];
    const visited = new Set<string>();

    const collectRoles = (roleId: string) => {
      if (visited.has(roleId)) return;
      visited.add(roleId);

      const role = this.roleCache.get(roleId);
      if (role) {
        roles.push(role);
        // Collect inherited roles
        if (role.inherits) {
          for (const parentId of role.inherits) {
            collectRoles(parentId);
          }
        }
      }
    };

    for (const roleId of roleIds) {
      collectRoles(roleId);
    }

    return roles;
  }

  private checkPermission(roles: Role[], check: PermissionCheck): PermissionResult {
    for (const role of roles) {
      for (const permission of role.permissions) {
        if (permission.resource !== check.resource) continue;
        if (!permission.actions.includes(check.action)) continue;

        // Check resource ID restrictions
        if (permission.resourceIds && permission.resourceIds.length > 0) {
          if (!check.resourceId || !permission.resourceIds.includes(check.resourceId)) {
            continue;
          }
        }

        // Check ABAC conditions
        if (this.config.enableABAC && permission.conditions && check.context) {
          if (!this.evaluateConditions(permission.conditions, check.context)) {
            continue;
          }
        }

        return {
          allowed: true,
          roleId: role.id,
          permission,
        };
      }
    }

    return {
      allowed: false,
      reason: `No role grants ${check.action} on ${check.resource}`,
    };
  }

  private evaluateConditions(conditions: Record<string, unknown>, context: Record<string, unknown>): boolean {
    // Simple condition evaluation - in production, use a proper policy engine
    for (const [key, expectedValue] of Object.entries(conditions)) {
      const actualValue = context[key];
      if (actualValue === undefined) return false;

      if (typeof expectedValue === "object" && expectedValue !== null) {
        // Handle operators like { "$in": ["a", "b"] }, { "$eq": "value" }
        const op = Object.keys(expectedValue)[0];
        const opValue = (expectedValue as Record<string, unknown>)[op];

        switch (op) {
          case "$in":
            if (!Array.isArray(opValue) || !opValue.includes(actualValue)) return false;
            break;
          case "$eq":
            if (actualValue !== opValue) return false;
            break;
          case "$ne":
            if (actualValue === opValue) return false;
            break;
          case "$contains":
            if (typeof actualValue === "string" && typeof opValue === "string") {
              if (!actualValue.includes(opValue)) return false;
            } else if (Array.isArray(actualValue)) {
              if (!actualValue.includes(opValue)) return false;
            } else {
              return false;
            }
            break;
          default:
            return false;
        }
      } else {
        // Direct equality
        if (actualValue !== expectedValue) return false;
      }
    }
    return true;
  }

  /**
   * Check if a user has permission to perform an action on a resource
   */
  check(check: PermissionCheck): PermissionResult {
    const roles = this.getEffectiveRoles(check.userId, check.projectId, check.workspaceId);
    const result = this.checkPermission(roles, check);

    // Audit log
    this.auditLog.push({
      userId: check.userId,
      action: check.action,
      resource: check.resource,
      resourceId: check.resourceId,
      allowed: result.allowed,
      reason: result.reason,
      timestamp: new Date().toISOString(),
    });

    // Trim audit log
    if (this.auditLog.length > this.maxAuditLogSize) {
      this.auditLog = this.auditLog.slice(-this.maxAuditLogSize);
    }

    return result;
  }

  /**
   * Check multiple permissions at once
   */
  checkMultiple(checks: PermissionCheck[]): Record<string, PermissionResult> {
    const results: Record<string, PermissionResult> = {};

    for (const check of checks) {
      const key = `${check.resource}:${check.action}${check.resourceId ? `:${check.resourceId}` : ""}`;
      results[key] = this.check(check);
    }

    return results;
  }

  /**
   * Get all roles (system + custom)
   */
  getAllRoles(): Role[] {
    return Array.from(this.roleCache.values());
  }

  /**
   * Get role by ID
   */
  getRole(roleId: string): Role | undefined {
    return this.roleCache.get(roleId);
  }

  /**
   * Create a custom role
   */
  createRole(role: Omit<Role, "id" | "createdAt" | "updatedAt" | "isSystem">, createdBy: string): Role {
    const newRole: Role = {
      ...role,
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      isSystem: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy,
    };

    this.config.customRoles.push(newRole);
    this.roleCache.set(newRole.id, newRole);

    logger.info({ roleId: newRole.id, name: newRole.name }, "Custom role created");
    return newRole;
  }

  /**
   * Update a custom role
   */
  updateRole(roleId: string, updates: Partial<Omit<Role, "id" | "isSystem" | "createdAt" | "createdBy">>): Role | null {
    const role = this.roleCache.get(roleId);
    if (!role || role.isSystem) {
      return null;
    }

    const updated: Role = {
      ...role,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.config.customRoles = this.config.customRoles.map(r => r.id === roleId ? updated : r);
    this.roleCache.set(roleId, updated);

    logger.info({ roleId }, "Role updated");
    return updated;
  }

  /**
   * Delete a custom role
   */
  deleteRole(roleId: string): boolean {
    const role = this.roleCache.get(roleId);
    if (!role || role.isSystem) {
      return false;
    }

    // Check if role is assigned to any user
    const hasAssignments = this.config.assignments.some(a => a.roleId === roleId);
    if (hasAssignments) {
      throw new Error("Cannot delete role with active assignments");
    }

    // Check if role is inherited by other roles
    const isInherited = Array.from(this.roleCache.values()).some(r => r.inherits?.includes(roleId));
    if (isInherited) {
      throw new Error("Cannot delete role that is inherited by other roles");
    }

    this.config.customRoles = this.config.customRoles.filter(r => r.id !== roleId);
    this.roleCache.delete(roleId);

    logger.info({ roleId }, "Custom role deleted");
    return true;
  }

  /**
   * Assign a role to a user
   */
  assignRole(assignment: Omit<UserRoleAssignment, "assignedAt">): UserRoleAssignment {
    const role = this.roleCache.get(assignment.roleId);
    if (!role) {
      throw new Error(`Role ${assignment.roleId} not found`);
    }

    const newAssignment: UserRoleAssignment = {
      ...assignment,
      assignedAt: new Date().toISOString(),
    };

    this.config.assignments.push(newAssignment);

    const key = this.getAssignmentKey(assignment.userId, assignment.projectId, assignment.workspaceId);
    const existing = this.assignmentCache.get(key) || [];
    existing.push(newAssignment);
    this.assignmentCache.set(key, existing);

    logger.info({ userId: assignment.userId, roleId: assignment.roleId, projectId: assignment.projectId }, "Role assigned");
    return newAssignment;
  }

  /**
   * Remove a role assignment
   */
  removeRoleAssignment(userId: string, roleId: string, projectId?: string, workspaceId?: string): boolean {
    const initialLength = this.config.assignments.length;
    this.config.assignments = this.config.assignments.filter(
      a => !(a.userId === userId && a.roleId === roleId && a.projectId === projectId && a.workspaceId === workspaceId)
    );

    if (this.config.assignments.length < initialLength) {
      const key = this.getAssignmentKey(userId, projectId, workspaceId);
      const existing = this.assignmentCache.get(key) || [];
      this.assignmentCache.set(key, existing.filter(a => a.roleId !== roleId));

      logger.info({ userId, roleId, projectId }, "Role assignment removed");
      return true;
    }

    return false;
  }

  /**
   * Get user's role assignments
   */
  getUserAssignments(userId: string, projectId?: string, workspaceId?: string): UserRoleAssignment[] {
    return this.getAllAssignments(userId, projectId, workspaceId);
  }

  /**
   * Get effective permissions for a user
   */
  getEffectivePermissions(userId: string, projectId?: string, workspaceId?: string): Permission[] {
    const roles = this.getEffectiveRoles(userId, projectId, workspaceId);
    const permissions: Permission[] = [];

    for (const role of roles) {
      permissions.push(...role.permissions);
    }

    return permissions;
  }

  /**
   * Get audit log
   */
  getAuditLog(limit = 100): RBACAuditEvent[] {
    return this.auditLog.slice(-limit);
  }

  /**
   * Export configuration
   */
  exportConfig(): RBACConfig {
    return {
      systemRoles: this.config.systemRoles,
      customRoles: this.config.customRoles,
      assignments: this.config.assignments,
      defaultRole: this.config.defaultRole,
      resourceLevelPermissions: this.config.resourceLevelPermissions,
      enableABAC: this.config.enableABAC,
    };
  }

  /**
   * Import configuration
   */
  importConfig(config: RBACConfig): void {
    this.config = config;
    this.buildCaches();
  }
}

/**
 * Default RBAC configuration
 */
export function createDefaultRBACConfig(): RBACConfig {
  const manager = new RBACManager();
  return manager.exportConfig();
}

/**
 * RBAC Manager instance
 */
export let rbacManager: RBACManager | null = null;

/**
 * Initialize RBAC manager
 */
export function initializeRBAC(config?: Partial<RBACConfig>): RBACManager {
  rbacManager = new RBACManager(config);
  return rbacManager;
}

/**
 * Get RBAC manager instance
 */
export function getRBACManager(): RBACManager | null {
  return rbacManager;
}

/**
 * Helper: Quick permission check
 */
export function can(userId: string, action: PermissionAction, resource: ResourceType, options?: {
  resourceId?: string;
  projectId?: string;
  workspaceId?: string;
  context?: Record<string, unknown>;
}): boolean {
  const manager = getRBACManager();
  if (!manager) return false;

  return manager.check({
    userId,
    resource,
    action,
    ...options,
  }).allowed;
}

/**
 * Helper: Require permission (throws if not allowed)
 */
export function requirePermission(
  userId: string,
  action: PermissionAction,
  resource: ResourceType,
  options?: {
    resourceId?: string;
    projectId?: string;
    workspaceId?: string;
    context?: Record<string, unknown>;
  }
): void {
  const manager = getRBACManager();
  if (!manager) throw new Error("RBAC not initialized");

  const result = manager.check({
    userId,
    resource,
    action,
    ...options,
  });

  if (!result.allowed) {
    throw new Error(`Access denied: ${result.reason}`);
  }
}