import { z } from "zod";
import { subagents } from "./subagents.js";
import { eventEmitter } from "./event-emitter.js";

// ============================================================================
// SCHEMAS
// ============================================================================

export const ClarificationQuestionSchema = z.object({
  id: z.string(),
  type: z.enum(["single_choice", "multi_choice", "text", "number", "boolean", "scale"]),
  question: z.string(),
  description: z.string().optional(),
  options: z.array(z.object({
    value: z.string(),
    label: z.string(),
    description: z.string().optional(),
  })).optional(),
  required: z.boolean().default(true),
  validation: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
    custom: z.string().optional(), // JS expression for custom validation
  }).optional(),
  dependsOn: z.object({
    questionId: z.string(),
    value: z.string(),
  }).optional(), // Conditional question
});

export const ClarificationSessionSchema = z.object({
  id: z.string(),
  goal: z.string(),
  status: z.enum(["active", "completed", "abandoned"]),
  questions: z.array(ClarificationQuestionSchema),
  answers: z.record(z.unknown()),
  prd: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  completedAt: z.date().optional(),
});

export const PRDSchema = z.object({
  projectName: z.string(),
  elevatorPitch: z.string(),
  targetAudience: z.string(),
  coreProblem: z.string(),
  keyFeatures: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    priority: z.enum(["must", "should", "could", "wont"]),
    userStory: z.string(),
    acceptanceCriteria: z.array(z.string()),
    technicalNotes: z.string().optional(),
  })),
  userFlows: z.array(z.object({
    name: z.string(),
    steps: z.array(z.string()),
    entryPoints: z.array(z.string()),
    exitPoints: z.array(z.string()),
  })),
  dataModel: z.array(z.object({
    entity: z.string(),
    fields: z.array(z.object({
      name: z.string(),
      type: z.string(),
      required: z.boolean(),
      description: z.string().optional(),
      relations: z.array(z.string()).optional(),
    })),
  })),
  apiEndpoints: z.array(z.object({
    method: z.string(),
    path: z.string(),
    description: z.string(),
    requestBody: z.record(z.unknown()).optional(),
    response: z.record(z.unknown()).optional(),
    auth: z.boolean().default(true),
  })),
  nonFunctionalRequirements: z.object({
    performance: z.array(z.string()).optional(),
    security: z.array(z.string()).optional(),
    scalability: z.array(z.string()).optional(),
    accessibility: z.array(z.string()).optional(),
    compliance: z.array(z.string()).optional(),
  }).optional(),
  constraints: z.object({
    budget: z.string().optional(),
    timeline: z.string().optional(),
    team: z.string().optional(),
    techStack: z.record(z.string()).optional(),
    integrations: z.array(z.string()).optional(),
  }).optional(),
  risks: z.array(z.object({
    risk: z.string(),
    likelihood: z.enum(["low", "medium", "high"]),
    impact: z.enum(["low", "medium", "high"]),
    mitigation: z.string(),
  })).optional(),
  successMetrics: z.array(z.object({
    metric: z.string(),
    target: z.string(),
    measurement: z.string(),
  })).optional(),
});

// ============================================================================
// TYPES
// ============================================================================

export type ClarificationQuestion = z.infer<typeof ClarificationQuestionSchema>;
export type ClarificationSession = z.infer<typeof ClarificationSessionSchema>;
export type PRD = z.infer<typeof PRDSchema>;

// ============================================================================
// QUESTION TEMPLATES
// ============================================================================

