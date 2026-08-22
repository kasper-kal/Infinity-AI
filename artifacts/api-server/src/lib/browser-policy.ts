/**
 * Browser Safety Policy Engine (Security Issue 5)
 *
 * Replaces regex-only URL protection with a comprehensive policy system:
 * - ActionClassifier: categorizes browser actions by type
 * - ElementAnalyzer: inspects target elements for sensitive fields
 * - SensitiveDomainRegistry: maintains domain list with dynamic additions
 * - PolicyEngine: evaluates action + context → ALLOW | DENY | REQUIRE_APPROVAL
 */

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type BrowserActionType =
  | "NAVIGATE"
  | "CLICK"
  | "TYPE"
  | "FORM_SUBMIT"
  | "DOWNLOAD"
  | "SCRIPT_EXECUTE"
  | "SCROLL"
  | "BACK"
  | "FORWARD"
  | "CLOSE"
  | "UNKNOWN";

export type PolicyDecision = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

export interface ActionContext {
  url?: string;
  domain?: string;
  element?: ElementInfo;
  formAction?: string;
  formMethod?: string;
  referrer?: string;
  userInitiated?: boolean; // true if human triggered (double-tap takeover)
}

export interface ElementInfo {
  tag: string;
  type?: string;
  autocomplete?: string;
  name?: string;
  id?: string;
  role?: string;
  href?: string;
  isPasswordField: boolean;
  isCreditCardField: boolean;
  isSensitiveInput: boolean;
  outerHTML?: string;
}

export interface PolicyRule {
  action: BrowserActionType | "*";
  domains?: string[]; // if empty, applies to all
  elementTypes?: string[]; // e.g., ["password", "credit-card"]
  decision: PolicyDecision;
  priority: number; // higher = more specific wins
  reason: string;
}

export interface ClassificationResult {
  actionType: BrowserActionType;
  confidence: number;
  details: string;
}

export interface PolicyEvaluationResult {
  decision: PolicyDecision;
  matchedRule?: PolicyRule;
  reason: string;
  requiresHumanConfirmation: boolean;
}

// ──────────────────────────────────────────────────────────────────────────────
// SensitiveDomainRegistry
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Maintains a list of sensitive domains with dynamic additions.
 * Does NOT rely solely on domain matching — used as one signal in PolicyEngine.
 */
export class SensitiveDomainRegistry {
  private static instance: SensitiveDomainRegistry;
  private domains: Set<string> = new Set();
  private categories: Map<string, Set<string>> = new Map();

  private constructor() {
    this.loadDefaults();
  }

  static getInstance(): SensitiveDomainRegistry {
    if (!SensitiveDomainRegistry.instance) {
      SensitiveDomainRegistry.instance = new SensitiveDomainRegistry();
    }
    return SensitiveDomainRegistry.instance;
  }

