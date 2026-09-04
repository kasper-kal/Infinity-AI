/**
 * Requirement Clarifier — Phase 37
 *
 * Interactive requirement discovery: Natural language goal → targeted questions → PRD
 * AI asks max 5 questions to reduce ambiguity, generates structured PRD
 */

import { z } from "zod";
import { getLLMAdapter } from "./llm-adapter.js";

// ============================================================================
// Schemas
// ============================================================================

export const ClarificationQuestionSchema = z.object({
  id: z.string(),
  type: z.enum(["radio", "multi_select", "text", "number", "boolean", "scale"]),
  question: z.string(),
  description: z.string().optional(),
  options: z.array(z.object({
    value: z.string(),
    label: z.string(),
    description: z.string().optional(),
    recommended: z.boolean().default(false),
  })).optional(),
  required: z.boolean().default(true),
  dependsOn: z.string().optional(),
  validation: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
    customMessage: z.string().optional(),
  }).optional(),
});

export type ClarificationQuestion = z.infer<typeof ClarificationQuestionSchema>;

export const PRDSchema = z.object({
  id: z.string(),
  goal: z.string(),
  answers: z.record(z.any()),
  requirements: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    priority: z.enum(["must", "should", "could", "wont"]),
    category: z.enum(["functional", "non-functional", "technical", "ui", "security", "performance", "accessibility", "integration"]),
    acceptanceCriteria: z.array(z.string()),
    dependencies: z.array(z.string()).default([]),
    estimatedEffort: z.enum(["xs", "s", "m", "l", "xl"]).optional(),
  })),
  techStack: z.object({
    framework: z.string(),
    database: z.string(),
    auth: z.string(),
    payments: z.string().optional(),
    hosting: z.string(),
    language: z.string().default("typescript"),
    styling: z.string().default("tailwind"),
    testing: z.string().default("vitest"),
    orm: z.string().optional(),
    apiStyle: z.enum(["rest", "graphql", "trpc", "rpc"]).optional(),
  }).optional(),
  userFlows: z.array(z.object({
    id: z.string(),
    name: z.string(),
    steps: z.array(z.string()),
    entryPoints: z.array(z.string()),
    successCriteria: z.string(),
  })).default([]),
  dataModel: z.array(z.object({
    name: z.string(),
    fields: z.array(z.object({
      name: z.string(),
      type: z.string(),
      required: z.boolean(),
      unique: z.boolean().default(false),
      indexed: z.boolean().default(false),
      relation: z.string().optional(),
    })),
  })).default([]),
  apiEndpoints: z.array(z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z.string(),
    description: z.string(),
    auth: z.boolean().default(true),
    requestSchema: z.string().optional(),
    responseSchema: z.string().optional(),
  })).default([]),
  uiComponents: z.array(z.object({
    name: z.string(),
    type: z.enum(["page", "component", "layout", "hook", "utility"]),
    description: z.string(),
    props: z.array(z.string()).default([]),
    dependencies: z.array(z.string()).default([]),
  })).default([]),
  nonFunctionalRequirements: z.object({
    performance: z.array(z.string()).default([]),
    security: z.array(z.string()).default([]),
    accessibility: z.array(z.string()).default([]),
    scalability: z.array(z.string()).default([]),
    reliability: z.array(z.string()).default([]),
    maintainability: z.array(z.string()).default([]),
  }).default({}),
  createdAt: z.number(),
  updatedAt: z.number(),
  version: z.number().default(1),
  approved: z.boolean().default(false),
  approvedAt: z.number().optional(),
  approvedBy: z.string().optional(),
});

export type PRD = z.infer<typeof PRDSchema>;

export const ClarificationSessionSchema = z.object({
  id: z.string(),
  goal: string,
  projectId: string,
  questions: z.array(ClarificationQuestionSchema),
  answers: z.record(z.any()),
  currentQuestionIndex: z.number().default(0),
  status: z.enum(["active", "completed", "abandoned"]).default("active"),
  prd: PRDSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  completedAt: z.number().optional(),
});

export type ClarificationSession = z.infer<typeof ClarificationSessionSchema>;

// ============================================================================
// Question Templates by Domain
// ============================================================================

