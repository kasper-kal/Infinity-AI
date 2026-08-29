/**
 * Tree-sitter Parser Manager — Loads WASM grammars and provides language parsers
 *
 * Supports: TypeScript, JavaScript, Python, Rust, Go, and more
 * Uses web-tree-sitter for browser/WASM compatibility
 */

import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Language support configuration
export interface LanguageSupport {
  name: string;
  extensions: string[];
  mimeTypes: string[];
  aliases: string[];
  // Tree-sitter queries for extracting code structures
  queries: {
    functions: string;
    classes: string;
    interfaces: string;
    types: string;
    imports: string;
    exports: string;
    comments: string;
    // Additional queries for richer extraction
    decorators?: string;
    generics?: string;
    async?: string;
    exports_default?: string;
    exports_named?: string;
  };
}

export const SUPPORTED_LANGUAGES: Record<string, LanguageSupport> = {
  typescript: {
    name: "TypeScript",
    extensions: [".ts", ".tsx", ".cts", ".mts"],
    mimeTypes: ["text/typescript", "application/typescript"],
    aliases: ["ts", "tsx"],
    queries: {
      functions: `
        [
          (function_declaration name: (identifier) @name)
          (method_definition name: (property_identifier) @name)
          (arrow_function) @arrow
          (function_expression name: (identifier) @name)
        ] @function
      `,
      classes: `
        (class_declaration name: (type_identifier) @name) @class
      `,
      interfaces: `
        (interface_declaration name: (type_identifier) @name) @interface
      `,
      types: `
        [
          (type_alias_declaration name: (type_identifier) @name)
          (type_parameter_declaration) @typeparam
        ] @type
      `,
      imports: `
        (import_statement) @import
      `,
      exports: `
        [
          (export_statement) @export
          (export_specifier) @exportspec
        ]
      `,
      comments: `
        (comment) @comment
      `,
      decorators: `
        (decorator) @decorator
      `,
      generics: `
        (type_parameters) @generics
      `,
      async: `
        (function_declaration (modifier) @async) @async_func
      `,
      exports_default: `
        (export_statement (default) @default) @export_default
      `,
      exports_named: `
        (export_statement (named_exports) @named) @export_named
      `,
    },
  },
  javascript: {
    name: "JavaScript",
    extensions: [".js", ".jsx", ".mjs", ".cjs", ".es6"],
    mimeTypes: ["text/javascript", "application/javascript"],
    aliases: ["js", "jsx"],
    queries: {
      functions: `
        [
          (function_declaration name: (identifier) @name)
          (method_definition name: (property_identifier) @name)
          (arrow_function) @arrow
          (function_expression name: (identifier) @name)
        ] @function
      `,
      classes: `
        (class_declaration name: (identifier) @name) @class
      `,
      interfaces: ``,
      types: ``,
      imports: `
        (import_statement) @import
      `,
      exports: `
        [
          (export_statement) @export
          (export_specifier) @exportspec
        ]
      `,
      comments: `
        (comment) @comment
      `,
      decorators: `
        (decorator) @decorator
      `,
      generics: ``,
      async: `
        (function_declaration (modifier) @async) @async_func
      `,
      exports_default: `
        (export_statement (default) @default) @export_default
      `,
      exports_named: `
        (export_statement (named_exports) @named) @export_named
      `,
    },
  },
  python: {
    name: "Python",
    extensions: [".py", ".pyw", ".pyi"],
    mimeTypes: ["text/x-python", "application/x-python"],
    aliases: ["py", "python3"],
    queries: {
      functions: `
        (function_definition name: (identifier) @name) @function
      `,
      classes: `
        (class_definition name: (identifier) @name) @class
      `,
      interfaces: ``,
      types: ``,
      imports: `
        [
          (import_statement) @import
          (import_from_statement) @import_from
        ]
      `,
      exports: ``,
      comments: `
        (comment) @comment
      `,
      decorators: `
        (decorator) @decorator
      `,
      generics: ``,
      async: `
        (function_definition (parameters) @async) @async_func
      `,
      exports_default: ``,
      exports_named: ``,
    },
  },
  rust: {
    name: "Rust",
    extensions: [".rs"],
    mimeTypes: ["text/rust"],
    aliases: ["rs"],
    queries: {
      functions: `
        [
          (function_item name: (identifier) @name)
          (method_item name: (identifier) @name)
          (closure_expression) @closure
        ] @function
      `,
      classes: `
        [
          (struct_item name: (type_identifier) @name)
          (enum_item name: (type_identifier) @name)
        ] @class
      `,
      interfaces: `
        (trait_item name: (type_identifier) @name) @interface
      `,
      types: `
        [
          (type_item name: (type_identifier) @name)
          (type_parameters) @generics
        ] @type
      `,
      imports: `
        (use_declaration) @import
      `,
      exports: `
        (visibility_modifier) @export
      `,
      comments: `
        (comment) @comment
      `,
      decorators: `
        (attribute_item) @decorator
      `,
      generics: `
        (type_parameters) @generics
      `,
      async: `
        (function_item (async) @async) @async_func
      `,
      exports_default: ``,
      exports_named: ``,
    },
  },
  go: {
    name: "Go",
    extensions: [".go"],
    mimeTypes: ["text/x-go"],
    aliases: ["golang"],
    queries: {
      functions: `
        [
          (function_declaration name: (identifier) @name)
          (method_declaration name: (field_identifier) @name)
        ] @function
      `,
      classes: `
        (type_spec name: (type_identifier) @name) @class
      `,
      interfaces: `
        (interface_type) @interface
      `,
      types: `
        (type_declaration) @type
      `,
      imports: `
        (import_declaration) @import
      `,
      exports: ``,
      comments: `
        (comment) @comment
      `,
      decorators: ``,
      generics: `
        (type_parameters) @generics
      `,
      async: ``,
      exports_default: ``,
      exports_named: ``,
    },
  },
  cpp: {
    name: "C++",
    extensions: [".cpp", ".cc", ".cxx", ".hpp", ".h", ".hxx"],
    mimeTypes: ["text/x-c++", "text/x-c"],
    aliases: ["c++", "c", "cpp"],
    queries: {
      functions: `
        (function_definition declarator: (function_declarator declarator: (identifier) @name)) @function
      `,
      classes: `
        [
          (class_specifier name: (type_identifier) @name)
          (struct_specifier name: (type_identifier) @name)
        ] @class
      `,
      interfaces: ``,
      types: `
        (type_definition) @type
      `,
      imports: `
        (preproc_include) @import
      `,
      exports: ``,
      comments: `
        (comment) @comment
      `,
      decorators: `
        (attribute_specifier) @decorator
      `,
      generics: `
        (template_parameter_list) @generics
      `,
      async: ``,
      exports_default: ``,
      exports_named: ``,
    },
  },
  java: {
    name: "Java",
    extensions: [".java"],
    mimeTypes: ["text/x-java"],
    aliases: ["jav"],
    queries: {
      functions: `
        (method_declaration name: (identifier) @name) @function
      `,
      classes: `
        [
          (class_declaration name: (identifier) @name)
          (enum_declaration name: (identifier) @name)
          (record_declaration name: (identifier) @name)
        ] @class
      `,
      interfaces: `
        (interface_declaration name: (identifier) @name) @interface
      `,
      types: `
        (type_parameter) @generics
      `,
      imports: `
        (import_declaration) @import
      `,
      exports: `
        (modifiers (annotation) @annotation) @export
      `,
      comments: `
        (comment) @comment
      `,
      decorators: `
        (marker_annotation) @decorator
      `,
      generics: `
        (type_parameters) @generics
      `,
      async: ``,
      exports_default: ``,
      exports_named: ``,
    },
  },
  csharp: {
    name: "C#",
    extensions: [".cs"],
    mimeTypes: ["text/x-csharp"],
    aliases: ["c#", "cs"],
    queries: {
      functions: `
        (method_declaration name: (identifier) @name) @function
      `,
      classes: `
        [
          (class_declaration name: (identifier) @name)
          (struct_declaration name: (identifier) @name)
          (record_declaration name: (identifier) @name)
        ] @class
      `,
      interfaces: `
        (interface_declaration name: (identifier) @name) @interface
      `,
      types: `
        (type_parameter) @generics
      `,
      imports: `
        (using_directive) @import
      `,
      exports: `
        (modifier (annotation) @annotation) @export
      `,
      comments: `
        (comment) @comment
      `,
      decorators: `
        (attribute) @decorator
      `,
      generics: `
        (type_parameter_list) @generics
      `,
      async: `
        (method_declaration (modifier) @async) @async_func
      `,
      exports_default: ``,
      exports_named: ``,
    },
  },
};