  private loadDefaults(): void {
    // Payment processors
    this.addCategory("payment", [
      "stripe.com",
      "paypal.com",
      "square.com",
      "braintreegateway.com",
      "adyen.com",
      "checkout.com",
      "worldpay.com",
      "authorize.net",
      "2checkout.com",
      "paymill.com",
      "mollie.com",
      "paddle.com",
      "fast.spring.com",
      "gumroad.com",
      "paddle.com",
      "recurly.com",
      "chargebee.com",
      "zuora.com",
    ]);

    // Banking & financial
    this.addCategory("banking", [
      "chase.com",
      "bankofamerica.com",
      "wellsfargo.com",
      "citibank.com",
      "capitalone.com",
      "americanexpress.com",
      "discover.com",
      "barclays.com",
      "hsbc.com",
      "tdbank.com",
      "usbank.com",
      "pnc.com",
      "truist.com",
      "fifththird.com",
      "keybank.com",
      "citizensbank.com",
      "regions.com",
      "mtb.com",
      "huntington.com",
      "firstcitizens.com",
      "websterbank.com",
      "providentbank.com",
      "valley.com",
      "bancofamerica.com",
      "santander.com",
      "bbva.com",
      "ing.com",
      "deutsche-bank.com",
      "commerzbank.de",
      "bnpparibas.com",
      "credit-suisse.com",
      "ubs.com",
      "jpmorgan.com",
      "morganstanley.com",
      "goldmansachs.com",
    ]);

    // Crypto exchanges & wallets
    this.addCategory("crypto", [
      "coinbase.com",
      "binance.com",
      "kraken.com",
      "gemini.com",
      "bitstamp.net",
      "bitfinex.com",
      "bybit.com",
      "okx.com",
      "kucoin.com",
      "huobi.com",
      "gate.io",
      "crypto.com",
      "blockchain.com",
      "exodus.com",
      "metamask.io",
      "phantom.app",
      "walletconnect.com",
      "ledger.com",
      "trezor.io",
      "safepal.com",
      "trustwallet.com",
      "coinomi.com",
      "atomicwallet.io",
      "electrum.org",
      "wasabiwallet.io",
      "samouraiwallet.com",
    ]);

    // Government & identity
    this.addCategory("government", [
      "gov",
      "gov.uk",
      "gov.au",
      "gov.ca",
      "gov.br",
      "gob.mx",
      "gouv.fr",
      "bund.de",
      "gov.it",
      "gov.es",
      "gov.pl",
      "gov.nl",
      "gov.be",
      "gov.pt",
      "gov.gr",
      "gov.ie",
      "gov.nz",
      "gov.sg",
      "gov.hk",
      "gov.tw",
      "gov.jp",
      "go.kr",
      "irs.gov",
      "ssa.gov",
      "medicare.gov",
      "va.gov",
      "uscis.gov",
      "dmv.",
      "secretaryofstate.",
      "tax.",
      "revenue.",
    ]);

    // Email providers (credential theft targets)
    this.addCategory("email", [
      "gmail.com",
      "outlook.com",
      "hotmail.com",
      "yahoo.com",
      "protonmail.com",
      "tutanota.com",
      "fastmail.com",
      "zoho.com",
      "icloud.com",
      "aol.com",
      "gmx.com",
      "mail.com",
      "yandex.com",
      "mail.ru",
      "qq.com",
      "163.com",
      "126.com",
      "sina.com",
      "sohu.com",
    ]);

    // Social media (account takeover targets)
    this.addCategory("social", [
      "facebook.com",
      "instagram.com",
      "twitter.com",
      "x.com",
      "linkedin.com",
      "tiktok.com",
      "snapchat.com",
      "pinterest.com",
      "reddit.com",
      "discord.com",
      "telegram.org",
      "whatsapp.com",
      "signal.org",
      "slack.com",
      "teams.microsoft.com",
      "zoom.us",
      "github.com",
      "gitlab.com",
      "bitbucket.org",
    ]);

    // Cloud & hosting (infrastructure access)
    this.addCategory("cloud", [
      "aws.amazon.com",
      "console.aws.amazon.com",
      "cloud.google.com",
      "console.cloud.google.com",
      "portal.azure.com",
      "digitalocean.com",
      "cloud.digitalocean.com",
      "linode.com",
      "vultr.com",
      "heroku.com",
      "dashboard.heroku.com",
      "vercel.com",
      "netlify.com",
      "railway.app",
      "render.com",
      "fly.io",
      "cloudflare.com",
      "dash.cloudflare.com",
    ]);

    // Auth providers
    this.addCategory("auth", [
      "auth0.com",
      "okta.com",
      "auth.atlassian.com",
      "login.microsoftonline.com",
      "accounts.google.com",
      "appleid.apple.com",
      "id.heroku.com",
      "auth.docker.io",
      "auth.github.com",
      "auth.gitlab.com",
    ]);
  }

  addCategory(category: string, domains: string[]): void {
    if (!this.categories.has(category)) {
      this.categories.set(category, new Set());
    }
    const catSet = this.categories.get(category)!;
    for (const domain of domains) {
      catSet.add(domain.toLowerCase());
      this.domains.add(domain.toLowerCase());
    }
  }

