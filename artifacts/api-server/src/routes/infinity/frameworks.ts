import { Router, Request, Response } from 'express';
import { requireAuth, requireScope, AuthenticatedRequest } from '../../middleware/auth-middleware';
import { FrameworkRegistry, getFrameworkAdapter, FRAMEWORK_METADATA } from '../../lib/framework-generators';
import { componentIRToFramework, parseFrameworkComponent } from '../../lib/component-ir';
import { generateDesignTokens } from '../../lib/design-token-pipeline';
import { z } from 'zod';

export const frameworksRouter = Router();

// All routes require authentication and build:write scope
frameworksRouter.use(requireAuth);
frameworksRouter.use(requireScope('build:write'));

// GET /api/infinity/frameworks - List all supported frameworks with metadata
frameworksRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const frameworks = Object.entries(FRAMEWORK_METADATA).map(([id, meta]) => ({
      id,
      ...meta,
      adapter: !!getFrameworkAdapter(id),
    }));

    res.json({
      success: true,
      frameworks,
      default: 'nextjs',
    });
  } catch (error) {
    console.error('Error fetching frameworks:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch frameworks' });
  }
});

// GET /api/infinity/frameworks/:id - Get detailed info for a specific framework
frameworksRouter.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const adapter = getFrameworkAdapter(id);

    if (!adapter) {
      return res.status(404).json({ success: false, error: 'Framework not found' });
    }

    const metadata = FRAMEWORK_METADATA[id as keyof typeof FRAMEWORK_METADATA];

    res.json({
      success: true,
      framework: {
        id,
        ...metadata,
        scaffold: {
          packageJson: adapter.generatePackageJson({ name: 'my-app', typescript: true, tailwind: true }),
          configFiles: adapter.generateConfigFiles({ name: 'my-app', typescript: true, tailwind: true }),
          folderStructure: adapter.getFolderStructure(),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching framework:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch framework' });
  }
});

// POST /api/infinity/frameworks/scaffold - Generate project scaffold for a framework
const scaffoldSchema = z.object({
  frameworkId: z.string(),
  projectName: z.string().min(1),
  typescript: z.boolean().default(true),
  tailwind: z.boolean().default(true),
  eslint: z.boolean().default(true),
  prettier: z.boolean().default(true),
  git: z.boolean().default(true),
  installDeps: z.boolean().default(false),
  extraDeps: z.array(z.string()).optional(),
  devDeps: z.array(z.string()).optional(),
});

frameworksRouter.post('/scaffold', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parseResult = scaffoldSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, error: 'Invalid request body', details: parseResult.error.flatten() });
    }

    const { frameworkId, projectName, typescript, tailwind, eslint, prettier, git, installDeps, extraDeps, devDeps } = parseResult.data;

    const adapter = getFrameworkAdapter(frameworkId);
    if (!adapter) {
      return res.status(404).json({ success: false, error: 'Framework not supported' });
    }

    const config = {
      name: projectName,
      typescript,
      tailwind,
      eslint,
      prettier,
    };

    const packageJson = adapter.generatePackageJson(config);
    const configFiles = adapter.generateConfigFiles(config);
    const folderStructure = adapter.getFolderStructure();

    // Add extra dependencies if provided
    if (extraDeps?.length) {
      packageJson.dependencies = { ...packageJson.dependencies, ...Object.fromEntries(extraDeps.map(d => [d, 'latest'])) };
    }
    if (devDeps?.length) {
      packageJson.devDependencies = { ...packageJson.devDependencies, ...Object.fromEntries(devDeps.map(d => [d, 'latest'])) };
    }

    const scaffold = {
      packageJson: JSON.stringify(packageJson, null, 2),
      configFiles: Object.fromEntries(
        Object.entries(configFiles).map(([path, content]) => [path, typeof content === 'string' ? content : JSON.stringify(content, null, 2)])
      ),
      folderStructure,
      commands: {
        install: installDeps ? getInstallCommand(packageJson) : undefined,
        dev: packageJson.scripts?.dev,
        build: packageJson.scripts?.build,
        preview: packageJson.scripts?.preview,
      },
    };

    res.json({ success: true, scaffold });
  } catch (error) {
    console.error('Error generating scaffold:', error);
    res.status(500).json({ success: false, error: 'Failed to generate scaffold' });
  }
});

// POST /api/infinity/frameworks/transpile - Transpile component IR to framework-specific code
const transpileSchema = z.object({
  frameworkId: z.string(),
  componentIR: z.any(), // ComponentIR schema
  options: z.object({
    includeStyles: z.boolean().default(true),
    includeTypes: z.boolean().default(true),
    optimize: z.boolean().default(false),
  }).optional(),
});

frameworksRouter.post('/transpile', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parseResult = transpileSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, error: 'Invalid request body', details: parseResult.error.flatten() });
    }

    const { frameworkId, componentIR, options = {} } = parseResult.data;

    const adapter = getFrameworkAdapter(frameworkId);
    if (!adapter) {
      return res.status(404).json({ success: false, error: 'Framework not supported' });
    }

    // Validate component IR
    const validation = parseFrameworkComponent(componentIR);
    if (!validation.success) {
      return res.status(400).json({ success: false, error: 'Invalid component IR', details: validation.error });
    }

    const result = componentIRToFramework(componentIR, frameworkId, {
      includeStyles: options.includeStyles,
      includeTypes: options.includeTypes,
      optimize: options.optimize,
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: 'Transpilation failed', details: result.errors });
    }

    res.json({ success: true, code: result.code, dependencies: result.dependencies });
  } catch (error) {
    console.error('Error transpiling component:', error);
    res.status(500).json({ success: false, error: 'Failed to transpile component' });
  }
});

