import { logger } from "../logger";
import { logActivity } from "../project-activity";
import { BaseConnector, type ConnectorConfig, type NotificationPayload, type SendResult, type CommandContext } from "./base";

/**
 * GitHub Connector — Repository analysis and operations.
 * Supports: Repository analysis, Issues, PRs, Files, Structure, Search
 * Uses GitHub REST API v3 / GraphQL API v4.
 */

interface GitHubConfig extends ConnectorConfig {
  /** GitHub Personal Access Token (classic) or Fine-grained PAT */
  accessToken?: string;
  /** GitHub App ID (for GitHub App authentication) */
  appId?: string;
  /** GitHub App Private Key (for GitHub App authentication) */
  privateKey?: string;
  /** GitHub App Installation ID */
  installationId?: string;
  /** Default repository owner */
  defaultOwner?: string;
  /** Default repository name */
  defaultRepo?: string;
  /** Webhook secret for signature verification */
  webhookSecret?: string;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string; avatar_url: string };
  description: string | null;
  private: boolean;
  html_url: string;
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  topics: string[];
  created_at: string;
  updated_at: string;
  pushed_at: string;
}

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  state: string;
  user: { login: string; avatar_url: string };
  labels: Array<{ name: string; color: string }>;
  assignees: Array<{ login: string; avatar_url: string }>;
  html_url: string;
  created_at: string;
  updated_at: string;
  body: string | null;
}

interface GitHubPR {
  id: number;
  number: number;
  title: string;
  state: string;
  user: { login: string; avatar_url: string };
  head: { ref: string; sha: string; repo: { full_name: string } };
  base: { ref: string; sha: string; repo: { full_name: string } };
  html_url: string;
  created_at: string;
  updated_at: string;
  body: string | null;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
}

interface GitHubFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: "file" | "dir";
  html_url: string;
  download_url: string | null;
}

interface GitHubContent {
  type: "file" | "dir";
  encoding?: string;
  size: number;
  name: string;
  path: string;
  content?: string;
  sha: string;
  url: string;
  html_url: string;
}

export class GitHubConnector extends BaseConnector {
  protected config: GitHubConfig;
  private baseUrl = "https://api.github.com";
  private graphqlUrl = "https://api.github.com/graphql";

  constructor(config: ConnectorConfig, projectId: string, connectorId: string) {
    super(config, projectId, connectorId);
    this.config = config as GitHubConfig;
  }

  get platform() {
    return "github" as const;
  }

  getDisplayName(): string {
    return `GitHub (${this.config.defaultOwner || "user"}/${this.config.defaultRepo || "repo"})`;
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const token = this.config.accessToken;
    if (!token) {
      throw new Error("GitHub access token not configured");
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`GitHub API error (${response.status}): ${data.message || JSON.stringify(data)}`);
    }

