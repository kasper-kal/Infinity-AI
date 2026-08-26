import { logger } from "../logger";
import { logActivity } from "../project-activity";
import { BaseConnector, ConnectorConfig, NotificationPayload, CommandContext, SendResult, createConnector as baseCreateConnector } from "./base";

/**
 * Linear Connector — Issue tracking and project management
 * Supports: Issues, Projects, Cycles, Teams, Comments, Webhooks
 * OAuth 2.0 + Personal API keys
 */

interface LinearConfig extends ConnectorConfig {
  /** Linear API key (personal or OAuth token) */
  apiKey?: string;
  /** Team ID to operate within */
  teamId?: string;
  /** Default project ID for new issues */
  defaultProjectId?: string;
  /** Webhook secret for signature verification */
  webhookSecret?: string;
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: { name: string; type: string };
  priority: number;
  assignee?: { id: string; name: string; email: string };
  project?: { id: string; name: string };
  cycle?: { id: string; number: number; name: string };
  labels?: { nodes: Array<{ id: string; name: string; color: string }> };
  url: string;
  createdAt: string;
  updatedAt: string;
}

interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

interface LinearProject {
  id: string;
  name: string;
  description?: string;
  state: string;
  progress: number;
  startDate?: string;
  targetDate?: string;
}

interface LinearCycle {
  id: string;
  number: number;
  name: string;
  startsAt: string;
  endsAt: string;
  progress: number;
}

interface LinearWebhookPayload {
  action: string;
  type: string;
  data: any;
  url: string;
  createdAt: string;
}

export class LinearConnector extends BaseConnector {
  protected config: LinearConfig;
  private baseUrl = "https://api.linear.app/graphql";

  constructor(config: ConnectorConfig, projectId: string, connectorId: string) {
    super(config, projectId, connectorId);
    this.config = config as LinearConfig;
  }

  get platform() {
    return "linear" as const;
  }

  getDisplayName(): string {
    return "Linear";
  }