// POST /api/infinity/frameworks/parse - Parse framework-specific code to component IR
const parseSchema = z.object({
  frameworkId: z.string(),
  code: z.string(),
  filePath: z.string().optional(),
});

frameworksRouter.post('/parse', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parseResult = parseSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, error: 'Invalid request body', details: parseResult.error.flatten() });
    }

    const { frameworkId, code, filePath } = parseResult.data;

    const adapter = getFrameworkAdapter(frameworkId);
    if (!adapter) {
      return res.status(404).json({ success: false, error: 'Framework not supported' });
    }

    // This would use the framework's parser to convert code to IR
    // For now, we'll return a basic structure
    const componentIR = await adapter.parseComponent?.(code, filePath) || {
      type: 'component',
      name: 'ParsedComponent',
      framework: frameworkId,
      props: [],
      imports: [],
      exports: [],
      jsx: code,
      styles: [],
      metadata: { sourceFile: filePath },
    };

    res.json({ success: true, componentIR });
  } catch (error) {
    console.error('Error parsing component:', error);
    res.status(500).json({ success: false, error: 'Failed to parse component' });
  }
});

// POST /api/infinity/frameworks/design-tokens - Generate design tokens for a framework
const designTokensSchema = z.object({
  frameworkId: z.string(),
  tokens: z.record(z.any()).optional(),
  format: z.enum(['css-vars', 'tailwind', 'unocss', 'native', 'json', 'scss', 'js-module']).default('css-vars'),
});

frameworksRouter.post('/design-tokens', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parseResult = designTokensSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, error: 'Invalid request body', details: parseResult.error.flatten() });
    }

    const { frameworkId, tokens, format } = parseResult.data;

    const adapter = getFrameworkAdapter(frameworkId);
    if (!adapter) {
      return res.status(404).json({ success: false, error: 'Framework not supported' });
    }

    const designTokens = generateDesignTokens(tokens || {}, format, frameworkId);

    res.json({ success: true, tokens: designTokens });
  } catch (error) {
    console.error('Error generating design tokens:', error);
    res.status(500).json({ success: false, error: 'Failed to generate design tokens' });
  }
});

// POST /api/infinity/frameworks/detect - Auto-detect framework from project files
const detectSchema = z.object({
  files: z.record(z.string()), // filePath -> content
  packageJson: z.any().optional(),
});

frameworksRouter.post('/detect', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parseResult = detectSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, error: 'Invalid request body', details: parseResult.error.flatten() });
    }

    const { files, packageJson } = parseResult.data;

    const detected = FrameworkRegistry.detectFramework(files, packageJson);

    if (!detected) {
      return res.json({ success: true, detected: null, message: 'Could not detect framework' });
    }

    const metadata = FRAMEWORK_METADATA[detected as keyof typeof FRAMEWORK_METADATA];

    res.json({
      success: true,
      detected: {
        id: detected,
        ...metadata,
        confidence: 0.9, // TODO: Implement confidence scoring
      },
    });
  } catch (error) {
    console.error('Error detecting framework:', error);
    res.status(500).json({ success: false, error: 'Failed to detect framework' });
  }
});

// POST /api/infinity/frameworks/migrate - Migrate project from one framework to another
const migrateSchema = z.object({
  fromFrameworkId: z.string(),
  toFrameworkId: z.string(),
  files: z.record(z.string()), // filePath -> content
  options: z.object({
    preserveGitHistory: z.boolean().default(true),
    updatePackageJson: z.boolean().default(true),
    convertComponents: z.boolean().default(true),
    convertConfig: z.boolean().default(true),
    convertStyles: z.boolean().default(true),
  }).optional(),
});

frameworksRouter.post('/migrate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parseResult = migrateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, error: 'Invalid request body', details: parseResult.error.flatten() });
    }

    const { fromFrameworkId, toFrameworkId, files, options = {} } = parseResult.data;

    const fromAdapter = getFrameworkAdapter(fromFrameworkId);
    const toAdapter = getFrameworkAdapter(toFrameworkId);

    if (!fromAdapter || !toAdapter) {
      return res.status(404).json({ success: false, error: 'One or both frameworks not supported' });
    }

    // This is a complex operation that would use migration-tools
    // For now, return a placeholder response indicating the migration would be performed
    const migrations = {
      packageJson: options.updatePackageJson ? 'Would migrate package.json' : undefined,
      configFiles: options.convertConfig ? 'Would migrate config files' : undefined,
      components: options.convertComponents ? 'Would transpile components' : undefined,
      styles: options.convertStyles ? 'Would convert styles' : undefined,
    };

    res.json({
      success: true,
      message: `Migration from ${fromFrameworkId} to ${toFrameworkId} prepared`,
      migrations,
      note: 'Full migration implementation requires migration-tools module',
    });
  } catch (error) {
    console.error('Error preparing migration:', error);
    res.status(500).json({ success: false, error: 'Failed to prepare migration' });
  }
});

// Helper function to get install command based on package.json
function getInstallCommand(packageJson: any): string {
  const hasPnpmLock = packageJson.packageManager?.includes('pnpm');
  const hasYarnLock = packageJson.packageManager?.includes('yarn');
  const hasBunLock = packageJson.packageManager?.includes('bun');

  if (hasPnpmLock) return 'pnpm install';
  if (hasYarnLock) return 'yarn install';
  if (hasBunLock) return 'bun install';
  return 'npm install';
}

export default frameworksRouter;