import { logger } from "../logger";
import { logActivity } from "../project-activity";
import { BaseConnector, type ConnectorConfig, type NotificationPayload, type SendResult, type CommandContext } from "./base";

/**
 * Figma Connector — Design generation using design kits.
 * Supports: iOS 27, macOS 27, Material You 3, watchOS, Dashboard UI Kit
 * Uses Figma REST API for file/component operations.
 */

interface FigmaConfig extends ConnectorConfig {
  /** Figma Personal Access Token */
  accessToken?: string;
  /** Default team ID for operations */
  teamId?: string;
  /** Default project ID for new files */
  defaultProjectId?: string;
}

interface FigmaFile {
  key: string;
  name: string;
  thumbnail_url: string;
  last_modified: string;
  version: string;
}

interface FigmaComponent {
  key: string;
  name: string;
  description: string;
  component_set_id?: string;
}

interface FigmaDesignKit {
  name: string;
  fileKey: string;
  components: string[]; // component keys or names to use as building blocks
}

const DESIGN_KITS: Record<string, FigmaDesignKit> = {
  "ios 27": {
    name: "iOS 27",
    fileKey: "iOS27DesignKit", // Would be actual Figma file key
    components: ["NavigationBar", "TabBar", "Button", "Card", "List", "Form", "Modal", "Alert", "Sheet", "Progress"],
  },
  "macos 27": {
    name: "macOS 27",
    fileKey: "macOS27DesignKit",
    components: ["Window", "Toolbar", "Sidebar", "Button", "Table", "Form", "Popover", "Menu", "Toast", "Progress"],
  },
  "material you 3": {
    name: "Material You 3",
    fileKey: "MaterialYou3DesignKit",
    components: ["AppBar", "NavigationBar", "Button", "Card", "Chip", "Dialog", "BottomSheet", "Snackbar", "FAB", "TextField"],
  },
  "watchos": {
    name: "watchOS",
    fileKey: "watchOSDesignKit",
    components: ["NavigationStack", "Button", "List", "Complication", "Gauge", "Progress", "Alert", "Sheet"],
  },
  "dashboard ui kit": {
    name: "Dashboard UI Kit",
    fileKey: "DashboardUIKit",
    components: ["Sidebar", "Header", "StatCard", "Chart", "Table", "Filter", "ActionButton", "Dropdown", "Toast", "Modal"],
  },
};

export class FigmaConnector extends BaseConnector {
  protected config: FigmaConfig;
  private baseUrl = "https://api.figma.com/v1";

  constructor(config: ConnectorConfig, projectId: string, connectorId: string) {
    super(config, projectId, connectorId);
    this.config = config as FigmaConfig;
  }

  get platform() {
    return "figma" as const;
  }

  getDisplayName(): string {
    return "Figma";
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const accessToken = this.config.accessToken;
    if (!accessToken) {
      throw new Error("Figma access token not configured");
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    const data = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      const errorMessage = data?.message && typeof data.message === 'string'
        ? data.message
        : data?.error && typeof data.error === 'object' && 'message' in data.error
          ? String((data.error as Record<string, unknown>).message)
          : JSON.stringify(data);
      throw new Error(`Figma API error (${response.status}): ${errorMessage}`);
    }

    return data;
  }

  async validateConfig(): Promise<{ valid: boolean; error?: string }> {
    try {
      if (!this.config.accessToken) {
        return { valid: false, error: "Figma access token is required" };
      }

      // Test connection by fetching user info
      const data = await this.request("/me");

      if (!data?.id) {
        return { valid: false, error: "Invalid Figma access token" };
      }

      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Validation failed" };
    }
  }

