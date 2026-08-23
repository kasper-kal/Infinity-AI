import { Router } from "express";
import { readWorkspaceFile, writeWorkspaceFile, listWorkspaceFiles } from "../../lib/workspace";
import { cleanText } from "../../lib/text-utils";

const router = Router();

// TypeScript config generator
function generateTsConfig(framework: string): object {
  const baseConfig = {
    compilerOptions: {
      target: "ES2020",
      useDefineForClassFields: true,
      lib: ["ES2020", "DOM", "DOM.Iterable"],
      module: "ESNext",
      skipLibCheck: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      strict: true,
      noImplicitAny: true,
      strictNullChecks: true,
      resolveJsonModule: true,
    },
  };

  if (framework === "nextjs") {
    return {
      ...baseConfig,
      compilerOptions: {
        ...baseConfig.compilerOptions,
        jsx: "preserve",
        incremental: true,
        isolatedModules: true,
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
      exclude: ["node_modules"],
    };
  }

  if (framework === "react") {
    return {
      ...baseConfig,
      compilerOptions: {
        ...baseConfig.compilerOptions,
        jsx: "react-jsx",
      },
      include: ["src"],
      exclude: ["node_modules", "dist", "build"],
    };
  }

  if (framework === "vue") {
    return {
      ...baseConfig,
      compilerOptions: {
        ...baseConfig.compilerOptions,
        jsx: "preserve",
      },
      include: ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.tsx", "src/**/*.vue"],
      exclude: ["node_modules"],
    };
  }

  return baseConfig;
}

// ESLint config generator
function generateEslintConfig(framework: string): object {
  const baseConfig = {
    env: {
      browser: true,
      es2021: true,
      node: true,
    },
    extends: ["eslint:recommended"],
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-console": "warn",
      "no-unused-vars": "warn",
    },
  };

  if (framework === "nextjs" || framework === "react") {
    return {
      ...baseConfig,
      extends: ["eslint:recommended", "next/core-web-vitals"],
      parser: "@typescript-eslint/parser",
    };
  }

  if (framework === "vue") {
    return {
      ...baseConfig,
      extends: ["eslint:recommended", "plugin:vue/vue3-recommended"],
      parser: "vue-eslint-parser",
    };
  }

  return baseConfig;
}

// Prettier config generator
function generatePrettierConfig(): object {
  return {
    semi: true,
    trailingComma: "es5",
    singleQuote: false,
    printWidth: 100,
    tabWidth: 2,
    useTabs: false,
    arrowParens: "always",
    endOfLine: "lf",
  };
}

// Jest config generator
function generateJestConfig(framework: string): object {
  const baseConfig = {
    testEnvironment: "jsdom",
    setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
    moduleNameMapper: {
      "^@/(.*)$": "<rootDir>/src/$1",
    },
    transform: {
      "^.+\\.(ts|tsx)$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }],
    },
    testMatch: ["**/__tests__/**/*.[jt]s?(x)", "**/?(*.)+(spec|test).[jt]s?(x)"],
  };

  if (framework === "nextjs") {
    return {
      ...baseConfig,
      testEnvironment: "node",
      setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
      testPathIgnorePatterns: ["<rootDir>/.next/", "<rootDir>/node_modules/"],
    };
  }

  return baseConfig;
}

// Babel config generator
function generateBabelConfig(framework: string): object {
  const baseConfig = {
    presets: ["@babel/preset-env"],
  };

  if (framework === "react" || framework === "nextjs") {
    return {
      presets: ["@babel/preset-env", "@babel/preset-react"],
      plugins: [],
    };
  }

  return baseConfig;
}

// Get all config file templates for a framework
router.get("/config/templates/:framework", async (req, res) => {
  const framework = cleanText(req.params.framework, 64);
  
  const templates: Record<string, Record<string, object>> = {
    nextjs: {
      "tsconfig.json": generateTsConfig("nextjs"),
      ".eslintrc.json": generateEslintConfig("nextjs"),
      ".prettierrc": generatePrettierConfig(),
      "jest.config.js": generateJestConfig("nextjs"),
    },
    react: {
      "tsconfig.json": generateTsConfig("react"),
      ".eslintrc.json": generateEslintConfig("react"),
      ".prettierrc": generatePrettierConfig(),
      "jest.config.js": generateJestConfig("react"),
    },
    vue: {
      "tsconfig.json": generateTsConfig("vue"),
      ".eslintrc.json": generateEslintConfig("vue"),
      ".prettierrc": generatePrettierConfig(),
    },
    django: {
      ".flake8": {
        max_line_length: 100,
        exclude: ["migrations", "venv", ".venv"],
      },
    },
    fastapi: {
      ".flake8": {
        max_line_length: 100,
        exclude: ["venv", ".venv"],
      },
      "pyproject.toml": {
        tool: {
          black: { line_length: 100 },
          pylint: { max_line_length: 100 },
        },
      },
    },
  };

  if (!(framework in templates)) {
    return res.status(404).json({ error: `No templates for framework: ${framework}` });
  }

  return res.json({ ok: true, framework, templates: templates[framework] });
});

// Generate and create config files
router.post("/config/generate", async (req, res) => {
  const workspaceId = cleanText(req.body?.workspaceId, 64) || "default";
  const framework = cleanText(req.body?.framework, 64);
  const files = req.body?.files || ["tsconfig.json", ".eslintrc.json", ".prettierrc"];

  try {
    const configs: Record<string, string> = {};
    const created: string[] = [];
    const failed: string[] = [];

    for (const filename of files) {
      try {
        let config: object = {};

        if (filename === "tsconfig.json") {
          config = generateTsConfig(framework);
        } else if (filename === ".eslintrc.json") {
          config = generateEslintConfig(framework);
        } else if (filename === ".prettierrc") {
          config = generatePrettierConfig();
        } else if (filename === "jest.config.js") {
          config = generateJestConfig(framework);
        } else if (filename === "babel.config.js") {
          config = generateBabelConfig(framework);
        } else {
          failed.push(filename);
          continue;
        }

        const content = JSON.stringify(config, null, 2);
        await writeWorkspaceFile(filename, content, workspaceId);
        configs[filename] = content;
        created.push(filename);
      } catch (err) {
        failed.push(filename);
      }
    }

    return res.json({
      ok: true,
      framework,
      created,
      failed,
      filesGenerated: created.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to generate config files");
    return res.status(500).json({ error: "Failed to generate config files" });
  }
});

// List existing config files
router.get("/config/files", async (req, res) => {
  const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";

  try {
    const files = await listWorkspaceFiles(workspaceId);
    const configFiles = files
      .filter(f => f.type === "file" && /^(tsconfig|\.eslintrc|\.prettierrc|jest|babel|webpack)/.test(f.name))
      .map(f => ({
        name: f.name,
        path: f.path,
        type: "config",
      }));

    return res.json({ ok: true, files: configFiles, count: configFiles.length });
  } catch (err) {
    req.log.error({ err }, "Failed to list config files");
    return res.status(500).json({ error: "Failed to list config files" });
  }
});

export default router;