  private async graphql(query: string, variables?: Record<string, any>): Promise<any> {
    const apiKey = this.config.apiKey || this.config.botToken;
    if (!apiKey) {
      throw new Error("Linear API key not configured");
    }

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });

    const result = await response.json();

    if (result.errors) {
      throw new Error(`Linear GraphQL error: ${result.errors.map((e: any) => e.message).join(", ")}`);
    }

    return result.data;
  }

  async validateConfig(): Promise<{ valid: boolean; error?: string }> {
    try {
      if (!this.config.apiKey && !this.config.botToken) {
        return { valid: false, error: "Linear API key is required" };
      }

      // Test connection by fetching viewer info
      const data = await this.graphql(`
        query {
          viewer {
            id
            name
            email
          }
        }
      `);

      if (!data?.viewer) {
        return { valid: false, error: "Invalid Linear API key" };
      }

      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Validation failed" };
    }
  }

  async sendNotification(payload: NotificationPayload): Promise<SendResult> {
    try {
      // Linear doesn't have a direct "send message" API like Slack/Discord
      // Instead, we can create an issue or comment as a notification
      const issue = await this.createIssue({
        title: payload.title,
        description: `${payload.body}\n\n---\n*Source: ${payload.eventType}*${payload.url ? `\n[View in Infinity](${payload.url})` : ""}`,
        teamId: this.config.teamId,
        projectId: this.config.defaultProjectId,
        labels: ["infinity", "notification", payload.eventType.replace(/_/g, "-")],
      });

      await this.logNotification(payload.eventType, 200, undefined, payload);

      return { success: true, messageId: issue.id };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      await this.logNotification(payload.eventType, 500, error, payload);
      return { success: false, error };
    }
  }

  async handleCommand(context: CommandContext): Promise<void> {
    const { command, args, projectId, connectorId } = context;

    try {
      switch (command) {
        case "issue":
        case "create-issue":
          await this.handleCreateIssue(context);
          break;
        case "issues":
        case "list-issues":
          await this.handleListIssues(context);
          break;
        case "project":
        case "projects":
          await this.handleListProjects(context);
          break;
        case "cycle":
        case "cycles":
          await this.handleListCycles(context);
          break;
        case "team":
        case "teams":
          await this.handleListTeams(context);
          break;
        case "search":
          await this.handleSearch(context);
          break;
        default:
          await this.sendHelp(context);
      }
    } catch (err) {
      logger.error({ err, command }, "Linear command failed");
      await this.sendError(context, err instanceof Error ? err.message : "Command failed");
    }
  }

  private async handleCreateIssue(context: CommandContext): Promise<void> {
    const { args, projectId, connectorId, channelId, userId } = context;

    if (args.length < 1) {
      await this.sendError(context, "Usage: /infinity issue <title> [description]");
      return;
    }

    const title = args[0];
    const description = args.slice(1).join(" ") || "Created via Infinity";

    const issue = await this.createIssue({
      title,
      description: `${description}\n\n---\n*Created by ${context.userName} via Infinity*`,
      teamId: this.config.teamId,
      projectId: this.config.defaultProjectId,
    });

    await this.sendCommandResponse(context, `✅ Created issue **${issue.identifier}**: ${issue.title}\n${issue.url}`);
  }

  private async handleListIssues(context: CommandContext): Promise<void> {
    const { args, projectId, connectorId, channelId } = context;

    const filter: any = {};
    if (args[0]) {
      // Support filters like "state:open", "assignee:me", "project:xxx"
      const filterStr = args.join(" ");
      if (filterStr.includes(":")) {
        const [key, value] = filterStr.split(":");
        filter[key.trim()] = value.trim();
      }
    }

    const issues = await this.listIssues(filter);

    if (issues.length === 0) {
      await this.sendCommandResponse(context, "No issues found matching your criteria.");
      return;
    }

    const lines = issues.slice(0, 10).map(issue =>
      `• **${issue.identifier}** ${issue.title} — ${issue.state.name} (Priority: ${issue.priority})`
    ).join("\n");

    await this.sendCommandResponse(context, `📋 **Linear Issues** (showing ${Math.min(issues.length, 10)} of ${issues.length}):\n${lines}`);
  }

  private async handleListProjects(context: CommandContext): Promise<void> {
    const projects = await this.listProjects();

    if (projects.length === 0) {
      await this.sendCommandResponse(context, "No projects found.");
      return;
    }

    const lines = projects.map(p =>
      `• **${p.name}** — ${p.state} (${Math.round(p.progress)}% complete)${p.targetDate ? ` — Target: ${p.targetDate}` : ""}`
    ).join("\n");

    await this.sendCommandResponse(context, `📁 **Linear Projects**:\n${lines}`);
  }

  private async handleListCycles(context: CommandContext): Promise<void> {
    const cycles = await this.listCycles();

    if (cycles.length === 0) {
      await this.sendCommandResponse(context, "No cycles found.");
      return;
    }

    const lines = cycles.map(c =>
      `• **Cycle ${c.number}**: ${c.name} — ${Math.round(c.progress)}% (${c.startsAt} → ${c.endsAt})`
    ).join("\n");

    await this.sendCommandResponse(context, `🔄 **Linear Cycles**:\n${lines}`);
  }

  private async handleListTeams(context: CommandContext): Promise<void> {
    const teams = await this.listTeams();

    if (teams.length === 0) {
      await this.sendCommandResponse(context, "No teams found.");
      return;
    }

    const lines = teams.map(t => `• **${t.name}** (${t.key})`).join("\n");
    await this.sendCommandResponse(context, `👥 **Linear Teams**:\n${lines}`);
  }

  private async handleSearch(context: CommandContext): Promise<void> {
    const { args } = context;

    if (args.length < 1) {
      await this.sendError(context, "Usage: /infinity search <query>");
      return;
    }

    const query = args.join(" ");
    const issues = await this.searchIssues(query);

    if (issues.length === 0) {
      await this.sendCommandResponse(context, `No issues found for "${query}".`);
      return;
    }

    const lines = issues.slice(0, 10).map(issue =>
      `• **${issue.identifier}** ${issue.title} — ${issue.state.name}`
    ).join("\n");

    await this.sendCommandResponse(context, `🔍 **Search Results** for "${query}" (showing ${Math.min(issues.length, 10)} of ${issues.length}):\n${lines}`);
  }

  private async sendHelp(context: CommandContext): Promise<void> {
    const help = `
**Linear Commands** (via /infinity):
• \`issue <title> [description]\` — Create a new issue
• \`issues [filter]\` — List issues (filters: state:open, assignee:me, project:xxx)
• \`projects\` — List all projects
• \`cycles\` — List all cycles
• \`teams\` — List all teams
• \`search <query>\` — Search issues by title/description
• \`help\` — Show this help
    `.trim();

    await this.sendCommandResponse(context, help);
  }

  // Public API methods for automation integration

  async createIssue(params: {
    title: string;
    description?: string;
    teamId?: string;
    projectId?: string;
    priority?: number;
    labels?: string[];
    assigneeId?: string;
    cycleId?: string;
  }): Promise<LinearIssue> {
    const teamId = params.teamId || this.config.teamId;
    if (!teamId) {
      throw new Error("Team ID is required (configure in connector settings or pass explicitly)");
    }

    const labelIds = params.labels ? await this.getOrCreateLabelIds(params.labels) : [];

    const mutation = `
      mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          issue {
            id
            identifier
            title
            description
            state { name type }
            priority
            assignee { id name email }
            project { id name }
            cycle { id number name }
            labels { nodes { id name color } }
            url
            createdAt
            updatedAt
          }
          success
        }
      }
    `;

    const variables = {
      input: {
        teamId,
        title: params.title,
        description: params.description,
        projectId: params.projectId,
        priority: params.priority ?? 3,
        labelIds: labelIds.length > 0 ? labelIds : undefined,
        assigneeId: params.assigneeId,
        cycleId: params.cycleId,
      },
    };

    const data = await this.graphql(mutation, variables);

    if (!data?.issueCreate?.success) {
      throw new Error("Failed to create issue");
    }

    return data.issueCreate.issue;
  }

  async updateIssue(issueId: string, params: {
    title?: string;
    description?: string;
    stateId?: string;
    priority?: number;
    assigneeId?: string;
    projectId?: string;
    cycleId?: string;
    labelIds?: string[];
  }): Promise<LinearIssue> {
    const mutation = `
      mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          issue {
            id
            identifier
            title
            description
            state { name type }
            priority
            assignee { id name email }
            project { id name }
            cycle { id number name }
            labels { nodes { id name color } }
            url
            createdAt
            updatedAt
          }
          success
        }
      }
    `;

    const data = await this.graphql(mutation, { id: issueId, input: params });

    if (!data?.issueUpdate?.success) {
      throw new Error("Failed to update issue");
    }

    return data.issueUpdate.issue;
  }

  async listIssues(filter: Record<string, any> = {}): Promise<LinearIssue[]> {
    const where: any = {};

    if (filter.state) where.state = { name: { eq: filter.state } };
    if (filter.assignee === "me") {
      // Would need viewer ID - simplified for now
    }
    if (filter.project) where.project = { id: { eq: filter.project } };
    if (filter.team) where.team = { id: { eq: filter.team } };

    const query = `
      query Issues($filter: IssueFilter, $first: Int) {
        issues(filter: $filter, first: $first) {
          nodes {
            id
            identifier
            title
            description
            state { name type }
            priority
            assignee { id name email }
            project { id name }
            cycle { id number name }
            labels { nodes { id name color } }
            url
            createdAt
            updatedAt
          }
        }
      }
    `;

    const data = await this.graphql(query, { filter: where, first: 50 });
    return data?.issues?.nodes || [];
  }

  async searchIssues(query: string): Promise<LinearIssue[]> {
    const gqlQuery = `
      query Search($term: String!, $first: Int) {
        issues(filter: { title: { containsIgnoreCase: $term } }, first: $first) {
          nodes {
            id
            identifier
            title
            description
            state { name type }
            priority
            assignee { id name email }
            project { id name }
            cycle { id number name }
            labels { nodes { id name color } }
            url
            createdAt
            updatedAt
          }
        }
      }
    `;

    const data = await this.graphql(gqlQuery, { term: query, first: 50 });
    return data?.issues?.nodes || [];
  }

  async listProjects(): Promise<LinearProject[]> {
    const query = `
      query Projects {
        projects {
          nodes {
            id
            name
            description
            state
            progress
            startDate
            targetDate
          }
        }
      }
    `;

    const data = await this.graphql(query);
    return data?.projects?.nodes || [];
  }

  async listCycles(): Promise<LinearCycle[]> {
    const query = `
      query Cycles {
        cycles {
          nodes {
            id
            number
            name
            startsAt
            endsAt
            progress
          }
        }
      }
    `;

    const data = await this.graphql(query);
    return data?.cycles?.nodes || [];
  }

  async listTeams(): Promise<LinearTeam[]> {
    const query = `
      query Teams {
        teams {
          nodes {
            id
            name
            key
          }
        }
      }
    `;

    const data = await this.graphql(query);
    return data?.teams?.nodes || [];
  }

  async getIssue(issueId: string): Promise<LinearIssue | null> {
    const query = `
      query Issue($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
          description
          state { name type }
          priority
          assignee { id name email }
          project { id name }
          cycle { id number name }
          labels { nodes { id name color } }
          url
          createdAt
          updatedAt
        }
      }
    `;

    const data = await this.graphql(query, { id: issueId });
    return data?.issue || null;
  }

  async addComment(issueId: string, body: string): Promise<any> {
    const mutation = `
      mutation CommentCreate($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          comment {
            id
            body
            user { id name }
            createdAt
          }
          success
        }
      }
    `;

    const data = await this.graphql(mutation, { input: { issueId, body } });
    return data?.commentCreate?.comment;
  }

  private async getOrCreateLabelIds(labels: string[]): Promise<string[]> {
    // Simplified: just return label names for now
    // In production, would check existing labels and create if needed
    return labels;
  }

  // Webhook handling for automation triggers
  async handleWebhook(payload: LinearWebhookPayload): Promise<void> {
    const { action, type, data, url } = payload;

    logger.info({ action, type, projectId: this.projectId }, "Linear webhook received");

    // Emit event for automation system
    // This would integrate with Phase 36 automation runtime
    const eventType = `linear.${type.toLowerCase()}.${action.toLowerCase()}`;

    await this.logActivity("agent_ran", `Linear webhook: ${eventType}`);

    // The automation runtime would pick this up and trigger matching automations
  }

  private async sendCommandResponse(context: CommandContext, message: string): Promise<void> {
    // This would send a response back to the platform
    // Implementation depends on platform (Slack/Discord/Telegram)
    // For Linear, we'd typically respond via the original platform's API
    logger.info({ message, connectorId: this.connectorId }, "Linear command response");
  }

  private async sendError(context: CommandContext, error: string): Promise<void> {
    await this.sendCommandResponse(context, `❌ Error: ${error}`);
  }
}

/**
 * Factory function for creating Linear connector instances
 */
export async function createLinearConnector(
  config: ConnectorConfig,
  projectId: string,
  connectorId: string
): Promise<LinearConnector> {
  return new LinearConnector(config, projectId, connectorId);
}

// Export types for automation integration
export type { LinearConfig, LinearIssue, LinearProject, LinearCycle, LinearTeam, LinearWebhookPayload };