const QUESTION_TEMPLATES: Record<string, ClarificationQuestion[]> = {
  saas: [
    {
      id: "target_audience",
      type: "text",
      question: "Who is your primary target audience?",
      description: "Describe the user persona: role, industry, company size, pain points",
      required: true,
    },
    {
      id: "core_problem",
      type: "text",
      question: "What is the core problem you're solving?",
      description: "One sentence describing the main pain point",
      required: true,
    },
    {
      id: "pricing_model",
      type: "single_choice",
      question: "What pricing model do you envision?",
      options: [
        { value: "freemium", label: "Freemium", description: "Free tier + paid upgrades" },
        { value: "subscription", label: "Subscription", description: "Monthly/annual recurring" },
        { value: "usage", label: "Usage-based", description: "Pay per use/seat/action" },
        { value: "one_time", label: "One-time", description: "Single payment, lifetime access" },
        { value: "enterprise", label: "Enterprise", description: "Custom contracts, sales-led" },
      ],
      required: true,
    },
    {
      id: "multi_tenant",
      type: "boolean",
      question: "Do you need multi-tenancy (organizations/workspaces)?",
      description: "Multiple isolated customer environments in one deployment",
      required: true,
    },
    {
      id: "integrations",
      type: "multi_choice",
      question: "Which third-party integrations are essential?",
      options: [
        { value: "stripe", label: "Stripe", description: "Payments & subscriptions" },
        { value: "github", label: "GitHub", description: "Repositories, issues, actions" },
        { value: "slack", label: "Slack", description: "Notifications, bots, workflows" },
        { value: "linear", label: "Linear", description: "Issue tracking, project management" },
        { value: "notion", label: "Notion", description: "Documentation, wikis" },
        { value: "sendgrid", label: "SendGrid/Resend", description: "Transactional email" },
        { value: "twilio", label: "Twilio", description: "SMS, voice, video" },
        { value: "segment", label: "Segment", description: "Analytics, event tracking" },
      ],
      required: false,
    },
  ],
  marketplace: [
    {
      id: "marketplace_type",
      type: "single_choice",
      question: "What type of marketplace?",
      options: [
        { value: "service", label: "Service Marketplace", description: "Freelancers, gigs, bookings" },
        { value: "product", label: "Product Marketplace", description: "Physical/digital goods" },
        { value: "rental", label: "Rental/Sharing", description: "Equipment, space, vehicles" },
        { value: "hybrid", label: "Hybrid", description: "Multiple types" },
      ],
      required: true,
    },
    {
      id: "payment_flow",
      type: "single_choice",
      question: "How should payments flow?",
      options: [
        { value: "platform", label: "Platform takes commission", description: "Money flows through platform" },
        { value: "direct", label: "Direct peer-to-peer", description: "Platform facilitates only" },
        { value: "escrow", label: "Escrow", description: "Hold funds until delivery" },
      ],
      required: true,
    },
  ],
  dashboard: [
    {
      id: "data_sources",
      type: "multi_choice",
      question: "What data sources need to be visualized?",
      options: [
        { value: "database", label: "PostgreSQL/MySQL", description: "Direct database queries" },
        { value: "api", label: "REST/GraphQL APIs", description: "External or internal APIs" },
        { value: "csv", label: "CSV/Excel Uploads", description: "User-uploaded files" },
        { value: "realtime", label: "Real-time Streams", description: "WebSockets, SSE, MQTT" },
        { value: "warehouse", label: "Data Warehouse", description: "BigQuery, Snowflake, Redshift" },
      ],
      required: true,
    },
    {
      id: "real_time",
      type: "boolean",
      question: "Do you need real-time updates?",
      description: "Live data without refresh (WebSockets, Server-Sent Events)",
      required: true,
    },
  ],
  ai_app: [
    {
      id: "ai_features",
      type: "multi_choice",
      question: "What AI capabilities are needed?",
      options: [
        { value: "chat", label: "Chat/Conversational", description: "LLM chat interface" },
        { value: "completion", label: "Text Completion", description: "Autocomplete, generation" },
        { value: "embedding", label: "Embeddings/Search", description: "Semantic search, RAG" },
        { value: "vision", label: "Vision/Image", description: "Image analysis, generation" },
        { value: "audio", label: "Audio/Voice", description: "STT, TTS, voice chat" },
        { value: "agents", label: "Autonomous Agents", description: "Multi-step task execution" },
        { value: "fine_tune", label: "Fine-tuning", description: "Custom model training" },
      ],
      required: true,
    },
    {
      id: "model_preference",
      type: "single_choice",
      question: "Preferred model strategy?",
      options: [
        { value: "closed", label: "Closed Source (OpenAI, Anthropic)", description: "Best quality, higher cost" },
        { value: "open", label: "Open Source (Llama, Mistral)", description: "Self-hosted, privacy, lower cost" },
        { value: "hybrid", label: "Hybrid", description: "Mix based on task" },
      ],
      required: true,
    },
  ],
};