// Parser instance cache
interface ParserInstance {
  parser: any;
  language: any;
  queries: Map<string, any>;
}

class TreeSitterManager {
  private parsers: Map<string, ParserInstance> = new Map();
  private initialized = false;
  private wasmPaths: Map<string, string> = new Map();
  private TreeSitter: any = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamic import for web-tree-sitter
      const module = await import("web-tree-sitter");
      this.TreeSitter = module.default ?? module;

      // Initialize the WASM runtime
      await this.TreeSitter.init();

      // Set up WASM paths - these would be bundled with the application
      // In production, these would be loaded from the dist folder
      this.setupWasmPaths();

      this.initialized = true;
      console.log("[TreeSitterManager] Initialized successfully");
    } catch (error) {
      console.warn("[TreeSitterManager] Failed to initialize tree-sitter:", error);
      this.initialized = false;
      throw error;
    }
  }

  private setupWasmPaths(): void {
    // In development, we might load from node_modules
    // In production, from bundled assets
    const basePath = process.env.NODE_ENV === "production"
      ? join(__dirname, "../../wasm")
      : join(process.cwd(), "node_modules");

    this.wasmPaths.set("typescript", join(basePath, "tree-sitter-typescript", "tree-sitter-typescript.wasm"));
    this.wasmPaths.set("javascript", join(basePath, "tree-sitter-javascript", "tree-sitter-javascript.wasm"));
    this.wasmPaths.set("python", join(basePath, "tree-sitter-python", "tree-sitter-python.wasm"));
    this.wasmPaths.set("rust", join(basePath, "tree-sitter-rust", "tree-sitter-rust.wasm"));
    this.wasmPaths.set("go", join(basePath, "tree-sitter-go", "tree-sitter-go.wasm"));
    this.wasmPaths.set("cpp", join(basePath, "tree-sitter-cpp", "tree-sitter-cpp.wasm"));
    this.wasmPaths.set("java", join(basePath, "tree-sitter-java", "tree-sitter-java.wasm"));
    this.wasmPaths.set("csharp", join(basePath, "tree-sitter-c-sharp", "tree-sitter-c-sharp.wasm"));
  }

  async getParser(language: string): Promise<ParserInstance | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (this.parsers.has(language)) {
      return this.parsers.get(language)!;
    }

    const langSupport = SUPPORTED_LANGUAGES[language];
    if (!langSupport) {
      console.warn(`[TreeSitterManager] Language not supported: ${language}`);
      return null;
    }

    const wasmPath = this.wasmPaths.get(language);
    if (!wasmPath) {
      console.warn(`[TreeSitterManager] No WASM path for language: ${language}`);
      return null;
    }

    try {
      // Load the language WASM
      const languageModule = await this.TreeSitter.Language.load(wasmPath);
      const parser = new this.TreeSitter();
      parser.setLanguage(languageModule);

      // Compile queries
      const queries = new Map<string, any>();
      for (const [queryName, queryString] of Object.entries(langSupport.queries)) {
        if (queryString.trim()) {
          try {
            queries.set(queryName, this.TreeSitter.Query(languageModule, queryString));
          } catch (e) {
            console.warn(`[TreeSitterManager] Failed to compile query ${queryName} for ${language}:`, e);
          }
        }
      }

      const instance: ParserInstance = { parser, language: languageModule, queries };
      this.parsers.set(language, instance);
      return instance;
    } catch (error) {
      console.error(`[TreeSitterManager] Failed to load parser for ${language}:`, error);
      return null;
    }
  }

  async parseFile(filePath: string, content: string): Promise<ParsedFile | null> {
    const language = this.detectLanguage(filePath);
    if (!language) return null;

    const parserInstance = await this.getParser(language);
    if (!parserInstance) return this.fallbackParse(filePath, content, language);

    try {
      const tree = parserInstance.parser.parse(content);
      return this.extractFromTree(tree, filePath, content, language, parserInstance);
    } catch (error) {
      console.warn(`[TreeSitterManager] Parse failed for ${filePath}, using fallback:`, error);
      return this.fallbackParse(filePath, content, language);
    }
  }

  private extractFromTree(
    tree: any,
    filePath: string,
    content: string,
    language: string,
    parserInstance: ParserInstance
  ): ParsedFile {
    const lines = content.split("\n");
    const chunks: ParsedChunk[] = [];
    const imports: ParsedImport[] = [];
    const exports: ParsedExport[] = [];

    // Extract using queries
    for (const [queryName, query] of parserInstance.queries) {
      if (!query) continue;

      const matches = query.matches(tree.rootNode);
      for (const match of matches) {
        for (const capture of match.captures) {
          const node = capture.node;
          const captureName = capture.name;

          if (captureName === "name" || captureName === "function" || captureName === "class" ||
              captureName === "interface" || captureName === "type" || captureName === "import" ||
              captureName === "export" || captureName === "comment") {

            const chunk = this.createChunkFromNode(node, captureName, content, lines, language);
            if (chunk) {
              if (captureName === "import") {
                imports.push(this.createImportFromNode(node, content, lines, language));
              } else if (captureName === "export") {
                exports.push(this.createExportFromNode(node, content, lines, language));
              } else {
                chunks.push(chunk);
              }
            }
          }
        }
      }
    }

    return {
      filePath,
      language,
      chunks,
      imports,
      exports,
      totalLines: lines.length,
      parsedAt: Date.now(),
    };
  }

  private createChunkFromNode(
    node: any,
    captureName: string,
    content: string,
    lines: string[],
    language: string
  ): ParsedChunk | null {
    const startLine = node.startPosition?.row ?? 0;
    const endLine = node.endPosition?.row ?? startLine;

    // Skip tiny nodes
    if (endLine - startLine < 0) return null;

    const chunkContent = lines.slice(startLine, endLine + 1).join("\n");
    if (chunkContent.trim().length < 5) return null;

    // Extract name
    let name = "anonymous";
    for (const child of node.children) {
      if (child.type.includes("identifier") || child.type.includes("name")) {
        name = content.slice(child.startIndex, child.endIndex);
        break;
      }
    }

    // Get signature (first meaningful line)
    let signature = "";
    for (let i = startLine; i <= Math.min(startLine + 3, endLine); i++) {
      const line = lines[i]?.trim();
      if (line && !line.startsWith("//") && !line.startsWith("/*")) {
        signature = line;
        break;
      }
    }

    // Determine chunk type from capture name
    let chunkType: ParsedChunk["type"] = "block";
    switch (captureName) {
      case "function": chunkType = "function"; break;
      case "class": chunkType = "class"; break;
      case "interface": chunkType = "interface"; break;
      case "type": chunkType = "type"; break;
      case "comment": chunkType = "comment"; break;
    }

    return {
      id: `${filePath}:${startLine + 1}:${endLine + 1}`,
      type: chunkType,
      name,
      signature,
      content: chunkContent,
      startLine: startLine + 1,
      endLine: endLine + 1,
      metadata: {
        nodeType: node.type,
      },
    };
  }

  private createImportFromNode(node: any, content: string, lines: string[], language: string): ParsedImport {
    const startLine = node.startPosition?.row ?? 0;
    const endLine = node.endPosition?.row ?? startLine;
    const importText = lines.slice(startLine, endLine + 1).join("\n");

    return {
      id: `${filePath}:import:${startLine + 1}`,
      filePath: "",
      source: this.extractImportSource(importText, language),
      specifiers: this.extractImportSpecifiers(importText, language),
      isDefault: importText.includes("default"),
      isNamespace: importText.includes("* as"),
      startLine: startLine + 1,
      endLine: endLine + 1,
    };
  }

  private createExportFromNode(node: any, content: string, lines: string[], language: string): ParsedExport {
    const startLine = node.startPosition?.row ?? 0;
    const endLine = node.endPosition?.row ?? startLine;
    const exportText = lines.slice(startLine, endLine + 1).join("\n");

    return {
      id: `${filePath}:export:${startLine + 1}`,
      filePath: "",
      name: this.extractExportName(exportText, language),
      isDefault: exportText.includes("default"),
      isReexport: exportText.includes("from"),
      startLine: startLine + 1,
      endLine: endLine + 1,
    };
  }

  private extractImportSource(text: string, language: string): string {
    // Simple regex extraction for import source
    const patterns: Record<string, RegExp> = {
      typescript: /from\s+['"]([^'"]+)['"]/,
      javascript: /from\s+['"]([^'"]+)['"]/,
      python: /from\s+([\w.]+)\s+import/,
      rust: /use\s+([\w:]+)/,
      go: /import\s+\(?\s*["']([^"')]+)["']/,
    };
    const match = text.match(patterns[language] || /from\s+['"]([^'"]+)['"]/);
    return match?.[1] || "";
  }

  private extractImportSpecifiers(text: string, language: string): string[] {
    // Extract imported names
    const patterns: Record<string, RegExp> = {
      typescript: /import\s+\{([^}]+)\}/,
      javascript: /import\s+\{([^}]+)\}/,
      python: /import\s+([\w,\s]+)/,
    };
    const match = text.match(patterns[language] || /import\s+\{([^}]+)\}/);
    if (!match?.[1]) return [];
    return match[1].split(",").map(s => s.trim().replace(/as\s+\w+/i, "").trim()).filter(Boolean);
  }

  private extractExportName(text: string, language: string): string {
    const patterns: Record<string, RegExp> = {
      typescript: /export\s+(?:default\s+)?(?:class|function|const|interface|type)\s+(\w+)/,
      javascript: /export\s+(?:default\s+)?(?:class|function|const)\s+(\w+)/,
      python: /^(?:class|def)\s+(\w+)/m,
      rust: /(?:pub\s+)?(?:fn|struct|enum|trait|type)\s+(\w+)/,
      go: /func\s+(?:\(\w+\s+\w+\)\s+)?(\w+)/,
    };
    const match = text.match(patterns[language] || /export\s+(?:default\s+)?(?:class|function|const)\s+(\w+)/);
    return match?.[1] || "anonymous";
  }

  private fallbackParse(filePath: string, content: string, language: string): ParsedFile {
    // Regex-based fallback (same as in codebase-indexer.ts)
    const lines = content.split("\n");
    const chunks: ParsedChunk[] = [];

    const patterns: Record<string, { regex: RegExp; type: ParsedChunk["type"] }[]> = {
      typescript: [
        { regex: /^(export\s+)?(async\s+)?function\s+(\w+)\s*\(/m, type: "function" },
        { regex: /^(export\s+)?const\s+(\w+)\s*=\s*(async\s+)?\(/m, type: "function" },
        { regex: /^(export\s+)?class\s+(\w+)/m, type: "class" },
        { regex: /^(export\s+)?interface\s+(\w+)/m, type: "interface" },
        { regex: /^(export\s+)?type\s+(\w+)\s*=/m, type: "type" },
      ],
      javascript: [
        { regex: /^(export\s+)?(async\s+)?function\s+(\w+)\s*\(/m, type: "function" },
        { regex: /^(export\s+)?const\s+(\w+)\s*=\s*(async\s+)?\(/m, type: "function" },
        { regex: /^(export\s+)?class\s+(\w+)/m, type: "class" },
      ],
      python: [
        { regex: /^(async\s+)?def\s+(\w+)\s*\(/m, type: "function" },
        { regex: /^class\s+(\w+)/m, type: "class" },
      ],
      rust: [
        { regex: /^(pub\s+)?(async\s+)?fn\s+(\w+)\s*\(/m, type: "function" },
        { regex: /^(pub\s+)?struct\s+(\w+)/m, type: "class" },
        { regex: /^(pub\s+)?enum\s+(\w+)/m, type: "class" },
        { regex: /^(pub\s+)?trait\s+(\w+)/m, type: "interface" },
      ],
      go: [
        { regex: /^func\s+(?:\(\w+\s+\w+\)\s+)?(\w+)\s*\(/m, type: "function" },
        { regex: /^type\s+(\w+)\s+(?:struct|interface)/m, type: "class" },
      ],
    };

    const langPatterns = patterns[language] || patterns.typescript;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { regex, type } of langPatterns) {
        const match = line.match(regex);
        if (match) {
          let endLine = i;
          // Find end of block (simple brace counting)
          let braceCount = 0;
          for (let j = i; j < lines.length; j++) {
            braceCount += (lines[j].match(/{/g) || []).length;
            braceCount -= (lines[j].match(/}/g) || []).length;
            if (braceCount === 0 && j > i) {
              endLine = j;
              break;
            }
          }

          chunks.push({
            id: `${filePath}:${i + 1}:${endLine + 1}`,
            type,
            name: match[match.length - 1] || "anonymous",
            signature: line.trim(),
            content: lines.slice(i, endLine + 1).join("\n"),
            startLine: i + 1,
            endLine: endLine + 1,
            metadata: { fallback: true },
          });
          i = endLine; // Skip to end of this chunk
          break;
        }
      }
    }

    return {
      filePath,
      language,
      chunks,
      imports: [],
      exports: [],
      totalLines: lines.length,
      parsedAt: Date.now(),
    };
  }

  detectLanguage(filePath: string): string | null {
    const ext = filePath.split(".").pop()?.toLowerCase();
    if (!ext) return null;

    for (const [lang, config] of Object.entries(SUPPORTED_LANGUAGES)) {
      if (config.extensions.includes(`.${ext}`)) {
        return lang;
      }
    }
    return null;
  }

  getSupportedLanguages(): string[] {
    return Object.keys(SUPPORTED_LANGUAGES);
  }

  isLanguageSupported(language: string): boolean {
    return language in SUPPORTED_LANGUAGES;
  }

  async dispose(): Promise<void> {
    for (const instance of this.parsers.values()) {
      try {
        instance.parser?.delete?.();
      } catch {}
    }
    this.parsers.clear();
    this.initialized = false;
  }
}

// Singleton instance
let managerInstance: TreeSitterManager | null = null;

export function getTreeSitterManager(): TreeSitterManager {
  if (!managerInstance) {
    managerInstance = new TreeSitterManager();
  }
  return managerInstance;
}

// Export types
export interface ParsedFile {
  filePath: string;
  language: string;
  chunks: ParsedChunk[];
  imports: ParsedImport[];
  exports: ParsedExport[];
  totalLines: number;
  parsedAt: number;
}

export interface ParsedChunk {
  id: string;
  type: "function" | "class" | "interface" | "type" | "import" | "export" | "comment" | "block";
  name: string;
  signature: string;
  content: string;
  startLine: number;
  endLine: number;
  metadata: Record<string, unknown>;
}

export interface ParsedImport {
  id: string;
  filePath: string;
  source: string;
  specifiers: string[];
  isDefault: boolean;
  isNamespace: boolean;
  startLine: number;
  endLine: number;
}

export interface ParsedExport {
  id: string;
  filePath: string;
  name: string;
  isDefault: boolean;
  isReexport: boolean;
  startLine: number;
  endLine: number;
}