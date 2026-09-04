/**
 * Requirement Clarifier — Interactive Discovery for NL → Product Workflow
 *
 * Parses natural language goals and asks targeted questions to reduce ambiguity.
 * Generates a Product Requirements Document (PRD) from user answers.
 */

import { z } from "zod";
import { LLMAdapter, getLLMAdapter } from "./llm-adapter.js";

// ============================================
// Types & Schemas
// ============================================

export const ClarificationQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  type: z.enum(["radio", "multi-select", "text", "number", "boolean"]),
  options: z.array(z.string()).optional(),
  required: z.boolean().default(true),
  category: z.enum(["core", "users", "scale", "integrations", "timeline", "tech", "other"]).default("core"),
  helpText: z.string().optional(),
  dependsOn: z.string().optional(), // Question ID this depends on
  condition: z.object({
    questionId: z.string(),
    value: z.string(),
  }).optional(),
});

export const PRDSchema = z.object({
  projectName: z.string(),
  elevatorPitch: z.string(),
  targetUsers: z.string(),
  coreFeatures: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    priority: z.enum(["must", "should", "could", "wont"]),
    acceptanceCriteria: z.array(z.string()),
  })),
  userFlows: z.array(z.object({
    name: z.string(),
    steps: z.array(z.string()),
    entryPoint: z.string(),
    exitPoint: z.string(),
  })),
  nonFunctionalRequirements: z.object({
    performance: z.string().optional(),
    security: z.string().optional(),
    scalability: z.string().optional(),
    accessibility: z.string().optional(),
    browserSupport: z.string().optional(),
  }),
  technicalConstraints: z.object({
    preferredStack: z.string().optional(),
    forbiddenTech: z.array(z.string()).optional(),
    integrations: z.array(z.string()).optional(),
    dataRequirements: z.string().optional(),
  }),
  timeline: z.object({
    targetLaunch: z.string().optional(),
    milestones: z.array(z.object({
      name: z.string(),
      date: z.string(),
      deliverables: z.array(z.string()),
    })).optional(),
  }),
  budget: z.object({
    maxMonthlyCost: z.number().optional(),
    preferFree: z.boolean().default(true),
  }),
  risks: z.array(z.object({
    risk: z.string(),
    likelihood: z.enum(["low", "medium", "high"]),
    impact: z.enum(["low", "medium", "high"]),
    mitigation: z.string(),
  })).optional(),
  openQuestions: z.array(z.string()).optional(),
});

export type ClarificationQuestion = z.infer<typeof ClarificationQuestionSchema>;
export type PRD = z.infer<typeof PRDSchema>;

// ============================================
// Question Templates by Category
// ============================================

const QUESTION_TEMPLATES: Record<string, ClarificationQuestion[]> = {
  core: [
    {
      id: "core-problem",
      question: "What specific problem does this solve for users?",
      type: "text",
      required: true,
      category: "core",
      helpText: "Describe the pain point in 1-2 sentences",
    },
    {
      id: "core-solution",
      question: "What is the core solution/value proposition?",
      type: "text",
      required: true,
      category: "core",
      helpText: "What does the product actually do?",
    },
    {
      id: "core-scope",
      question: "What is in scope for the MVP vs. future phases?",
      type: "multi-select",
      options: ["User auth", "Dashboard", "Settings", "Notifications", "Payments", "Admin panel", "API", "Mobile app", "Dark mode", "Multi-language"],
      required: false,
      category: "core",
    },
  ],
  users: [
    {
      id: "users-target",
      question: "Who are the primary users?",
      type: "radio",
      options: ["Developers", "Designers", "Product managers", "Business users", "Consumers", "Enterprise teams", "Students", "Other"],
      required: true,
      category: "users",
    },
    {
      id: "users-tech-level",
      question: "What is the technical proficiency of users?",
      type: "radio",
      options: ["Non-technical", "Somewhat technical", "Technical", "Highly technical"],
      required: false,
      category: "users",
    },
    {
      id: "users-volume",
      question: "Expected user volume at launch?",
      type: "radio",
      options: ["< 100", "100 - 1,000", "1,000 - 10,000", "10,000 - 100,000", "100,000+"],
      required: false,
      category: "users",
    },
  ],
  scale: [
    {
      id: "scale-concurrent",
      question: "Expected concurrent users?",
      type: "radio",
      options: ["< 10", "10 - 100", "100 - 1,000", "1,000 - 10,000", "10,000+"],
      required: false,
      category: "scale",
    },
    {
      id: "scale-data",
      question: "Estimated data volume?",
      type: "radio",
      options: ["Small (< 1GB)", "Medium (1-100GB)", "Large (100GB-1TB)", "Very Large (1TB+)"],
      required: false,
      category: "scale",
    },
    {
      id: "scale-realtime",
      question: "Real-time features needed?",
      type: "boolean",
      required: false,
      category: "scale",
    },
  ],
  integrations: [
    {
      id: "integrations-payment",
      question: "Payment processing needed?",
      type: "radio",
      options: ["Stripe", "Lemon Squeezy", "Paddle", "PayPal", "Custom", "None"],
      required: false,
      category: "integrations",
    },
    {
      id: "integrations-external",
      question: "External API integrations required?",
      type: "multi-select",
      options: ["GitHub", "GitLab", "Linear", "Jira", "Slack", "Discord", "Notion", "Google Sheets", "SendGrid", "Twilio", "AWS", "Other"],
      required: false,
      category: "integrations",
    },
    {
      id: "integrations-auth",
      question: "Authentication providers?",
      type: "multi-select",
      options: ["Email/Password", "Google", "GitHub", "Microsoft", "SAML/SSO", "Magic Link", "Passkeys", "None (public)"],
      required: false,
      category: "integrations",
    },
  ],
  timeline: [
    {
      id: "timeline-launch",
      question: "Target launch date?",
      type: "text",
      required: false,
      category: "timeline",
      helpText: "e.g., '2 weeks', 'Q2 2025', 'ASAP'",
    },
    {
      id: "timeline-team",
      question: "Team size for development?",
      type: "radio",
      options: ["Solo", "2-3 people", "4-8 people", "8+ people"],
      required: false,
      category: "timeline",
    },
  ],
  tech: [
    {
      id: "tech-preference",
      question: "Any technology preferences or constraints?",
      type: "multi-select",
      options: ["React/Next.js", "Vue/Nuxt", "Svelte/SvelteKit", "Solid/SolidStart", "Astro", "Remix", "TypeScript required", "Tailwind CSS", "PostgreSQL", "SQLite", "Supabase", "Firebase", "Vercel", "Cloudflare", "No preference"],
      required: false,
      category: "tech",
    },
    {
      id: "tech-existing",
      question: "Existing codebase or repo to extend?",
      type: "boolean",
      required: false,
      category: "tech",
    },
  ],
};