// ============================================================================
// REQUIREMENT CLARIFIER CLASS
// ============================================================================

export class RequirementClarifier {
  private sessions = new Map<string, ClarificationSession>();

  /**
   * Start a new clarification session
   */
  async startSession(goal: string, projectType?: string): Promise<ClarificationSession> {
    const sessionId = `clarify_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Detect project type from goal if not provided
    const detectedType = projectType || this.detectProjectType(goal);

    // Get base questions for project type
    const baseQuestions = QUESTION_TEMPLATES[detectedType] || [];

    // Generate dynamic questions using AI
    const dynamicQuestions = await this.generateDynamicQuestions(goal, detectedType);

    // Combine and deduplicate
    const allQuestions = this.mergeQuestions(baseQuestions, dynamicQuestions);

    const session: ClarificationSession = {
      id: sessionId,
      goal,
      status: "active",
      questions: allQuestions,
      answers: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.sessions.set(sessionId, session);
    eventEmitter.emit("clarification:session_started", { session });

    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): ClarificationSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Submit answer to a question
   */
  async submitAnswer(sessionId: string, questionId: string, answer: unknown): Promise<{
    session: ClarificationSession;
    nextQuestion: ClarificationQuestion | null;
    isComplete: boolean;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.status !== "active") throw new Error("Session not active");

    const question = session.questions.find(q => q.id === questionId);
    if (!question) throw new Error(`Question ${questionId} not found`);

    // Validate answer
    this.validateAnswer(question, answer);

    // Store answer
    session.answers[questionId] = answer;
    session.updatedAt = new Date();

    // Check for conditional questions to unlock
    this.unlockConditionalQuestions(session, questionId, answer);

    // Find next unanswered question
    const nextQuestion = session.questions.find(
      q => !session.answers.hasOwnProperty(q.id) && this.isQuestionVisible(session, q)
    ) || null;

    const isComplete = !nextQuestion;

    if (isComplete) {
      session.status = "completed";
      session.completedAt = new Date();
      // Generate PRD
      session.prd = await this.generatePRD(session);
      eventEmitter.emit("clarification:completed", { session });
    }

    eventEmitter.emit("clarification:answer_submitted", { session, questionId, answer });

    return { session, nextQuestion, isComplete };
  }

  /**
   * Generate PRD from completed session
   */
  async generatePRD(session: ClarificationSession): Promise<string> {
    const planner = subagents.getSubagent("planner") || subagents.getSubagent("architect");
    if (!planner) throw new Error("Planner/Architect subagent not available");

    const prompt = `
Generate a comprehensive Product Requirements Document (PRD) based on this clarification session.

Goal: ${session.goal}
Answers: ${JSON.stringify(session.answers, null, 2)}

Create a detailed PRD with:
1. Project name & elevator pitch
2. Target audience & core problem
3. Key features with user stories & acceptance criteria (MoSCoW prioritization)
4. User flows
5. Data model (entities, fields, relations)
6. API endpoints
7. Non-functional requirements (performance, security, scalability, accessibility)
8. Constraints (budget, timeline, tech stack, integrations)
9. Risks & mitigations
10. Success metrics

Format as markdown with clear sections. Be specific and actionable.
`;

    const result = await planner.spawn({
      prompt,
      schema: PRDSchema,
    });

    // Convert structured PRD to markdown
    return this.prdToMarkdown(result);
  }

  /**
   * Get PRD for session
   */
  getPRD(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.prd;
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private detectProjectType(goal: string): string {
    const lower = goal.toLowerCase();

    if (lower.includes("marketplace") || lower.includes("two-sided") || lower.includes("platform connecting")) {
      return "marketplace";
    }
    if (lower.includes("dashboard") || lower.includes("analytics") || lower.includes("visualization") || lower.includes("metrics")) {
      return "dashboard";
    }
    if (lower.includes("ai") || lower.includes("llm") || lower.includes("chatbot") || lower.includes("agent") || lower.includes("rag")) {
      return "ai_app";
    }
    // Default to SaaS
    return "saas";
  }

  private async generateDynamicQuestions(goal: string, projectType: string): Promise<ClarificationQuestion[]> {
    const planner = subagents.getSubagent("planner") || subagents.getSubagent("architect");
    if (!planner) return [];

    const prompt = `
Based on this project goal and type, generate 3-5 additional clarifying questions that would help reduce ambiguity.
Focus on aspects NOT covered by standard ${projectType} questions.

Goal: ${goal}
Project Type: ${projectType}

Return JSON array of questions with this schema:
{
  "id": "unique_id",
  "type": "single_choice|multi_choice|text|number|boolean|scale",
  "question": "Question text",
  "description": "Optional help text",
  "options": [{"value": "...", "label": "...", "description": "..."}], // for choice types
  "required": true/false,
  "validation": {"min": 0, "max": 100, "pattern": "^...$"} // optional
}
`;

    try {
      const result = await planner.spawn({
        prompt,
        schema: z.array(ClarificationQuestionSchema).max(5),
      });
      return result;
    } catch {
      return [];
    }
  }

  private mergeQuestions(base: ClarificationQuestion[], dynamic: ClarificationQuestion[]): ClarificationQuestion[] {
    const merged = [...base];
    const baseIds = new Set(base.map(q => q.id));

    for (const q of dynamic) {
      if (!baseIds.has(q.id)) {
        merged.push(q);
      }
    }

    return merged;
  }

  private validateAnswer(question: ClarificationQuestion, answer: unknown): void {
    if (question.required && (answer === undefined || answer === null || answer === "")) {
      throw new Error(`Question ${question.id} is required`);
    }

    if (question.validation) {
      const { min, max, pattern } = question.validation;

      if (typeof answer === "number") {
        if (min !== undefined && answer < min) throw new Error(`Value must be >= ${min}`);
        if (max !== undefined && answer > max) throw new Error(`Value must be <= ${max}`);
      }

      if (typeof answer === "string" && pattern) {
        const regex = new RegExp(pattern);
        if (!regex.test(answer)) throw new Error(`Value does not match required pattern`);
      }
    }

    if (question.type === "single_choice" && question.options) {
      const validValues = question.options.map(o => o.value);
      if (!validValues.includes(answer as string)) {
        throw new Error(`Invalid option. Must be one of: ${validValues.join(", ")}`);
      }
    }

    if (question.type === "multi_choice" && question.options) {
      const validValues = question.options.map(o => o.value);
      const answers = (answer as string[] || []);
      for (const a of answers) {
        if (!validValues.includes(a)) {
          throw new Error(`Invalid option: ${a}. Must be from: ${validValues.join(", ")}`);
        }
      }
    }
  }

  private unlockConditionalQuestions(session: ClarificationSession, answeredQuestionId: string, answer: unknown): void {
    for (const question of session.questions) {
      if (question.dependsOn?.questionId === answeredQuestionId) {
        const expectedValue = question.dependsOn.value;
        const actualValue = Array.isArray(answer) ? answer.includes(expectedValue) : answer === expectedValue;

        // The question is now visible if condition matches
        // (visibility is checked in isQuestionVisible)
      }
    }
  }

  private isQuestionVisible(session: ClarificationSession, question: ClarificationQuestion): boolean {
    if (!question.dependsOn) return true;

    const answer = session.answers[question.dependsOn.questionId];
    if (answer === undefined) return false;

    if (Array.isArray(answer)) {
      return answer.includes(question.dependsOn.value);
    }
    return answer === question.dependsOn.value;
  }

  private prdToMarkdown(prd: PRD): string {
    let md = `# ${prd.projectName}\n\n`;
    md += `## Elevator Pitch\n${prd.elevatorPitch}\n\n`;
    md += `## Target Audience\n${prd.targetAudience}\n\n`;
    md += `## Core Problem\n${prd.coreProblem}\n\n`;

    md += `## Key Features\n\n`;
    for (const feature of prd.keyFeatures) {
      md += `### ${feature.title} [${feature.priority.toUpperCase()}]\n`;
      md += `${feature.description}\n\n`;
      md += `**User Story:** ${feature.userStory}\n\n`;
      md += `**Acceptance Criteria:**\n`;
      for (const ac of feature.acceptanceCriteria) {
        md += `- ${ac}\n`;
      }
      if (feature.technicalNotes) {
        md += `\n**Technical Notes:** ${feature.technicalNotes}\n`;
      }
      md += `\n`;
    }

    md += `## User Flows\n\n`;
    for (const flow of prd.userFlows) {
      md += `### ${flow.name}\n`;
      md += `**Entry:** ${flow.entryPoints.join(", ")}\n`;
      md += `**Steps:**\n`;
      for (const step of flow.steps) {
        md += `1. ${step}\n`;
      }
      md += `**Exit:** ${flow.exitPoints.join(", ")}\n\n`;
    }

    md += `## Data Model\n\n`;
    for (const entity of prd.dataModel) {
      md += `### ${entity.entity}\n`;
      md += `| Field | Type | Required | Description |\n`;
      md += `|-------|------|----------|-------------|\n`;
      for (const field of entity.fields) {
        md += `| ${field.name} | ${field.type} | ${field.required ? "Yes" : "No"} | ${field.description || ""} |\n`;
      }
      if (entity.fields.some(f => f.relations && f.relations!.length > 0)) {
        md += `\n**Relations:**\n`;
        for (const field of entity.fields) {
          if (field.relations && field.relations.length > 0) {
            md += `- ${field.name} → ${field.relations.join(", ")}\n`;
          }
        }
      }
      md += `\n`;
    }

    md += `## API Endpoints\n\n`;
    md += `| Method | Path | Description | Auth |\n`;
    md += `|--------|------|-------------|------|\n`;
    for (const endpoint of prd.apiEndpoints) {
      md += `| ${endpoint.method} | ${endpoint.path} | ${endpoint.description} | ${endpoint.auth ? "Yes" : "No"} |\n`;
    }
    md += `\n`;

    if (prd.nonFunctionalRequirements) {
      md += `## Non-Functional Requirements\n\n`;
      for (const [category, items] of Object.entries(prd.nonFunctionalRequirements)) {
        if (items && items.length > 0) {
          md += `### ${category.charAt(0).toUpperCase() + category.slice(1)}\n`;
          for (const item of items) {
            md += `- ${item}\n`;
          }
          md += `\n`;
        }
      }
    }

    if (prd.constraints) {
      md += `## Constraints\n\n`;
      for (const [key, value] of Object.entries(prd.constraints)) {
        if (value) {
          md += `- **${key}:** ${value}\n`;
        }
      }
      md += `\n`;
    }

    if (prd.risks && prd.risks.length > 0) {
      md += `## Risks & Mitigations\n\n`;
      md += `| Risk | Likelihood | Impact | Mitigation |\n`;
      md += `|------|------------|--------|------------|\n`;
      for (const risk of prd.risks) {
        md += `| ${risk.risk} | ${risk.likelihood} | ${risk.impact} | ${risk.mitigation} |\n`;
      }
      md += `\n`;
    }

    if (prd.successMetrics && prd.successMetrics.length > 0) {
      md += `## Success Metrics\n\n`;
      md += `| Metric | Target | Measurement |\n`;
      md += `|--------|--------|-------------|\n`;
      for (const metric of prd.successMetrics) {
        md += `| ${metric.metric} | ${metric.target} | ${metric.measurement} |\n`;
      }
      md += `\n`;
    }

    return md;
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const requirementClarifier = new RequirementClarifier();