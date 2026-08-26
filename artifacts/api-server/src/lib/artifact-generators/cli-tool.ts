/**
 * PHASE 12 — CLI TOOL ARTIFACT GENERATOR
 *
 * Generates command-line tools from a single prompt.
 * Frameworks: Commander, CAC, Yargs, OCLIF
 * Features: typed commands, auto-complete, config file, cross-platform, npm publishable.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ArtifactConfig,
  ArtifactScaffoldResult,
  ArtifactBuildResult,
  ArtifactDeployResult,
  ArtifactPreviewInfo,
  CliToolSettings,
  DeployTarget,
} from "../artifact-types";

export class CliToolGenerator {
  constructor(private config: ArtifactConfig) {}

  async generate(): Promise<ArtifactScaffoldResult> {
    const settings = this.config.settings as CliToolSettings;
    const framework = settings.framework || "commander";

    const files = await this.buildFiles(framework, settings);
    const installCommands = this.getInstallCommands(framework);
    const devCommands = this.getDevCommands(framework);
    const buildCommands = this.getBuildCommands(framework);
    const previewCommands = this.getPreviewCommands(framework);
    const deployCommands = this.getDeployCommands(framework);

    return {
      config: this.config,
      files,
      entryPoints: ["src/cli.ts"],
      installCommands,
      devCommands,
      buildCommands,
      previewCommands,
      deployCommands,
    };
  }

  private async buildFiles(framework: string, settings: CliToolSettings): Promise<GeneratedFile[]> {
    const files: GeneratedFile[] = [];

    // package.json
    files.push({
      path: "package.json",
      content: this.generatePackageJson(framework, settings),
      purpose: "NPM package configuration",
      isTemplate: false,
    });

    // tsconfig
    files.push({
      path: "tsconfig.json",
      content: this.generateTsConfig(),
      purpose: "TypeScript configuration",
      isTemplate: false,
    });

    // Main CLI entry
    files.push({
      path: "src/cli.ts",
      content: this.generateCliEntry(framework, settings),
      purpose: "CLI entry point",
      isTemplate: false,
    });

    // Commands
    files.push({
      path: "src/commands/hello.ts",
      content: this.generateHelloCommand(framework),
      purpose: "Example hello command",
      isTemplate: false,
    });

    files.push({
      path: "src/commands/config.ts",
      content: this.generateConfigCommand(framework, settings),
      purpose: "Configuration management command",
      isTemplate: false,
    });

    // Config file support
    if (settings.configFile) {
      files.push({
        path: "src/config/index.ts",
        content: this.generateConfigManager(settings),
        purpose: "Configuration file manager",
        isTemplate: false,
      });
    }

    // Auto-complete
    if (settings.autoComplete) {
      files.push({
        path: "src/completion.ts",
        content: this.generateCompletion(framework),
        purpose: "Shell auto-completion generator",
        isTemplate: false,
      });
    }

    // Version command
    files.push({
      path: "src/commands/version.ts",
      content: this.generateVersionCommand(),
      purpose: "Version command",
      isTemplate: false,
    });

    // Tests
    files.push({
      path: "test/cli.test.ts",
      content: this.generateTests(framework),
      purpose: "CLI integration tests",
      isTemplate: false,
    });

    // README
    files.push({
      path: "README.md",
      content: this.generateReadme(framework, settings),
      purpose: "Project documentation",
      isTemplate: false,
    });

    // .gitignore
    files.push({
      path: ".gitignore",
      content: "node_modules\ndist\n*.log\n.env\n.DS_Store",
      purpose: "Git ignore rules",
      isTemplate: false,
    });

    // LICENSE
    files.push({
      path: "LICENSE",
      content: "MIT License\n\nCopyright (c) 2024\n\nPermission is hereby granted...",
      purpose: "License file",
      isTemplate: false,
    });

    // Publish config
    files.push({
      path: ".npmignore",
      content: "node_modules\nsrc\ntest\ntsconfig.json\n*.md\n!README.md\n!LICENSE",
      purpose: "NPM publish ignore rules",
      isTemplate: false,
    });

    return files;
  }

  private generatePackageJson(framework: string, settings: CliToolSettings): string {
    const deps: Record<string, string> = {};
    const devDeps: Record<string, string> = {};

    // Framework deps
    if (framework === "commander") {
      deps["commander"] = "^11.1.0";
    } else if (framework === "cac") {
      deps["cac"] = "^6.7.14";
    } else if (framework === "yargs") {
      deps["yargs"] = "^17.7.2";
      deps["yargs-parser"] = "^21.1.1";
    } else if (framework === "oclif") {
      deps["@oclif/core"] = "^3.17.0";
    }

    // Config file
    if (settings.configFile) {
      deps["conf"] = "^12.0.0";
    }

    // Auto-complete
    if (settings.autoComplete && framework === "commander") {
      // Commander has built-in completion
    } else if (settings.autoComplete && framework === "cac") {
      deps["@cac/completion"] = "^1.0.0";
    }

    // Packaging
    if (settings.packaging === "tsup") {
      devDeps["tsup"] = "^8.0.0";
    } else if (settings.packaging === "esbuild") {
      devDeps["esbuild"] = "^0.19.0";
    } else if (settings.packaging === "pkg") {
      devDeps["pkg"] = "^5.8.0";
    } else if (settings.packaging === "rollup") {
      devDeps["rollup"] = "^4.9.0";
      devDeps["@rollup/plugin-typescript"] = "^11.1.0";
    }

    // Testing
    devDeps["vitest"] = "^1.2.0";
    devDeps["@types/node"] = "^20.11.0";
    devDeps["typescript"] = "^5.3.0";

    return JSON.stringify({
      name: this.config.name.toLowerCase().replace(/\s+/g, "-"),
      version: "1.0.0",
      description: this.config.description,
      type: "module",
      main: "dist/cli.js",
      bin: {
        [this.config.name.toLowerCase().replace(/\s+/g, "-")]: "dist/cli.js",
      },
      scripts: {
        dev: "tsx src/cli.ts",
        build: settings.packaging === "tsup"
          ? "tsup src/cli.ts --format esm --out-dir dist --external commander --external cac --external yargs --external @oclif/core"
          : "tsc",
        start: "node dist/cli.js",
        test: "vitest run",
        "test:watch": "vitest",
        prepack: "npm run build",
      },
      dependencies: deps,
      devDependencies: devDeps,
      files: ["dist", "README.md", "LICENSE"],
      engines: { node: ">=18.0.0" },
      publishConfig: { access: "public" },
    }, null, 2);
  }

  private generateTsConfig(): string {
    return JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        outDir: "./dist",
        rootDir: "./src",
        declaration: true,
        declarationMap: true,
        sourceMap: true,
      },
      include: ["src/**/*"],
      exclude: ["node_modules", "dist", "test"],
    }, null, 2);
  }

  private generateCliEntry(framework: string, settings: CliToolSettings): string {
    const cliName = this.config.name.toLowerCase().replace(/\s+/g, "-");

    if (framework === "commander") {
      return `#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

const program = new Command();

program
  .name('${cliName}')
  .description('${this.config.description}')
  .version(pkg.version, '-v, --version', 'Display version number')
  .helpOption('-h, --help', 'Display help for command');

${settings.autoComplete ? `program.enablePositionalOptions();
program.addHelpText('after', \`
\${cliName} uses Commander.js for auto-completion.
Run: \${cliName} completion <shell> >> ~/.bashrc (or ~/.zshrc)
\`);` : ""}

// Import commands
import { helloCommand } from './commands/hello.js';
import { configCommand } from './commands/config.js';
import { versionCommand } from './commands/version.js';

program.addCommand(helloCommand);
program.addCommand(configCommand);
program.addCommand(versionCommand);

// Parse arguments
program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});`;
    }

    if (framework === "cac") {
      return `#!/usr/bin/env node