  addDomain(domain: string, category?: string): void {
    const normalized = domain.toLowerCase();
    this.domains.add(normalized);
    if (category) {
      if (!this.categories.has(category)) {
        this.categories.set(category, new Set());
      }
      this.categories.get(category)!.add(normalized);
    }
  }

  removeDomain(domain: string): void {
    const normalized = domain.toLowerCase();
    this.domains.delete(normalized);
    for (const catSet of this.categories.values()) {
      catSet.delete(normalized);
    }
  }

  isSensitive(domain: string): boolean {
    const normalized = domain.toLowerCase();
    if (this.domains.has(normalized)) return true;

    // Check suffix matches (e.g., "*.stripe.com")
    for (const sensitive of this.domains) {
      if (sensitive.startsWith("*.")) {
        const suffix = sensitive.slice(2);
        if (normalized === suffix || normalized.endsWith("." + suffix)) {
          return true;
        }
      } else if (normalized.endsWith("." + sensitive) || normalized === sensitive) {
        return true;
      }
    }
    return false;
  }

  getCategory(domain: string): string | null {
    const normalized = domain.toLowerCase();
    for (const [category, domains] of this.categories) {
      if (domains.has(normalized)) return category;
      for (const d of domains) {
        if (d.startsWith("*.")) {
          const suffix = d.slice(2);
          if (normalized === suffix || normalized.endsWith("." + suffix)) {
            return category;
          }
        } else if (normalized.endsWith("." + d) || normalized === d) {
          return category;
        }
      }
    }
    return null;
  }

  getAllDomains(): string[] {
    return Array.from(this.domains);
  }