  async sendNotification(payload: NotificationPayload): Promise<SendResult> {
    try {
      // Figma doesn't have a direct messaging API
      // We could create a comment on a file as a notification
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
        case "design":
        case "generate":
        case "create":
          await this.handleGenerateDesign(context);
          break;
        case "kits":
        case "list-kits":
          await this.handleListKits(context);
          break;
        case "components":
        case "list-components":
          await this.handleListComponents(context);
          break;
        case "file":
        case "get-file":
          await this.handleGetFile(context);
          break;
        default:
          await this.sendHelp(context);
      }
    } catch (err) {
      logger.error({ err, command }, "Figma command failed");
      await this.sendError(context, err instanceof Error ? err.message : "Command failed");
    }
  }

  /**
   * Generate a design using a design kit.
   * This is the main action called from the @Figma command handler.
   */
  async generateDesign(params: { kit: string; description: string; connectorId: string; projectId: string }): Promise<{
    success: boolean;
    design?: {
      kit: string;
      description: string;
      components: string[];
      figmaUrl?: string;
      previewUrl?: string;
    };
    error?: string;
  }> {
    try {
      const { kit, description } = params;

      const designKit = DESIGN_KITS[kit.toLowerCase()];
      if (!designKit) {
        return { success: false, error: `Unknown design kit: ${kit}. Available: ${Object.keys(DESIGN_KITS).join(", ")}` };
      }

      // In a real implementation, this would:
      // 1. Create a new Figma file from the design kit template
      // 2. Use the components to build the design based on the description
      // 3. Return the Figma file URL

      // For now, return a mock design result with the components that would be used
      const selectedComponents = this.selectComponentsForDescription(designKit.components, description);

      await logActivity(this.projectId, "agent_ran", `Generated Figma design using ${designKit.name} kit`);

      return {
        success: true,
        design: {
          kit: designKit.name,
          description,
          components: selectedComponents,
          figmaUrl: `https://figma.com/file/${designKit.fileKey}`,
          previewUrl: `https://figma.com/embed?embed_host=infinity&url=https://figma.com/file/${designKit.fileKey}`,
        },
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Design generation failed";
      logger.error({ err, kit: params.kit }, "Figma generateDesign failed");
      return { success: false, error };
    }
  }

  /**
   * Select relevant components from the kit based on the description.
   * In a real implementation, this would use AI to determine the best components.
   */
  private selectComponentsForDescription(availableComponents: string[], description: string): string[] {
    const desc = description.toLowerCase();
    const selected: string[] = [];

    // Simple keyword matching - in production would use LLM
    const componentKeywords: Record<string, string[]> = {
      "NavigationBar": ["nav", "navigation", "header", "top bar", "nav bar", "navigation bar"],
      "TabBar": ["tab", "bottom nav", "bottom bar"],
      "Button": ["button", "btn", "cta", "action"],
      "Card": ["card", "tile", "item"],
      "List": ["list", "feed", "rows"],
      "Form": ["form", "input", "field", "signup", "login", "register"],
      "Modal": ["modal", "dialog", "popup", "overlay"],
      "Alert": ["alert", "notification", "toast", "banner"],
      "Sheet": ["sheet", "bottom sheet", "drawer"],
      "Progress": ["progress", "loading", "spinner"],
      "Window": ["window", "app window"],
      "Toolbar": ["toolbar", "tool bar"],
      "Sidebar": ["sidebar", "side bar", "navigation drawer"],
      "Table": ["table", "grid", "data grid"],
      "Popover": ["popover", "tooltip", "dropdown"],
      "Menu": ["menu", "context menu"],
      "Toast": ["toast", "snackbar"],
      "AppBar": ["app bar", "top app bar"],
      "Chip": ["chip", "tag", "label"],
      "Dialog": ["dialog", "modal"],
      "BottomSheet": ["bottom sheet", "sheet"],
      "Snackbar": ["snackbar", "toast"],
      "FAB": ["fab", "floating action button", "floating button"],
      "TextField": ["text field", "input field", "text input"],
      "NavigationStack": ["nav stack", "navigation"],
      "Complication": ["complication", "watch face"],
      "Gauge": ["gauge", "meter", "dial"],
      "StatCard": ["stat", "metric", "kpi", "stat card"],
      "Chart": ["chart", "graph", "visualization"],
      "Filter": ["filter", "search filter"],
      "ActionButton": ["action button", "primary button"],
      "Dropdown": ["dropdown", "select", "combobox"],
    };

    for (const component of availableComponents) {
      const keywords = componentKeywords[component] || [component.toLowerCase()];
      if (keywords.some(kw => desc.includes(kw.toLowerCase()))) {
        selected.push(component);
      }
    }

    // If no specific matches, include core components
    if (selected.length === 0) {
      selected.push(...availableComponents.slice(0, 5));
    }

    return selected.slice(0, 8); // Limit to 8 components
  }

  private async handleGenerateDesign(context: CommandContext): Promise<void> {
    const { args, channelId, userId } = context;

    if (args.length < 2) {
      await this.sendError(context, "Usage: /infinity design <kit> <description>\nKits: iOS 27, macOS 27, Material You 3, watchOS, Dashboard UI Kit");
      return;
    }

    const kit = args[0].toLowerCase();
    const description = args.slice(1).join(" ");

    const result = await this.generateDesign({ kit, description, connectorId: this.connectorId, projectId: this.projectId });

    if (result.success && result.design) {
      await this.sendCommandResponse(context,
        `✨ **Design Generated** using ${result.design.kit}\n\n` +
        `📝 **Description:** ${result.design.description}\n\n` +
        `🧩 **Components:** ${result.design.components.join(", ")}\n\n` +
        `🔗 [Open in Figma](${result.design.figmaUrl}) | [Preview](${result.design.previewUrl})`
      );
    } else {
      await this.sendError(context, result.error || "Design generation failed");
    }
  }

  private async handleListKits(context: CommandContext): Promise<void> {
    const kits = Object.entries(DESIGN_KITS).map(([key, kit]) =>
      `• **${kit.name}** (\`${key}\`) — ${kit.components.length} components`
    ).join("\n");

    await this.sendCommandResponse(context, `🎨 **Available Design Kits**:\n${kits}\n\nUsage: \`/infinity design <kit> <description>\``);
  }

  private async handleListComponents(context: CommandContext): Promise<void> {
    const { args } = context;
    const kitKey = args[0]?.toLowerCase() || "ios 27";
    const designKit = DESIGN_KITS[kitKey];

    if (!designKit) {
      await this.sendError(context, `Unknown kit: ${kitKey}. Use \`/infinity kits\` to list available kits.`);
      return;
    }

    const components = designKit.components.map(c => `• ${c}`).join("\n");
    await this.sendCommandResponse(context, `🧩 **Components in ${designKit.name}**:\n${components}`);
  }

  private async handleGetFile(context: CommandContext): Promise<void> {
    const { args } = context;

    if (args.length < 1) {
      await this.sendError(context, "Usage: /infinity file <fileKey>");
      return;
    }

    try {
      const fileKey = args[0];
      const file = await this.request(`/files/${fileKey}`) as FigmaFile;

      await this.sendCommandResponse(context,
        `📄 **Figma File**: ${file.name}\n` +
        `🔑 Key: ${file.key}\n` +
        `📅 Last modified: ${file.last_modified}\n` +
        `🔗 [Open in Figma](https://figma.com/file/${file.key})`
      );
    } catch (err) {
      await this.sendError(context, `Failed to get file: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  private async sendHelp(context: CommandContext): Promise<void> {
    await this.sendCommandResponse(context,
      `🤖 **Figma Commands**:\n` +
      `\`/infinity design <kit> <description>\` — Generate a design\n` +
      `\`/infinity kits\` — List available design kits\n` +
      `\`/infinity components [kit]\` — List components in a kit\n` +
      `\`/infinity file <fileKey>\` — Get file info\n\n` +
      `Kits: iOS 27, macOS 27, Material You 3, watchOS, Dashboard UI Kit`
    );
  }

  private async sendCommandResponse(context: CommandContext, text: string): Promise<void> {
    // This would send a response back to the platform (Slack/Discord/Telegram)
    // For now, just log it
    logger.info({ text, channelId: context.channelId }, "Figma command response");
  }

  private async sendError(context: CommandContext, error: string): Promise<void> {
    await this.sendCommandResponse(context, `❌ ${error}`);
  }
}

/**
 * Factory function to create Figma connector instance.
 * This is imported dynamically in tool-registry.ts
 */
export async function createFigmaConnector(
  config: ConnectorConfig,
  projectId: string,
  connectorId: string
): Promise<FigmaConnector> {
  return new FigmaConnector(config, projectId, connectorId);
}