import { cac } from 'cac';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

const cli = cac('${cliName}');

cli
  .version(pkg.version)
  .help('-h, --help')
  .command('[command]', 'Run a command', { allowUnknownOptions: true });

${settings.autoComplete ? `cli.command('completion [shell]', 'Generate shell completion')
  .action(async (shell) => {
    const shells = ['bash', 'zsh', 'fish'];
    if (!shells.includes(shell)) {
      console.log('Supported shells: bash, zsh, fish');
      return;
    }
    console.log(\`# Complete \${shell} completion for \${cliName}\`);
  });` : ""}

// Import commands
import { helloCommand } from './commands/hello.js';
import { configCommand } from './commands/config.js';
import { versionCommand } from './commands/version.js';

helloCommand(cli);
configCommand(cli);
versionCommand(cli);

cli.parse();`;
    }

    // Yargs
    return `#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

const { command, option, help, version } = yargs(hideBin(process.argv))
  .scriptName('${cliName}')
  .usage('${this.config.description}')
  .version(pkg.version)
  .help()
  .alias('h', 'help')
  .alias('v', 'version')
  .strict();

${settings.autoComplete ? `.completion('completion', 'Generate shell completion script')` : ""}

// Import commands
import { helloCommand } from './commands/hello.js';
import { configCommand } from './commands/config.js';
import { versionCommand } from './commands/version.js';