const DOMAIN_QUESTION_TEMPLATES: Record<string, ClarificationQuestion[]> = {
  saas: [
    {
      id: "target_audience",
      type: "text",
      question: "Who is the primary target audience for this SaaS?",
      description: "e.g., freelancers, small businesses, enterprise teams, developers",
      required: true,
    },
    {
      id: "core_value_prop",
      type: "text",
      question: "What is the core value proposition in one sentence?",
      description: "The primary problem you solve and for whom",
      required: true,
    },
    {
      id: "pricing_model",
      type: "radio",
      question: "What pricing model do you envision?",
      options: [
        { value: "freemium", label: "Freemium", description: "Free tier + paid upgrades", recommended: true },
        { value: "subscription", label: "Subscription", description: "Monthly/annual billing" },
        { value: "usage", label: "Usage-based", description: "Pay per use/seat/action" },
        { value: "one_time", label: "One-time", description: "Lifetime license" },
      ],
      required: true,
    },
    {
      id: "team_size",
      type: "radio",
      question: "What's your expected team size at launch?",
      options: [
        { value: "solo", label: "Solo founder", description: "1 person", recommended: true },
        { value: "small", label: "Small team", description: "2-5 people" },
        { value: "medium", label: "Medium team", description: "6-20 people" },
        { value: "large", label: "Large team", description: "20+ people" },
      ],
      required: false,
    },
  ],
  marketplace: [
    {
      id: "marketplace_type",
      type: "radio",
      question: "What type of marketplace?",
      options: [
        { value: "service", label: "Service marketplace", description: "Freelancers, gig workers", recommended: true },
        { value: "product", label: "Product marketplace", description: "Physical/digital goods" },
        { value: "rental", label: "Rental marketplace", description: "Equipment, space, vehicles" },
        { value: "hybrid", label: "Hybrid", description: "Multiple types" },
      ],
      required: true,
    },
    {
      id: "transaction_flow",
      type: "radio",
      question: "How do transactions work?",
      options: [
        { value: "platform_fee", label: "Platform takes fee", description: "Percentage of each transaction", recommended: true },
        { value: "subscription", label: "Subscription", description: "Sellers pay monthly" },
        { value: "lead_gen", label: "Lead generation", description: "Charge for leads/contacts" },
        { value: "featured", label: "Featured listings", description: "Pay for visibility" },
      ],
      required: true,
    },
  ],
  dashboard: [
    {
      id: "data_sources",
      type: "multi_select",
      question: "What data sources need to be visualized?",
      options: [
        { value: "database", label: "PostgreSQL/MySQL", description: "Direct database queries" },
        { value: "api", label: "REST/GraphQL APIs", description: "External or internal APIs" },
        { value: "files", label: "CSV/Excel/JSON", description: "File uploads" },
        { value: "realtime", label: "Real-time streams", description: "WebSockets, SSE, MQTT" },
        { value: "warehouse", label: "Data warehouse", description: "Snowflake, BigQuery, ClickHouse" },
      ],
      required: true,
    },
    {
      id: "user_roles",
      type: "multi_select",
      question: "What user roles need different views?",
      options: [
        { value: "admin", label: "Admin", description: "Full access, settings" },
        { value: "manager", label: "Manager", description: "Team/department view" },
        { value: "analyst", label: "Analyst", description: "Deep dive, exports" },
        { value: "viewer", label: "Viewer", description: "Read-only dashboards" },
      ],
      required: true,
    },
  ],
  ecommerce: [
    {
      id: "product_type",
      type: "radio",
      question: "What type of products?",
      options: [
        { value: "physical", label: "Physical goods", description: "Shipping, inventory", recommended: true },
        { value: "digital", label: "Digital products", description: "Downloads, licenses" },
        { value: "subscription", label: "Subscriptions", description: "Recurring deliveries" },
        { value: "mixed", label: "Mixed", description: "Multiple types" },
      ],
      required: true,
    },
    {
      id: "inventory_management",
      type: "boolean",
      question: "Do you need inventory management?",
      description: "Stock levels, variants, low-stock alerts",
      required: true,
    },
  ],
  social: [
    {
      id: "content_type",
      type: "multi_select",
      question: "What content types?",
      options: [
        { value: "posts", label: "Text posts", description: "Short/long form" },
        { value: "images", label: "Images", description: "Photo sharing" },
        { value: "video", label: "Video", description: "Short/form video" },
        { value: "live", label: "Live streaming", description: "Real-time broadcasts" },
        { value: "audio", label: "Audio", description: "Podcasts, voice notes" },
      ],
      required: true,
    },
    {
      id: "moderation",
      type: "radio",
      question: "Content moderation approach?",
      options: [
        { value: "ai", label: "AI-first", description: "Automated with human review", recommended: true },
        { value: "community", label: "Community", description: "Reports, voting" },
        { value: "manual", label: "Manual", description: "Team reviews everything" },
        { value: "hybrid", label: "Hybrid", description: "AI + community + manual" },
      ],
      required: true,
    },
  ],
};