  getCategories(): string[] {
    return Array.from(this.categories.keys());
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// ElementAnalyzer
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Inspects target elements for sensitive field indicators.
 * Runs in browser context via Puppeteer evaluate.
 */
export class ElementAnalyzer {
  /**
   * Analyzes an element for sensitive input characteristics.
   * Call this from Puppeteer page.evaluate() with the element handle.
   */
  static analyze(element: any): ElementInfo {
    const tag = (element.tagName || "").toLowerCase();
    const type = (element.type || "").toLowerCase();
    const autocomplete = (element.autocomplete || "").toLowerCase();
    const name = (element.name || "").toLowerCase();
    const id = (element.id || "").toLowerCase();
    const role = (element.getAttribute?.("role") || "").toLowerCase();
    const href = (element.href || "").toLowerCase();

    // Password field detection
    const isPasswordField =
      type === "password" ||
      autocomplete.includes("current-password") ||
      autocomplete.includes("new-password") ||
      name.includes("password") ||
      id.includes("password") ||
      (tag === "input" && element.getAttribute("type") === "password");

    // Credit card field detection
    const isCreditCardField =
      autocomplete.includes("cc-") ||
      autocomplete.includes("credit-card") ||
      name.includes("card") ||
      name.includes("ccnum") ||
      name.includes("cvv") ||
      name.includes("cvc") ||
      id.includes("card") ||
      id.includes("ccnum") ||
      id.includes("cvv") ||
      id.includes("cvc") ||
      (tag === "input" && /\b(card|cc|credit)\b/i.test(name + id));

    // General sensitive input detection
    const sensitiveAutocomplete = [
      "cc-",
      "credit-card",
      "current-password",
      "new-password",
      "one-time-code",
      "otp",
      "pin",
      "ssn",
      "social-security",
      "tax-id",
      "national-id",
      "passport",
      "driver-license",
      "iban",
      "swift",
      "routing",
      "account-number",
      "security-code",
      "cvc",
      "cvv",
      "expiration",
      "exp-date",
      "cardholder",
    ];

    const isSensitiveInput =
      isPasswordField ||
      isCreditCardField ||
      sensitiveAutocomplete.some((ac) => autocomplete.includes(ac)) ||
      ["password", "secret", "token", "key", "private", "mnemonic", "seed", "recovery"].some(
        (s) => name.includes(s) || id.includes(s)
      );

    return {
      tag,
      type: type || undefined,
      autocomplete: autocomplete || undefined,
      name: name || undefined,
      id: id || undefined,
      role: role || undefined,
      href: href || undefined,
      isPasswordField,
      isCreditCardField,
      isSensitiveInput,
      outerHTML: element.outerHTML?.slice(0, 500),
    };
  }

  /**
   * Analyzes a form element for sensitive action targets.
   */
  static analyzeForm(form: any): { action: string; method: string; hasSensitiveFields: boolean } {
    const action = (form.action || "").toLowerCase();
    const method = (form.method || "get").toLowerCase();

    // Check if form submits to sensitive domains
    const sensitiveActionDomains = [
      "stripe.com",
      "paypal.com",
      "braintreegateway.com",
      "checkout.com",
      "authorize.net",
      "payment",
      "billing",
      "checkout",
      "purchase",
      "subscribe",
      "donate",
    ];

    const hasSensitiveAction = sensitiveActionDomains.some((d) => action.includes(d));

    // Check form fields
    const inputs = form.querySelectorAll?.("input, textarea, select") || [];
    let hasSensitiveFields = hasSensitiveAction;
    for (const input of inputs) {
      const info = this.analyze(input);
      if (info.isSensitiveInput) {
        hasSensitiveFields = true;
        break;
      }
    }

    return { action, method, hasSensitiveFields };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// ActionClassifier
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Classifies browser actions by type based on action data and context.
 */
export class ActionClassifier {
  /**
   * Classify a browser action from the action object and optional context.
   */
  static classify(action: any, context?: ActionContext): ClassificationResult {
    const actionName = (action?.action || "").toString().toLowerCase();

    // Navigate actions
    if (actionName === "navigate" || actionName === "goto") {
      return {
        actionType: "NAVIGATE",
        confidence: 1.0,
        details: `Navigation to ${action?.payload || context?.url || "unknown URL"}`,
      };
    }

    // Click actions
    if (actionName === "click") {
      const payload = action?.payload || {};
      // Check if clicking a link (navigation-like)
      if (payload?.selector?.includes("a[") || context?.element?.tag === "a") {
        return {
          actionType: "CLICK",
          confidence: 0.9,
          details: `Click on link: ${context?.element?.href || payload?.selector || "unknown"}`,
        };
      }
      // Check if clicking a submit button
      if (
        payload?.selector?.includes('type="submit"') ||
        payload?.selector?.includes('[type="submit"]') ||
        context?.element?.type === "submit" ||
        context?.element?.tag === "button"
      ) {
        return {
          actionType: "FORM_SUBMIT",
          confidence: 0.85,
          details: `Click on form submit button`,
        };
      }
      // Check if clicking a download link
      if (context?.element?.href?.match(/\.(pdf|zip|exe|dmg|pkg|deb|rpm|msi|apk|iso|img)$/i)) {
        return {
          actionType: "DOWNLOAD",
          confidence: 0.8,
          details: `Click on download link: ${context?.element?.href}`,
        };
      }
      return {
        actionType: "CLICK",
        confidence: 0.9,
        details: `Click on element: ${payload?.selector || "coordinates"}`,
      };
    }

    // Type actions
    if (actionName === "type" || actionName === "input") {
      const element = context?.element;
      if (element?.isPasswordField) {
        return {
          actionType: "TYPE",
          confidence: 1.0,
          details: `Type into password field`,
        };
      }
      if (element?.isCreditCardField) {
        return {
          actionType: "TYPE",
          confidence: 1.0,
          details: `Type into credit card field`,
        };
      }
      if (element?.isSensitiveInput) {
        return {
          actionType: "TYPE",
          confidence: 0.95,
          details: `Type into sensitive input field`,
        };
      }
      return {
        actionType: "TYPE",
        confidence: 0.9,
        details: `Type into field: ${element?.name || element?.id || element?.type || "unknown"}`,
      };
    }

    // Form submit (explicit)
    if (actionName === "submit" || actionName === "form_submit") {
      return {
        actionType: "FORM_SUBMIT",
        confidence: 1.0,
        details: `Form submission to ${context?.formAction || "unknown action"}`,
      };
    }

    // Download actions
    if (actionName === "download" || actionName === "save") {
      return {
        actionType: "DOWNLOAD",
        confidence: 1.0,
        details: `Download: ${action?.payload || "unknown"}`,
      };
    }

    // Script execution
    if (actionName === "evaluate" || actionName === "script" || actionName === "execute_script") {
      return {
        actionType: "SCRIPT_EXECUTE",
        confidence: 1.0,
        details: `Script execution: ${action?.payload?.slice(0, 100) || "unknown"}`,
      };
    }

    // Scroll
    if (actionName === "scroll") {
      return {
        actionType: "SCROLL",
        confidence: 1.0,
        details: `Scroll: dx=${action?.payload?.dx || 0}, dy=${action?.payload?.dy || 0}`,
      };
    }

    // Navigation history
    if (actionName === "back") {
      return {
        actionType: "BACK",
        confidence: 1.0,
        details: "Navigate back",
      };
    }
    if (actionName === "forward") {
      return {
        actionType: "FORWARD",
        confidence: 1.0,
        details: "Navigate forward",
      };
    }

    // Close
    if (actionName === "close") {
      return {
        actionType: "CLOSE",
        confidence: 1.0,
        details: "Close browser/tab",
      };
    }

    return {
      actionType: "UNKNOWN",
      confidence: 0.5,
      details: `Unknown action: ${actionName}`,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// PolicyEngine
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Policy engine that evaluates actions against rules and context.
 * Returns ALLOW | DENY | REQUIRE_APPROVAL with reasoning.
 */
export class PolicyEngine {
  private rules: PolicyRule[] = [];
  private domainRegistry: SensitiveDomainRegistry;
  private defaultDecision: PolicyDecision = "ALLOW";

  constructor(domainRegistry?: SensitiveDomainRegistry) {
    this.domainRegistry = domainRegistry || SensitiveDomainRegistry.getInstance();
    this.loadDefaultRules();
  }

  private loadDefaultRules(): void {
    // Highest priority: Explicit DENY rules
    this.rules.push(
      // Block navigation to chrome:// and browser-internal
      {
        action: "NAVIGATE",
        decision: "DENY",
        priority: 100,
        reason: "Browser-internal pages are never legitimate targets",
      },
      // Block script execution on sensitive domains
      {
        action: "SCRIPT_EXECUTE",
        domains: this.domainRegistry.getAllDomains(),
        decision: "DENY",
        priority: 90,
        reason: "Script execution on sensitive domains prohibited",
      },
      // Block downloads from sensitive domains
      {
        action: "DOWNLOAD",
        domains: this.domainRegistry.getAllDomains(),
        decision: "DENY",
        priority: 85,
        reason: "Downloads from sensitive domains prohibited",
      }
    );

    // High priority: REQUIRE_APPROVAL for sensitive interactions
    this.rules.push(
      // Form submission to sensitive domains
      {
        action: "FORM_SUBMIT",
        domains: this.domainRegistry.getAllDomains(),
        decision: "REQUIRE_APPROVAL",
        priority: 80,
        reason: "Form submission to sensitive domain requires human confirmation",
      },
      // Form submission with sensitive fields
      {
        action: "FORM_SUBMIT",
        elementTypes: ["password", "credit-card"],
        decision: "REQUIRE_APPROVAL",
        priority: 75,
        reason: "Form contains sensitive fields (password/credit card)",
      },
      // Typing into password fields
      {
        action: "TYPE",
        elementTypes: ["password"],
        decision: "REQUIRE_APPROVAL",
        priority: 70,
        reason: "Typing into password field requires human confirmation",
      },
      // Typing into credit card fields
      {
        action: "TYPE",
        elementTypes: ["credit-card"],
        decision: "REQUIRE_APPROVAL",
        priority: 70,
        reason: "Typing into credit card field requires human confirmation",
      },
      // Typing into any sensitive input
      {
        action: "TYPE",
        elementTypes: ["sensitive"],
        decision: "REQUIRE_APPROVAL",
        priority: 65,
        reason: "Typing into sensitive input field requires human confirmation",
      },
      // Click on sensitive domain links
      {
        action: "CLICK",
        domains: this.domainRegistry.getAllDomains(),
        decision: "REQUIRE_APPROVAL",
        priority: 60,
        reason: "Navigation to sensitive domain via click requires confirmation",
      }
    );

    // Medium priority: Allow known safe patterns
    this.rules.push(
      // Allow navigation to non-sensitive domains
      {
        action: "NAVIGATE",
        decision: "ALLOW",
        priority: 10,
        reason: "Navigation to non-sensitive domain allowed",
      },
      // Allow clicks on non-sensitive elements
      {
        action: "CLICK",
        decision: "ALLOW",
        priority: 10,
        reason: "Click on non-sensitive element allowed",
      },
      // Allow typing in non-sensitive fields
      {
        action: "TYPE",
        decision: "ALLOW",
        priority: 10,
        reason: "Typing in non-sensitive field allowed",
      },
      // Allow scrolling
      {
        action: "SCROLL",
        decision: "ALLOW",
        priority: 10,
        reason: "Scrolling allowed",
      },
      // Allow back/forward/close
      {
        action: "BACK",
        decision: "ALLOW",
        priority: 10,
        reason: "History navigation allowed",
      },
      {
        action: "FORWARD",
        decision: "ALLOW",
        priority: 10,
        reason: "History navigation allowed",
      },
      {
        action: "CLOSE",
        decision: "ALLOW",
        priority: 10,
        reason: "Close browser allowed",
      }
    );

    // Sort by priority (highest first)
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Add a custom policy rule.
   */
  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Remove a rule by reason (for testing/updates).
   */
  removeRule(reason: string): void {
    this.rules = this.rules.filter((r) => r.reason !== reason);
  }

  /**
   * Evaluate an action against the policy rules.
   */
  evaluate(
    classification: ClassificationResult,
    context: ActionContext
  ): PolicyEvaluationResult {
    const actionType = classification.actionType;
    const domain = context.domain || (context.url ? new URL(context.url).hostname : "");
    const element = context.element;

    // Determine element type for rule matching
    let elementType: string | null = null;
    if (element) {
      if (element.isPasswordField) elementType = "password";
      else if (element.isCreditCardField) elementType = "credit-card";
      else if (element.isSensitiveInput) elementType = "sensitive";
    }

    // Check each rule in priority order
    for (const rule of this.rules) {
      // Match action type
      if (rule.action !== "*" && rule.action !== actionType) continue;

      // Match domain
      if (rule.domains && rule.domains.length > 0) {
        const domainMatches = rule.domains.some((d) => {
          const normalized = d.toLowerCase();
          if (normalized.startsWith("*.")) {
            const suffix = normalized.slice(2);
            return domain === suffix || domain.endsWith("." + suffix);
          }
          return domain === normalized || domain.endsWith("." + normalized);
        });
        if (!domainMatches) continue;
      }

      // Match element type
      if (rule.elementTypes && rule.elementTypes.length > 0) {
        if (!elementType || !rule.elementTypes.includes(elementType)) continue;
      }

      // Rule matched!
      const requiresHumanConfirmation = rule.decision === "REQUIRE_APPROVAL";
      return {
        decision: rule.decision,
        matchedRule: rule,
        reason: rule.reason,
        requiresHumanConfirmation,
      };
    }

    // No rule matched - use default
    return {
      decision: this.defaultDecision,
      reason: "No matching rule, using default policy",
      requiresHumanConfirmation: false,
    };
  }

  /**
   * Get all rules (for debugging/inspection).
   */
  getRules(): PolicyRule[] {
    return [...this.rules];
  }

  /**
   * Set default decision for unmatched actions.
   */
  setDefaultDecision(decision: PolicyDecision): void {
    this.defaultDecision = decision;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// BrowserPolicy - Main exported class combining all components
// ──────────────────────────────────────────────────────────────────────────────

export interface BrowserPolicyConfig {
  domainRegistry?: SensitiveDomainRegistry;
  customRules?: PolicyRule[];
  defaultDecision?: PolicyDecision;
  logEvaluations?: boolean;
}

export interface PolicyCheckResult {
  allowed: boolean;
  decision: PolicyDecision;
  reason: string;
  requiresHumanConfirmation: boolean;
  classification: ClassificationResult;
}

/**
 * Main browser policy interface. Use this to check actions before execution.
 */
export class BrowserPolicy {
  private classifier: ActionClassifier;
  private analyzer: ElementAnalyzer;
  private engine: PolicyEngine;
  private domainRegistry: SensitiveDomainRegistry;
  private logEvaluations: boolean;

  constructor(config: BrowserPolicyConfig = {}) {
    this.domainRegistry = config.domainRegistry || SensitiveDomainRegistry.getInstance();
    this.classifier = new ActionClassifier();
    this.analyzer = new ElementAnalyzer();
    this.engine = new PolicyEngine(this.domainRegistry);
    this.logEvaluations = config.logEvaluations ?? true;

    if (config.customRules) {
      for (const rule of config.customRules) {
        this.engine.addRule(rule);
      }
    }
    if (config.defaultDecision) {
      this.engine.setDefaultDecision(config.defaultDecision);
    }
  }

  /**
   * Check if an action is allowed before executing.
   * This is the main entry point for browser-pool.ts integration.
   */
  async checkAction(
    action: any,
    context: ActionContext = {}
  ): Promise<PolicyCheckResult> {
    // Classify the action
    const classification = ActionClassifier.classify(action, context);

    // Evaluate against policy
    const evaluation = this.engine.evaluate(classification, context);

    const result: PolicyCheckResult = {
      allowed: evaluation.decision !== "DENY",
      decision: evaluation.decision,
      reason: evaluation.reason,
      requiresHumanConfirmation: evaluation.requiresHumanConfirmation,
      classification,
    };

    // Log for audit
    if (this.logEvaluations) {
      console.log(
        `[BrowserPolicy] ${classification.actionType} → ${evaluation.decision}: ${evaluation.reason} ${
          evaluation.requiresHumanConfirmation ? "(REQUIRES HUMAN CONFIRMATION)" : ""
        }`
      );
    }

    return result;
  }

  /**
   * Analyze an element from the browser context.
   * Call with element handle from Puppeteer.
   */
  analyzeElement(element: any): ElementInfo {
    return ElementAnalyzer.analyze(element);
  }

  /**
   * Analyze a form from the browser context.
   */
  analyzeForm(form: any): { action: string; method: string; hasSensitiveFields: boolean } {
    return ElementAnalyzer.analyzeForm(form);
  }

  /**
   * Get the domain registry for direct access.
   */
  getDomainRegistry(): SensitiveDomainRegistry {
    return this.domainRegistry;
  }

  /**
   * Get the policy engine for direct access.
   */
  getEngine(): PolicyEngine {
    return this.engine;
  }

  /**
   * Add a custom rule.
   */
  addRule(rule: PolicyRule): void {
    this.engine.addRule(rule);
  }

  /**
   * Check if a domain is considered sensitive.
   */
  isSensitiveDomain(domain: string): boolean {
    return this.domainRegistry.isSensitive(domain);
  }

  /**
   * Get the category of a domain.
   */
  getDomainCategory(domain: string): string | null {
    return this.domainRegistry.getCategory(domain);
  }
}

// Singleton instance
let browserPolicyInstance: BrowserPolicy | null = null;

/**
 * Get or create the global browser policy instance.
 */
export function getBrowserPolicy(config?: BrowserPolicyConfig): BrowserPolicy {
  if (!browserPolicyInstance) {
    browserPolicyInstance = new BrowserPolicy(config);
  }
  return browserPolicyInstance;
}

/**
 * Set a custom policy instance (for testing).
 */
export function setBrowserPolicy(policy: BrowserPolicy | null): void {
  browserPolicyInstance = policy;
}