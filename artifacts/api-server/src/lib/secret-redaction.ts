/**
 * Secret Redaction Utilities
 *
 * Provides functions to redact sensitive information from logs, context, and events.
 * Covers API keys, tokens, passwords, connection strings, and other secrets.
 */

// Common secret patterns
const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string; description: string }> = [
  // OpenAI API keys (sk-...)
  { pattern: /sk-[a-zA-Z0-9]{32,}/g, replacement: "sk-****", description: "OpenAI API key" },

  // Anthropic API keys (sk-ant-...)
  { pattern: /sk-ant-[a-zA-Z0-9_-]{95,}/g, replacement: "sk-ant-****", description: "Anthropic API key" },

  // GitHub tokens (ghp_, gho_, ghu_, ghb_, ghr_, ghs_)
  { pattern: /gh[pousr]_[a-zA-Z0-9]{36,}/g, replacement: "gh*_****", description: "GitHub token" },

  // GitHub App tokens
  { pattern: /ghs_[a-zA-Z0-9]{36,}/g, replacement: "ghs_****", description: "GitHub App token" },

  // GitLab tokens (glpat-...)
  { pattern: /glpat-[a-zA-Z0-9_-]{20,}/g, replacement: "glpat-****", description: "GitLab token" },

  // Generic Bearer tokens
  { pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/gi, replacement: "Bearer ****", description: "Bearer token" },

  // Generic API key patterns (key=value or key: value)
  { pattern: /(api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token)\s*[=:]\s*["']?[a-zA-Z0-9._-]{16,}["']?/gi, replacement: "$1=****", description: "API key assignment" },

  // Database connection strings (postgres://, mysql://, mongodb://)
  { pattern: /(postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@[^/\s]+/g, replacement: "$1://****:****@****", description: "Database connection string" },

  // AWS keys (AKIA...)
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: "AKIA****", description: "AWS access key" },

  // AWS secret keys
  { pattern: /aws[_-]?secret[_-]?access[_-]?key\s*[=:]\s*["']?[a-zA-Z0-9/+=]{40}["']?/gi, replacement: "aws_secret_access_key=****", description: "AWS secret key" },

  // Slack tokens (xoxb-, xoxp-, xoxa-)
  { pattern: /xox[bpa]-[a-zA-Z0-9-]{10,}/g, replacement: "xox*-****", description: "Slack token" },

  // Discord tokens
  { pattern: /[MN][A-Za-z\d]{23}\.[\w-]{6}\.[\w-]{27}/g, replacement: "****.****.****", description: "Discord token" },

  // Stripe keys (sk_live_, pk_live_, sk_test_, pk_test_)
  { pattern: /sk_(live|test)_[a-zA-Z0-9]{24,}/g, replacement: "sk_$1_****", description: "Stripe secret key" },
  { pattern: /pk_(live|test)_[a-zA-Z0-9]{24,}/g, replacement: "pk_$1_****", description: "Stripe publishable key" },

  // JWT tokens (3 base64 parts separated by dots)
  { pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, replacement: "eyJ****.eyJ****.****", description: "JWT token" },

  // Generic password/secret in assignment
  { pattern: /(password|passwd|pwd|secret)\s*[=:]\s*["']?[^"'\s]{8,}["']?/gi, replacement: "$1=****", description: "Password assignment" },

  // Private keys (BEGIN PRIVATE KEY)
  { pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, replacement: "-----BEGIN PRIVATE KEY-----\n****\n-----END PRIVATE KEY-----", description: "Private key" },

  // SSH private keys
  { pattern: /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g, replacement: "-----BEGIN OPENSSH PRIVATE KEY-----\n****\n-----END OPENSSH PRIVATE KEY-----", description: "SSH private key" },

  // Google API keys (AIza...)
  { pattern: /AIza[0-9A-Za-z_-]{35}/g, replacement: "AIza****", description: "Google API key" },

  // Azure keys
  { pattern: /azure[_-]?key\s*[=:]\s*["']?[a-zA-Z0-9+/=]{32,}["']?/gi, replacement: "azure_key=****", description: "Azure key" },

  // Twilio keys (AC... / SK...)
  { pattern: /AC[a-zA-Z0-9]{32}/g, replacement: "AC****", description: "Twilio Account SID" },
  { pattern: /SK[a-zA-Z0-9]{32}/g, replacement: "SK****", description: "Twilio API Key SID" },

  // SendGrid keys (SG.)
  { pattern: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/g, replacement: "SG.****.****", description: "SendGrid API key" },

  // Mailgun keys
  { pattern: /key-[a-zA-Z0-9]{32}/g, replacement: "key-****", description: "Mailgun API key" },

  // Heroku API keys
  { pattern: /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, replacement: "****-****-****-****-****", description: "UUID-like token" },

  // Generic long hex/base64 strings that look like tokens (40+ chars)
  { pattern: /[a-zA-Z0-9+/=]{40,}/g, replacement: "****", description: "Long token-like string" },
];

/**
 * Redact secrets from a text string
 */
export function redactSecrets(text: string): string {
  if (!text || typeof text !== "string") {
    return text;
  }

  let result = text;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Redact secrets from an object recursively
 */
export function redactObject(obj: unknown, maxDepth = 10, currentDepth = 0): unknown {
  if (currentDepth > maxDepth) {
    return "[MAX_DEPTH_REACHED]";
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle strings
  if (typeof obj === "string") {
    return redactSecrets(obj);
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => redactObject(item, maxDepth, currentDepth + 1));
  }

  // Handle objects
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Redact keys that look like they contain secrets
      const lowerKey = key.toLowerCase();
      const isSecretKey =
        lowerKey.includes("password") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("token") ||
        lowerKey.includes("apikey") ||
        lowerKey.includes("api_key") ||
        lowerKey.includes("access_token") ||
        lowerKey.includes("auth_token") ||
        lowerKey.includes("private_key") ||
        lowerKey.includes("connection_string") ||
        lowerKey.includes("database_url") ||
        lowerKey.includes("db_url") ||
        lowerKey.includes("dsn");

      if (isSecretKey && typeof value === "string") {
        result[key] = "****";
      } else {
        result[key] = redactObject(value, maxDepth, currentDepth + 1);
      }
    }
    return result;
  }

  // Primitives (number, boolean, bigint, symbol)
  return obj;
}

/**
 * Redact secrets from an array of objects
 */
export function redactArray(arr: unknown[], maxDepth = 10): unknown[] {
  return arr.map(item => redactObject(item, maxDepth));
}

/**
 * Create a safe copy of an object for logging
 * Redacts sensitive fields and limits size
 */
export function safeLogObject(obj: unknown, maxStringLength = 1000, maxArrayLength = 50): unknown {
  const redacted = redactObject(obj);

  // Truncate long strings
  return truncateObject(redacted, maxStringLength, maxArrayLength, 0);
}

function truncateObject(obj: unknown, maxStringLength: number, maxArrayLength: number, depth: number): unknown {
  if (depth > 10) return "[DEEP_NESTING]";

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "string") {
    return obj.length > maxStringLength ? obj.slice(0, maxStringLength) + "...[TRUNCATED]" : obj;
  }

  if (Array.isArray(obj)) {
    if (obj.length > maxArrayLength) {
      const truncated = obj.slice(0, maxArrayLength).map(item => truncateObject(item, maxStringLength, maxArrayLength, depth + 1));
      return [...truncated, `...[${obj.length - maxArrayLength} MORE ITEMS]`];
    }
    return obj.map(item => truncateObject(item, maxStringLength, maxArrayLength, depth + 1));
  }

  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = truncateObject(value, maxStringLength, maxArrayLength, depth + 1);
    }
    return result;
  }

  return obj;
}

/**
 * Redact secrets from BuildEvent data
 */
export function redactBuildEventData(data: Record<string, unknown>): Record<string, unknown> {
  return redactObject(data) as Record<string, unknown>;
}

/**
 * Redact secrets from checkpoint data
 */
export function redactCheckpointData(data: Record<string, unknown>): Record<string, unknown> {
  return redactObject(data) as Record<string, unknown>;
}

/**
 * Redact secrets from tool arguments and results
 */
export function redactToolData(toolName: string, args: Record<string, unknown>, result?: unknown): {
  args: Record<string, unknown>;
  result?: unknown;
} {
  return {
    args: redactObject(args) as Record<string, unknown>,
    result: result ? redactObject(result) : undefined,
  };
}

/**
 * Redact secrets from SSE event data
 */
export function redactSSEData(data: unknown): unknown {
  return redactObject(data);
}

/**
 * Test function to verify redaction works
 */
export function testRedaction(): { input: string; output: string }[] {
  const testCases = [
    "API key: sk-abcdefghijklmnopqrstuvwxyz123456",
    "Bearer token: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    "Password: password=supersecret123",
    "Database URL: postgres://user:pass@localhost:5432/db",
    "AWS Key: AKIAIOSFODNN7EXAMPLE",
    "Private key:\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQD...\n-----END PRIVATE KEY-----",
    "GitHub token: ghp_abcdefghijklmnopqrstuvwxyz1234567890",
    "Slack token: xoxb-fake-token-placeholder-for-testing",
    "Stripe key: sk_test_abcdefghijklmnopqrstuvwxyz",
    "Normal text without secrets",
    '{"apiKey": "sk-test12345678901234567890", "normal": "value"}',
  ];

  return testCases.map(input => ({ input, output: redactSecrets(input) }));
}