// ============================================
// Requirement Clarifier Class
// ============================================

export class RequirementClarifier {
  private adapter: LLMAdapter;
  private questionTemplates: ClarificationQuestion[];

  constructor(adapter?: LLMAdapter) {
    this.adapter = adapter || getLLMAdapter();
    this.questionTemplates = Object.values(QUESTION_TEMPLATES).flat();
  }

  // ============================================
  // Analyze goal and select relevant questions
  // ============================================

  async analyzeGoal(goal: string): Promise<{
    selectedQuestions: ClarificationQuestion[];
    reasoning: string;
  }> {
    const prompt = `Analyze this project goal and determine which clarification questions are most relevant.

GOAL: "${goal}"

Available question categories:
- core: Problem, solution, scope
- users: Target audience, tech level, volume
- scale: Concurrent users, data volume, real-time needs
- integrations: Payments, external APIs, auth providers
- timeline: Launch date, team size
- tech: Stack preferences, existing codebase

Select up to 5 questions that would most reduce ambiguity for THIS specific goal.
Return JSON:
{
  "questionIds": ["core-problem", "users-target", ...],
  "reasoning": "Why these questions..."
}`;

    const response = await this.adapter.complete({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      maxTokens: 1000,
      responseFormat: { type: "json_object" },
    });

    const result = JSON.parse(response.content);
    const selectedQuestions = this.questionTemplates.filter(q =>
      result.questionIds.includes(q.id)
    );

    return {
      selectedQuestions,
      reasoning: result.reasoning,
    };
  }

  // ============================================
  // Generate PRD from answers
  // ============================================

  async generatePRD(
    goal: string,
    answers: Record<string, any>,
    selectedQuestions: ClarificationQuestion[]
  ): Promise<PRD> {
    const context = selectedQuestions.map(q => ({
      question: q.question,
      answer: answers[q.id],
      category: q.category,
    }));

    const prompt = `Generate a comprehensive Product Requirements Document (PRD) from the goal and user answers.

GOAL: "${goal}"

USER ANSWERS:
${JSON.stringify(context, null, 2)}

Create a detailed PRD with:
1. Project name (catchy, descriptive)
2. Elevator pitch (1-2 sentences)
3. Target users description
4. Core features with priority (must/should/could/wont) and acceptance criteria
5. User flows (key journeys)
6. Non-functional requirements (performance, security, scalability, accessibility)
7. Technical constraints (preferred stack, forbidden tech, integrations)
8. Timeline with milestones
9. Budget constraints
10. Risks and mitigations
11. Open questions remaining

Return as JSON matching the PRD schema.`;

    const response = await this.adapter.complete({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      maxTokens: 4000,
      responseFormat: { type: "json_object" },
    });

    return JSON.parse(response.content);
  }

  // ============================================
  // Interactive Question Flow (for UI)
  // ============================================

  getQuestionFlow(goal: string): ClarificationQuestion[] {
    // Return all questions, UI will filter based on dependencies
    return this.questionTemplates;
  }

  getDependentQuestions(answerId: string, answerValue: string): ClarificationQuestion[] {
    return this.questionTemplates.filter(q =>
      q.dependsOn === answerId && q.condition?.value === answerValue
    );
  }

  // ============================================
  // Validate Answers
  // ============================================

  validateAnswers(questions: ClarificationQuestion[], answers: Record<string, any>): {
    valid: boolean;
    missing: string[];
    errors: Record<string, string>;
  } {
    const missing: string[] = [];
    const errors: Record<string, string> = {};

    for (const q of questions) {
      if (q.required && (answers[q.id] === undefined || answers[q.id] === "")) {
        missing.push(q.id);
      }
      if (q.type === "number" && answers[q.id] !== undefined) {
        const num = Number(answers[q.id]);
        if (isNaN(num)) {
          errors[q.id] = "Must be a number";
        }
      }
    }

    return {
      valid: missing.length === 0 && Object.keys(errors).length === 0,
      missing,
      errors,
    };
  }
}

// ============================================
// Singleton Instance
// ============================================

let clarifierInstance: RequirementClarifier | null = null;

export function getRequirementClarifier(): RequirementClarifier {
  if (!clarifierInstance) {
    clarifierInstance = new RequirementClarifier();
  }
  return clarifierInstance;
}