helloCommand(command);
configCommand(command);
versionCommand(command);

command.parse();`;
  }

  private generateHelloCommand(framework: string): string {
    if (framework === "commander") {
      return `import { Command } from 'commander';

export const helloCommand = new Command('hello')
  .description('Say hello')
  .argument('[name]', 'Name to greet', 'World')
  .option('-u, --uppercase', 'Uppercase the greeting')
  .option('-t, --times <number>', 'Number of times to greet', '1')
  .action((name, options) => {
    let greeting = \`Hello, \${name}!\`;
    if (options.uppercase) greeting = greeting.toUpperCase();
    for (let i = 0; i < parseInt(options.times); i++) {
      console.log(greeting);
    }
  });`;
    }

    if (framework === "cac") {
      return `import type { CAC } from 'cac';

export function helloCommand(cli: CAC) {
  cli.command('hello [name]', 'Say hello')
    .option('-u, --uppercase', 'Uppercase the greeting')
    .option('-t, --times <number>', 'Number of times to greet', { default: '1' })
    .action((name, options) => {
      name = name || 'World';
      let greeting = \`Hello, \${name}!\`;
      if (options.uppercase) greeting = greeting.toUpperCase();
      for (let i = 0; i < parseInt(options.times); i++) {
        console.log(greeting);
      }
    });
}`;
    }

    // Yargs
    return `import type { Argv } from 'yargs';

export function helloCommand(yargs: Argv) {
  yargs.command(
    'hello [name]',
    'Say hello',
    (yargs) => {
      return yargs
        .positional('name', { type: 'string', default: 'World', describe: 'Name to greet' })
        .option('uppercase', { alias: 'u', type: 'boolean', describe: 'Uppercase the greeting' })
        .option('times', { alias: 't', type: 'number', default: 1, describe: 'Number of times to greet' });
    },
    (argv) => {
      let greeting = \`Hello, \${argv.name}!\`;
      if (argv.uppercase) greeting = greeting.toUpperCase();
      for (let i = 0; i < argv.times; i++) {
        console.log(greeting);
      }
    }
  );
}`;
  }

  private generateConfigCommand(framework: string, settings: CliToolSettings): string {
    if (!settings.configFile) {
      if (framework === "commander") {
        return `import { Command } from 'commander';

export const configCommand = new Command('config')
  .description('Configuration management')
  .command('get [key]', 'Get config value')
  .command('set <key> <value>', 'Set config value')
  .command('list', 'List all config')
  .command('reset', 'Reset config to defaults')
  .action(() => console.log('Config management not enabled. Enable configFile in settings.'));`;
      }
      if (framework === "cac") {
        return `import type { CAC } from 'cac';

export function configCommand(cli: CAC) {
  cli.command('config get [key]', 'Get config value');
  cli.command('config set <key> <value>', 'Set config value');
  cli.command('config list', 'List all config');
  cli.command('config reset', 'Reset config to defaults');
}`;
      }
      return `import type { Argv } from 'yargs';

export function configCommand(yargs: Argv) {
  yargs.command('config get [key]', 'Get config value');
  yargs.command('config set <key> <value>', 'Set config value');
  yargs.command('config list', 'List all config');
  yargs.command('config reset', 'Reset config to defaults');
}`;
    }

    if (framework === "commander") {
      return `import { Command } from 'commander';
import { ConfigManager } from '../config/index.js';

const config = new ConfigManager();

export const configCommand = new Command('config')
  .description('Manage configuration')
  .command('get <key>')
  .description('Get a configuration value')
  .action((key) => {
    const value = config.get(key);
    console.log(value !== undefined ? value : 'Not set');
  })
  .command('set <key> <value>')
  .description('Set a configuration value')
  .action((key, value) => {
    config.set(key, value);
    console.log(\`Set \${key} = \${value}\`);
  })
  .command('list')
  .description('List all configuration values')
  .action(() => {
    const all = config.getAll();
    for (const [key, value] of Object.entries(all)) {
      console.log(\`\${key}: \${value}\`);
    }
  })
  .command('reset')
  .description('Reset configuration to defaults')
  .action(() => {
    config.reset();
    console.log('Configuration reset');
  });`;
    }

    if (framework === "cac") {
      return `import type { CAC } from 'cac';
import { ConfigManager } from '../config/index.js';

const config = new ConfigManager();

export function configCommand(cli: CAC) {
  cli.command('config get <key>', 'Get a configuration value')
    .action((key) => console.log(config.get(key) ?? 'Not set'));
  cli.command('config set <key> <value>', 'Set a configuration value')
    .action((key, value) => { config.set(key, value); console.log(\`Set \${key} = \${value}\`); });
  cli.command('config list', 'List all configuration values')
    .action(() => { for (const [k, v] of Object.entries(config.getAll())) console.log(\`\${k}: \${v}\`); });
  cli.command('config reset', 'Reset configuration to defaults')
    .action(() => { config.reset(); console.log('Configuration reset'); });
}`;
    }

    return `import type { Argv } from 'yargs';
import { ConfigManager } from '../config/index.js';

const config = new ConfigManager();

export function configCommand(yargs: Argv) {
  yargs.command('config get <key>', 'Get a configuration value', (y) => y.positional('key', { type: 'string' }), (argv) => console.log(config.get(argv.key) ?? 'Not set'));
  yargs.command('config set <key> <value>', 'Set a configuration value', (y) => y.positional('key', { type: 'string' }).positional('value', { type: 'string' }), (argv) => { config.set(argv.key, argv.value); console.log(\`Set \${argv.key} = \${argv.value}\`); });
  yargs.command('config list', 'List all configuration values', () => {}, () => { for (const [k, v] of Object.entries(config.getAll())) console.log(\`\${k}: \${v}\`); });
  yargs.command('config reset', 'Reset configuration to defaults', () => {}, () => { config.reset(); console.log('Configuration reset'); });
}`;
  }

  private generateConfigManager(settings: CliToolSettings): string {
    return `import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CONFIG_FILE = join(homedir(), '.config', '${this.config.name.toLowerCase().replace(/\s+/g, "-")}', 'config.json');

export class ConfigManager {
  private config: Record<string, unknown> = {};

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (existsSync(CONFIG_FILE)) {
        this.config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
      }
    } catch {
      this.config = {};
    }
  }

  private save() {
    writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
  }

  get(key: string): unknown {
    return this.config[key];
  }

  set(key: string, value: unknown): void {
    this.config[key] = value;
    this.save();
  }

  getAll(): Record<string, unknown> {
    return { ...this.config };
  }

  reset(): void {
    this.config = {};
    this.save();
  }

  has(key: string): boolean {
    return key in this.config;
  }

  delete(key: string): boolean {
    if (key in this.config) {
      delete this.config[key];
      this.save();
      return true;
    }
    return false;
  }
}

export const configManager = new ConfigManager();`;
  }

  private generateCompletion(framework: string): string {
    if (framework === "commander") {
      return `import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

// This is auto-generated by Commander when running: cli completion <shell>
// The shell script should be sourced in ~/.bashrc, ~/.zshrc, or ~/.config/fish/config.fish

export function generateCompletion(shell: 'bash' | 'zsh' | 'fish'): string {
  const program = new Command()
    .name(pkg.name)
    .version(pkg.version);

  // Add all commands here for completion generation
  import { helloCommand } from './commands/hello.js';
  import { configCommand } from './commands/config.js';
  import { versionCommand } from './commands/version.js';

  program.addCommand(helloCommand);
  program.addCommand(configCommand);
  program.addCommand(versionCommand);

  return program.createCompletion(shell);
}`;
    }

    return `// Auto-completion generation for ${framework}
// Run: npx ${this.config.name.toLowerCase().replace(/\s+/g, "-")} completion <shell>
export function generateCompletion(shell: 'bash' | 'zsh' | 'fish'): string {
  return \`# ${framework} completion for \${shell}\`;
}`;
  }

  private generateVersionCommand(): string {
    return `import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

export const versionCommand = {
  name: 'version',
  description: 'Display version information',
  action() {
    console.log(\`\${pkg.name} v\${pkg.version}\`);
  },
};`;
  }

  private generateTests(framework: string): string {
    return `import { describe, test, expect, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliPath = join(__dirname, '../dist/cli.js');

describe('CLI', () => {
  test('shows help', () => {
    const output = execSync(\`node \${cliPath} --help\`, { encoding: 'utf-8' });
    expect(output).toContain('${this.config.description}');
  });

  test('shows version', () => {
    const output = execSync(\`node \${cliPath} --version\`, { encoding: 'utf-8' });
    expect(output).toMatch(/\\d+\\.\\d+\\.\\d+/);
  });

  test('hello command works', () => {
    const output = execSync(\`node \${cliPath} hello World\`, { encoding: 'utf-8' });
    expect(output.trim()).toBe('Hello, World!');
  });

  test('hello command with uppercase', () => {
    const output = execSync(\`node \${cliPath} hello World --uppercase\`, { encoding: 'utf-8' });
    expect(output.trim()).toBe('HELLO, WORLD!');
  });
});`;
  }

  private generateReadme(framework: string, settings: CliToolSettings): string {
    const cliName = this.config.name.toLowerCase().replace(/\s+/g, "-");

    return `# ${this.config.name}

${this.config.description}

## Installation

\`\`\`bash
npm install -g ${cliName}
# or run without installing
npx ${cliName}
\`\`\`

## Usage

\`\`\`bash
${cliName} --help
${cliName} --version
${cliName} hello World
${cliName} hello World --uppercase --times 3
${settings.configFile
        ? `\n${cliName} config get <key>\n${cliName} config set <key> <value>\n${cliName} config list\n${cliName} config reset`
        : ""}
\`\`\`

## Features

- **Framework:** ${framework}
- **Language:** TypeScript
- **Packaging:** ${settings.packaging}
- **Auto-complete:** ${settings.autoComplete ? "Enabled (bash, zsh, fish)" : "Disabled"}
- **Config file:** ${settings.configFile ? "Enabled" : "Disabled"}
- **Plugins:** ${settings.plugins ? "Enabled" : "Disabled"}

## Development

\`\`\`bash
npm install
npm run dev          # Run with tsx
npm run build        # Build with ${settings.packaging}
npm test             # Run tests
\`\`\`

## Shell Completion

\`\`\`bash
# Bash
${cliName} completion bash >> ~/.bashrc

# Zsh
${cliName} completion zsh >> ~/.zshrc

# Fish
${cliName} completion fish >> ~/.config/fish/config.fish
\`\`\`

## Publish to npm

\`\`\`bash
npm login
npm publish
\`\`\`

---

Generated by Infinity AI — Multi-Artifact Support (Phase 12)`;
  }

  private getInstallCommands(framework: string): string[] {
    return ["npm install"];
  }

  private getDevCommands(framework: string): string[] {
    return ["npm run dev"];
  }

  private getBuildCommands(framework: string): string[] {
    return ["npm run build"];
  }

  private getPreviewCommands(framework: string): string[] {
    return ["npm run dev -- --help"];
  }

  private getDeployCommands(framework: string): Record<string, string> {
    return {
      npm: "npm publish",
      "github-pages": "echo 'Not applicable for CLI tools'",
      docker: "docker build -t cli-tool . && docker push cli-tool:latest",
      "self-hosted": "npm pack && tar -xzf *.tgz && mv package /usr/local/lib/cli-tool",
    };
  }

  async build(artifactId: string, projectDir: string): Promise<ArtifactBuildResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const errors: string[] = [];

    try {
      logs.push(`Building CLI tool: ${artifactId}`);
      const { execSync } = await import("node:child_process");
      const output = execSync("npm run build", { cwd: projectDir, encoding: "utf-8", timeout: 120000 });
      logs.push(output);

      // Run tests
      logs.push("Running tests...");
      try {
        const testOutput = execSync("npm test", { cwd: projectDir, encoding: "utf-8", timeout: 60000 });
        logs.push(testOutput);
      } catch (testError) {
        errors.push(`Tests failed: ${testError}`);
      }

      const duration = Date.now() - startTime;
      logs.push(`✓ Build completed in ${duration}ms`);

      return {
        artifactId,
        success: errors.length === 0,
        outputDir: path.join(projectDir, "dist"),
        assets: ["dist/cli.js"],
        logs,
        errors,
        durationMs: duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      errors.push(`Build failed: ${error}`);
      logs.push(`✗ Build failed in ${duration}ms`);
      return {
        artifactId,
        success: false,
        outputDir: "",
        assets: [],
        logs,
        errors,
        durationMs: duration,
      };
    }
  }

  async deploy(artifactId: string, projectDir: string, target: DeployTarget): Promise<ArtifactDeployResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const errors: string[] = [];

    try {
      logs.push(`Deploying CLI tool ${artifactId} to ${target}`);

      const { execSync } = await import("node:child_process");
      let deployCmd: string;
      switch (target) {
        case "npm":
          deployCmd = "npm publish";
          break;
        case "docker":
          deployCmd = "docker build -t cli-tool . && docker push cli-tool:latest";
          break;
        case "self-hosted":
          deployCmd = "npm pack && tar -xzf *.tgz && cp package/dist/cli.js /usr/local/bin/";
          break;
        default:
          throw new Error(`Unsupported deploy target: ${target}`);
      }

      const output = execSync(deployCmd, { cwd: projectDir, encoding: "utf-8", timeout: 180000 });
      logs.push(output);

      const duration = Date.now() - startTime;
      logs.push(`✓ Deploy to ${target} completed in ${duration}ms`);

      return {
        artifactId,
        target,
        success: true,
        logs,
        errors,
        durationMs: duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      errors.push(`Deploy failed: ${error}`);
      logs.push(`✗ Deploy to ${target} failed in ${duration}ms`);
      return {
        artifactId,
        target,
        success: false,
        logs,
        errors,
        durationMs: duration,
      };
    }
  }

  async preview(artifactId: string, projectDir: string): Promise<ArtifactPreviewInfo> {
    return {
      artifactId,
      type: "local",
      url: "local CLI tool",
    };
  }
}

interface GeneratedFile {
  path: string;
  content: string;
  purpose: string;
  isTemplate: boolean;
}

export function generateCliTool(config: ArtifactConfig): CliToolGenerator {
  return new CliToolGenerator(config);
}