    return data;
  }

  private async graphql(query: string, variables?: Record<string, any>): Promise<any> {
    const token = this.config.accessToken;
    if (!token) {
      throw new Error("GitHub access token not configured");
    }

    const response = await fetch(this.graphqlUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    const result = await response.json();

    if (result.errors) {
      throw new Error(`GitHub GraphQL error: ${result.errors.map((e: any) => e.message).join(", ")}`);
    }

    return result.data;
  }

  async validateConfig(): Promise<{ valid: boolean; error?: string }> {
    try {
      if (!this.config.accessToken) {
        return { valid: false, error: "GitHub access token is required" };
      }

      // Test connection by fetching authenticated user
      const data = await this.request("/user");

      if (!data?.login) {
        return { valid: false, error: "Invalid GitHub access token" };
      }

      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Validation failed" };
    }
  }

  async sendNotification(payload: NotificationPayload): Promise<SendResult> {
    try {
      // GitHub doesn't have a direct messaging API
      // Could create an issue as notification
      await this.logNotification(payload.eventType, 200, undefined, payload);
      return { success: true };
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
        case "analyze":
        case "repo":
        case "repository":
          await this.handleAnalyzeRepo(context);
          break;
        case "issues":
        case "list-issues":
          await this.handleListIssues(context);
          break;
        case "prs":
        case "pulls":
        case "list-prs":
          await this.handleListPRs(context);
          break;
        case "files":
        case "tree":
        case "structure":
          await this.handleGetStructure(context);
          break;
        case "read":
        case "get-file":
          await this.handleReadFile(context);
          break;
        case "search":
          await this.handleSearch(context);
          break;
        case "create-issue":
          await this.handleCreateIssue(context);
          break;
        default:
          await this.sendHelp(context);
      }
    } catch (err) {
      logger.error({ err, command }, "GitHub command failed");
      await this.sendError(context, err instanceof Error ? err.message : "Command failed");
    }
  }

  /**
   * Analyze a repository - returns comprehensive info.
   * Called from @GitHub [owner/repo] analyze command.
   */
  async analyzeRepo(params: { owner: string; repo: string }): Promise<{
    success: boolean;
    repo?: GitHubRepo;
    analysis?: {
      languages: Record<string, number>;
      contributors: Array<{ login: string; contributions: number }>;
      recentCommits: Array<{ sha: string; message: string; author: string; date: string }>;
      openIssues: number;
      openPRs: number;
    };
    error?: string;
  }> {
    try {
      const { owner, repo } = params;

      // Get repo info
      const repoData = await this.request(`/repos/${owner}/${repo}`) as GitHubRepo;

      // Get languages
      const languages = await this.request(`/repos/${owner}/${repo}/languages`) as Record<string, number>;

      // Get contributors (top 10)
      const contributors = await this.request(`/repos/${owner}/${repo}/contributors?per_page=10`) as Array<{ login: string; contributions: number }>;

      // Get recent commits (last 10)
      const commits = await this.request(`/repos/${owner}/${repo}/commits?per_page=10`) as Array<{
        sha: string;
        commit: { message: string; author: { name: string; date: string } };
      }>;

      // Get open issues count
      const issues = await this.request(`/repos/${owner}/${repo}/issues?state=open&per_page=1`) as any[];
      const openIssues = parseInt(issues[0]?.number?.toString() || "0") || 0;

      // Get open PRs count
      const prs = await this.request(`/repos/${owner}/${repo}/pulls?state=open&per_page=1`) as any[];
      const openPRs = parseInt(prs[0]?.number?.toString() || "0") || 0;

      await logActivity(this.projectId, "agent_ran", `Analyzed GitHub repo ${owner}/${repo}`);

      return {
        success: true,
        repo: repoData,
        analysis: {
          languages,
          contributors: contributors.map(c => ({ login: c.login, contributions: c.contributions })),
          recentCommits: commits.map(c => ({
            sha: c.sha.slice(0, 7),
            message: c.commit.message.split("\n")[0],
            author: c.commit.author.name,
            date: c.commit.author.date,
          })),
          openIssues,
          openPRs,
        },
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Repository analysis failed";
      logger.error({ err, owner: params.owner, repo: params.repo }, "GitHub analyzeRepo failed");
      return { success: false, error };
    }
  }

  /**
   * List repository issues.
   */
  async listIssues(params: { owner: string; repo: string; state?: string; labels?: string; assignee?: string; per_page?: number }): Promise<{
    success: boolean;
    issues?: GitHubIssue[];
    error?: string;
  }> {
    try {
      const { owner, repo, state = "open", labels, assignee, per_page = 20 } = params;
      const queryParams = new URLSearchParams({
        state,
        per_page: per_page.toString(),
        ...(labels && { labels }),
        ...(assignee && { assignee }),
      });

      const issues = await this.request(`/repos/${owner}/${repo}/issues?${queryParams}`) as GitHubIssue[];

      // Filter out PRs (GitHub API returns PRs in issues endpoint)
      const filteredIssues = issues.filter(i => !i.pull_request);

      await logActivity(this.projectId, "agent_ran", `Listed ${filteredIssues.length} issues for ${owner}/${repo}`);

      return { success: true, issues: filteredIssues };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Failed to list issues";
      return { success: false, error };
    }
  }

  /**
   * List repository pull requests.
   */
  async listPRs(params: { owner: string; repo: string; state?: string; per_page?: number }): Promise<{
    success: boolean;
    prs?: GitHubPR[];
    error?: string;
  }> {
    try {
      const { owner, repo, state = "open", per_page = 20 } = params;
      const queryParams = new URLSearchParams({
        state,
        per_page: per_page.toString(),
      });

      const prs = await this.request(`/repos/${owner}/${repo}/pulls?${queryParams}`) as GitHubPR[];

      await logActivity(this.projectId, "agent_ran", `Listed ${prs.length} PRs for ${owner}/${repo}`);

      return { success: true, prs };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Failed to list PRs";
      return { success: false, error };
    }
  }

  /**
   * Get repository structure (file tree).
   */
  async getStructure(params: { owner: string; repo: string; branch?: string; path?: string }): Promise<{
    success: boolean;
    tree?: GitHubFile[];
    error?: string;
  }> {
    try {
      const { owner, repo, branch, path = "" } = params;
      const ref = branch || "main";

      // Get tree recursively
      const tree = await this.request(`/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`) as {
        tree: Array<{ path: string; type: "blob" | "tree"; sha: string; size: number }>;
      };

      const files: GitHubFile[] = tree.tree
        .filter(item => item.type === "blob")
        .map(item => ({
          name: item.path.split("/").pop() || item.path,
          path: item.path,
          sha: item.sha,
          size: item.size,
          type: "file" as const,
          html_url: `https://github.com/${owner}/${repo}/blob/${ref}/${item.path}`,
          download_url: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${item.path}`,
        }));

      await logActivity(this.projectId, "agent_ran", `Got structure for ${owner}/${repo} (${files.length} files)`);

      return { success: true, tree: files };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Failed to get structure";
      return { success: false, error };
    }
  }

  /**
   * Read a file from the repository.
   */
  async readFile(params: { owner: string; repo: string; path: string; branch?: string }): Promise<{
    success: boolean;
    content?: string;
    encoding?: string;
    error?: string;
  }> {
    try {
      const { owner, repo, path, branch } = params;
      const ref = branch || "main";

      const content = await this.request(`/repos/${owner}/${repo}/contents/${path}?ref=${ref}`) as GitHubContent;

      if (content.type !== "file") {
        return { success: false, error: "Path is not a file" };
      }

      let fileContent = "";
      if (content.encoding === "base64" && content.content) {
        fileContent = Buffer.from(content.content, "base64").toString("utf-8");
      }

      return { success: true, content: fileContent, encoding: content.encoding };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Failed to read file";
      return { success: false, error };
    }
  }

  /**
   * Search code/issues/PRs in repository.
   */
  async search(params: { owner: string; repo: string; query: string; type?: "code" | "issues" | "prs" }): Promise<{
    success: boolean;
    results?: any[];
    error?: string;
  }> {
    try {
      const { owner, repo, query, type = "code" } = params;
      const searchQuery = `${query} repo:${owner}/${repo}${type === "code" ? "" : ` type:${type === "issues" ? "issue" : "pr"}`}`;

      const result = await this.request(`/search/${type === "code" ? "code" : "issues"}?q=${encodeURIComponent(searchQuery)}&per_page=20`) as {
        items: any[];
      };

      return { success: true, results: result.items };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Search failed";
      return { success: false, error };
    }
  }

  /**
   * Create an issue.
   */
  async createIssue(params: { owner: string; repo: string; title: string; body?: string; labels?: string[]; assignees?: string[] }): Promise<{
    success: boolean;
    issue?: GitHubIssue;
    error?: string;
  }> {
    try {
      const { owner, repo, title, body, labels, assignees } = params;

      const issue = await this.request(`/repos/${owner}/${repo}/issues`, {
        method: "POST",
        body: JSON.stringify({ title, body, labels, assignees }),
      }) as GitHubIssue;

      await logActivity(this.projectId, "agent_ran", `Created GitHub issue #${issue.number} in ${owner}/${repo}`);

      return { success: true, issue };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Failed to create issue";
      return { success: false, error };
    }
  }

  // Command handlers for platform-specific commands (Slack/Discord/Telegram)
  private async handleAnalyzeRepo(context: CommandContext): Promise<void> {
    const { args, channelId, userId } = context;

    if (args.length < 1) {
      await this.sendError(context, "Usage: /infinity analyze <owner/repo>");
      return;
    }

    const [owner, repo] = args[0].split("/");
    if (!owner || !repo) {
      await this.sendError(context, "Invalid repository format. Use: owner/repo");
      return;
    }

    const result = await this.analyzeRepo({ owner, repo });

    if (result.success && result.repo && result.analysis) {
      const { repo: r, analysis } = result;
      const langs = Object.entries(analysis.languages)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([lang, bytes]) => `${lang}: ${(bytes / 1024).toFixed(1)}KB`)
        .join(", ");

      await this.sendCommandResponse(context,
        `📊 **Repository Analysis: ${r.full_name}**\n\n` +
        `📝 **Description:** ${r.description || "No description"}\n` +
        `🌿 **Default branch:** ${r.default_branch}\n` +
        `⭐ **Stars:** ${r.stargazers_count} | 🍴 **Forks:** ${r.forks_count}\n` +
        `🐛 **Open Issues:** ${analysis.openIssues} | 🔀 **Open PRs:** ${analysis.openPRs}\n` +
        `💬 **Top Languages:** ${langs || "N/A"}\n\n` +
        `👥 **Top Contributors:** ${analysis.contributors.slice(0, 5).map(c => `${c.login} (${c.contributions})`).join(", ")}\n\n` +
        `📝 **Recent Commits:**\n${analysis.recentCommits.slice(0, 5).map(c => `• \`${c.sha}\` ${c.message} — ${c.author} (${c.date})`).join("\n")}\n\n` +
        `🔗 [View on GitHub](${r.html_url})`
      );
    } else {
      await this.sendError(context, result.error || "Analysis failed");
    }
  }

  private async handleListIssues(context: CommandContext): Promise<void> {
    const { args, channelId } = context;
    const [owner, repo] = (args[0] || `${this.config.defaultOwner}/${this.config.defaultRepo}`).split("/");

    if (!owner || !repo) {
      await this.sendError(context, "Usage: /infinity issues [owner/repo] [state]");
      return;
    }

    const state = args[1] || "open";
    const result = await this.listIssues({ owner, repo, state });

    if (result.success && result.issues) {
      if (result.issues.length === 0) {
        await this.sendCommandResponse(context, `No ${state} issues found for ${owner}/${repo}.`);
        return;
      }

      const lines = result.issues.slice(0, 10).map(issue =>
        `• #${issue.number} **${issue.title}** — @${issue.user.login} ${issue.labels.map(l => `\`${l.name}\``).join(" ")}`
      ).join("\n");

      await this.sendCommandResponse(context, `🐛 **Issues in ${owner}/${repo} (${state})**:\n${lines}`);
    } else {
      await this.sendError(context, result.error || "Failed to list issues");
    }
  }

  private async handleListPRs(context: CommandContext): Promise<void> {
    const { args, channelId } = context;
    const [owner, repo] = (args[0] || `${this.config.defaultOwner}/${this.config.defaultRepo}`).split("/");

    if (!owner || !repo) {
      await this.sendError(context, "Usage: /infinity prs [owner/repo] [state]");
      return;
    }

    const state = args[1] || "open";
    const result = await this.listPRs({ owner, repo, state });

    if (result.success && result.prs) {
      if (result.prs.length === 0) {
        await this.sendCommandResponse(context, `No ${state} PRs found for ${owner}/${repo}.`);
        return;
      }

      const lines = result.prs.slice(0, 10).map(pr =>
        `• #${pr.number} **${pr.title}** — @${pr.user.login} (${pr.draft ? "📝 Draft" : pr.merged ? "✅ Merged" : "🔀 Open"})`
      ).join("\n");

      await this.sendCommandResponse(context, `🔀 **Pull Requests in ${owner}/${repo} (${state})**:\n${lines}`);
    } else {
      await this.sendError(context, result.error || "Failed to list PRs");
    }
  }

  private async handleGetStructure(context: CommandContext): Promise<void> {
    const { args, channelId } = context;
    const [owner, repo] = (args[0] || `${this.config.defaultOwner}/${this.config.defaultRepo}`).split("/");

    if (!owner || !repo) {
      await this.sendError(context, "Usage: /infinity structure [owner/repo] [path]");
      return;
    }

    const path = args[1] || "";
    const result = await this.getStructure({ owner, repo, path });

    if (result.success && result.tree) {
      // Group by directory
      const byDir: Record<string, string[]> = {};
      for (const file of result.tree.slice(0, 50)) {
        const dir = file.path.split("/").slice(0, -1).join("/") || "root";
        if (!byDir[dir]) byDir[dir] = [];
        byDir[dir].push(`  📄 ${file.name} (${(file.size / 1024).toFixed(1)}KB)`);
      }

      const lines = Object.entries(byDir).flatMap(([dir, files]) => [
        `📁 ${dir}/`,
        ...files.slice(0, 10),
        files.length > 10 ? `  ... and ${files.length - 10} more` : "",
      ]).filter(Boolean).join("\n");

      await this.sendCommandResponse(context, `📁 **Repository Structure: ${owner}/${repo}**\n${lines}`);
    } else {
      await this.sendError(context, result.error || "Failed to get structure");
    }
  }

  private async handleReadFile(context: CommandContext): Promise<void> {
    const { args, channelId } = context;

    if (args.length < 2) {
      await this.sendError(context, "Usage: /infinity read <owner/repo> <file-path> [branch]");
      return;
    }

    const [owner, repo] = args[0].split("/");
    const path = args[1];
    const branch = args[2];

    if (!owner || !repo) {
      await this.sendError(context, "Invalid repository format. Use: owner/repo");
      return;
    }

    const result = await this.readFile({ owner, repo, path, branch });

    if (result.success && result.content !== undefined) {
      const preview = result.content.slice(0, 2000);
      await this.sendCommandResponse(context,
        `📄 **File: ${path}**\n\`\`\`\n${preview}${result.content.length > 2000 ? "\n... (truncated)" : ""}\n\`\`\``
      );
    } else {
      await this.sendError(context, result.error || "Failed to read file");
    }
  }

  private async handleSearch(context: CommandContext): Promise<void> {
    const { args, channelId } = context;

    if (args.length < 2) {
      await this.sendError(context, "Usage: /infinity search <owner/repo> <query> [code|issues|prs]");
      return;
    }

    const [owner, repo] = args[0].split("/");
    const query = args[1];
    const type = (args[2] as "code" | "issues" | "prs") || "code";

    if (!owner || !repo) {
      await this.sendError(context, "Invalid repository format. Use: owner/repo");
      return;
    }

    const result = await this.search({ owner, repo, query, type });

    if (result.success && result.results) {
      if (result.results.length === 0) {
        await this.sendCommandResponse(context, `No results found for "${query}" in ${owner}/${repo}.`);
        return;
      }

      const lines = result.results.slice(0, 10).map((r: any) => {
        if (type === "code") {
          return `• ${r.path} (line ${r.text_matches?.[0]?.fragment?.slice(0, 80) || ""})`;
        }
        return `• #${r.number} ${r.title} — @${r.user?.login}`;
      }).join("\n");

      await this.sendCommandResponse(context, `🔍 **Search Results (${type}) for "${query}" in ${owner}/${repo}**:\n${lines}`);
    } else {
      await this.sendError(context, result.error || "Search failed");
    }
  }

  private async handleCreateIssue(context: CommandContext): Promise<void> {
    const { args, channelId, userName } = context;

    if (args.length < 2) {
      await this.sendError(context, "Usage: /infinity create-issue <owner/repo> <title> [body]");
      return;
    }

    const [owner, repo] = args[0].split("/");
    const title = args[1];
    const body = args.slice(2).join(" ") || `Created by ${userName} via Infinity`;

    if (!owner || !repo) {
      await this.sendError(context, "Invalid repository format. Use: owner/repo");
      return;
    }

    const result = await this.createIssue({ owner, repo, title, body });

    if (result.success && result.issue) {
      await this.sendCommandResponse(context,
        `✅ Created issue **#${result.issue.number}**: ${result.issue.title}\n${result.issue.html_url}`
      );
    } else {
      await this.sendError(context, result.error || "Failed to create issue");
    }
  }

  private async sendHelp(context: CommandContext): Promise<void> {
    await this.sendCommandResponse(context,
      `🤖 **GitHub Commands**:\n` +
      `\`/infinity analyze <owner/repo>\` — Analyze repository\n` +
      `\`/infinity issues [owner/repo] [state]\` — List issues\n` +
      `\`/infinity prs [owner/repo] [state]\` — List pull requests\n` +
      `\`/infinity structure [owner/repo] [path]\` — Get file structure\n` +
      `\`/infinity read <owner/repo> <path> [branch]\` — Read file content\n` +
      `\`/infinity search <owner/repo> <query> [code|issues|prs]\` — Search\n` +
      `\`/infinity create-issue <owner/repo> <title> [body]\` — Create issue`
    );
  }

  private async sendCommandResponse(context: CommandContext, text: string): Promise<void> {
    logger.info({ text, channelId: context.channelId }, "GitHub command response");
  }

  private async sendError(context: CommandContext, error: string): Promise<void> {
    await this.sendCommandResponse(context, `❌ ${error}`);
  }
}

export async function createGitHubConnector(
  config: ConnectorConfig,
  projectId: string,
  connectorId: string
): Promise<GitHubConnector> {
  return new GitHubConnector(config, projectId, connectorId);
}