// ============================================================================
// Requirement Clarifier Class
// ============================================================================

export class RequirementClarifier {
  private sessions: Map<string, ClarificationSession> = new Map();
  private maxQuestions = 5;

  // ---------------------------------------------------------------------------
  // Session Management
  // ---------------------------------------------------------------------------

  async startSession(goal: string, projectId: string): Promise<ClarificationSession> {
    // Analyze goal to determine domain and generate initial questions
    const domain = await this.detectDomain(goal);
    const templateQuestions = DOMAIN_QUESTION_TEMPLATES[domain] || [];
    const aiQuestions = await this.generateAIQuestions(goal, domain);

    // Combine and deduplicate, limit to maxQuestions
    const allQuestions = [...templateQuestions, ...aiQuestions]
      .filter((q, i, arr) => arr.findIndex(q2 => q2.question === q.question) === i)
      .slice(0, this.maxQuestions)
      .map((q, i) => ({ ...q, id: q.id || `q${i + 1}` }));

    const session: ClarificationSession = {
      id: `clarify_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      goal,
      projectId,
      questions: allQuestions,
      answers: {},
      currentQuestionIndex: 0,
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string): ClarificationSession | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(projectId?: string): ClarificationSession[] {
    const sessions = Array.from(this.sessions.values());
    return projectId ? sessions.filter(s => s.projectId === projectId) : sessions;
  }

  // ---------------------------------------------------------------------------
  // Domain Detection
  // ---------------------------------------------------------------------------

  private async detectDomain(goal: string): Promise<string> {
    const adapter = getLLMAdapter();

    const prompt = `Classify this project goal into ONE domain: "${goal}"

Domains: saas, marketplace, dashboard, ecommerce, social, productivity, devtool, content, fintech, health, education, other

Return ONLY: {"domain": "saas"}`;

    const response = await adapter.chat([
      { role: "system", content: "You are a domain classifier. Output ONLY valid JSON." },
      { role: "user", content: prompt }
    ], { responseFormat: "json_object" });

    const parsed = JSON.parse(response.content);
    return parsed.domain || "saas";
  }

  // ---------------------------------------------------------------------------
  // AI Question Generation
  // ---------------------------------------------------------------------------

  private async generateAIQuestions(goal: string, domain: string): Promise<ClarificationQuestion[]> {
    const adapter = getLLMAdapter();

    const prompt = `Generate 2-3 targeted clarification questions for this goal in the "${domain}" domain: "${goal}"

Focus on aspects NOT covered by standard domain questions. Think about:
- Unique constraints or requirements
- Integration needs
- Compliance/regulatory needs
- Scale/performance requirements
- User experience priorities
- Technical debt tolerance

Return ONLY valid JSON:
{
  "questions": [
    {
      "id": "ai_q1",
      "type": "radio|multi_select|text|number|boolean|scale",
      "question": "Specific question",
      "description": "Why this matters",
      "options": [{"value": "opt1", "label": "Option 1", "description": "...", "recommended": false}],
      "required": true,
      "dependsOn": "q1"
    }
  ]
}`;

    const response = await adapter.chat([
      { role: "system", content: "You are an expert product manager. Output ONLY valid JSON." },
      { role: "user", content: prompt }
    ], { responseFormat: "json_object" });

    const parsed = JSON.parse(response.content);
    return (parsed.questions || []).map((q: any, i: number) => ({
      ...q,
      id: q.id || `ai_q${i + 1}`,
    }));
  }

  // ---------------------------------------------------------------------------
  // Answer Handling
  // ---------------------------------------------------------------------------

  submitAnswer(sessionId: string, questionId: string, answer: any): ClarificationSession | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "active") return null;

    const question = session.questions.find(q => q.id === questionId);
    if (!question) return null;

    // Validate answer
    if (question.required && (answer === undefined || answer === "" || (Array.isArray(answer) && answer.length === 0))) {
      throw new Error(`Question ${questionId} is required`);
    }

    if (question.validation) {
      if (question.validation.min !== undefined && typeof answer === "number" && answer < question.validation.min) {
        throw new Error(question.validation.customMessage || `Value must be at least ${question.validation.min}`);
      }
      if (question.validation.max !== undefined && typeof answer === "number" && answer > question.validation.max) {
        throw new Error(question.validation.customMessage || `Value must be at most ${question.validation.max}`);
      }
      if (question.validation.pattern && typeof answer === "string" && !new RegExp(question.validation.pattern).test(answer)) {
        throw new Error(question.validation.customMessage || "Invalid format");
      }
    }

    session.answers[questionId] = answer;
    session.updatedAt = Date.now();

    // Move to next unanswered question
    const nextIndex = session.questions.findIndex((q, i) =>
      i > session.currentQuestionIndex && !(q.id in session.answers)
    );
    session.currentQuestionIndex = nextIndex >= 0 ? nextIndex : session.questions.length;

    // Check if all required questions answered
    const allRequiredAnswered = session.questions
      .filter(q => q.required)
      .every(q => q.id in session.answers);

    if (allRequiredAnswered || session.currentQuestionIndex >= session.questions.length) {
      session.status = "completed";
      session.completedAt = Date.now();
    }

    return session;
  }

  getCurrentQuestion(sessionId: string): ClarificationQuestion | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "active") return null;

    // Find first unanswered required question
    const unanswered = session.questions.find((q, i) =>
      i >= session.currentQuestionIndex && q.required && !(q.id in session.answers)
    );

    return unanswered || null;
  }

  getProgress(sessionId: string): { answered: number; total: number; percentage: number } {
    const session = this.sessions.get(sessionId);
    if (!session) return { answered: 0, total: 0, percentage: 0 };

    const requiredQuestions = session.questions.filter(q => q.required);
    const answered = requiredQuestions.filter(q => q.id in session.answers).length;

    return {
      answered,
      total: requiredQuestions.length,
      percentage: requiredQuestions.length > 0 ? Math.round((answered / requiredQuestions.length) * 100) : 100,
    };
  }

  // ---------------------------------------------------------------------------
  // PRD Generation
  // ---------------------------------------------------------------------------

  async generatePRD(sessionId: string): Promise<PRD> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");
    if (session.status !== "completed") throw new Error("Session not completed");

    const adapter = getLLMAdapter();

    const prompt = `Create a comprehensive PRD (Product Requirements Document) from this clarification session.

GOAL: "${session.goal}"
ANSWERS: ${JSON.stringify(session.answers, null, 2)}
DOMAIN: ${await this.detectDomain(session.goal)}

Generate a detailed PRD with:
1. Structured requirements with priorities (must/should/could/wont) and categories
2. Acceptance criteria for each requirement
3. Recommended tech stack with rationale
4. User flows with steps and success criteria
5. Data model with entities, fields, relations
6. API endpoints (REST/GraphQL/tRPC)
7. UI components needed
8. Non-functional requirements (performance, security, accessibility, scalability, reliability, maintainability)

Return ONLY valid JSON matching the PRD schema.`;

    const response = await adapter.chat([
      { role: "system", content: "You are an expert product manager creating a PRD. Output ONLY valid JSON." },
      { role: "user", content: prompt }
    ], { responseFormat: "json_object", maxTokens: 16384 });

    const prdData = JSON.parse(response.content);

    const prd: PRD = {
      ...prdData,
      id: prdData.id || `prd_${Date.now()}`,
      goal: session.goal,
      answers: session.answers,
      createdAt: session.createdAt,
      updatedAt: Date.now(),
      version: 1,
      approved: false,
    };

    // Store PRD in session
    session.prd = prd;
    session.updatedAt = Date.now();

    return prd;
  }

  async updatePRD(sessionId: string, updates: Partial<PRD>): Promise<PRD> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.prd) throw new Error("No PRD found for session");

    session.prd = {
      ...session.prd,
      ...updates,
      updatedAt: Date.now(),
      version: session.prd.version + 1,
    };

    return session.prd;
  }

  approvePRD(sessionId: string, approvedBy: string): PRD {
    const session = this.sessions.get(sessionId);
    if (!session || !session.prd) throw new Error("No PRD found for session");

    session.prd.approved = true;
    session.prd.approvedAt = Date.now();
    session.prd.approvedBy = approvedBy;
    session.prd.updatedAt = Date.now();

    return session.prd;
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  exportSession(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");
    return JSON.stringify(session, null, 2);
  }

  importSession(json: string): ClarificationSession {
    const session = JSON.parse(json) as ClarificationSession;
    this.sessions.set(session.id, session);
    return session;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let requirementClarifierInstance: RequirementClarifier | null = null;

export function getRequirementClarifier(): RequirementClarifier {
  if (!requirementClarifierInstance) {
    requirementClarifierInstance = new RequirementClarifier();
  }
  return requirementClarifierInstance;
}

export function resetRequirementClarifier(): void {
  requirementClarifierInstance = null;
}