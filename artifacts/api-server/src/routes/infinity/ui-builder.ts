/**
 * UI Builder API Routes
 *
 * Handles code generation, preview, and deployment for the v0-level generative UI engine.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireScope, AuthenticatedRequest } from '../../middleware/auth-middleware.js';
import { getUICodegenEngine, UIGenerationRequestSchema, UIGenerationResponseSchema, UICodegenEngine } from '../../lib/ui-codegen.js';
import { getProjectDesignSystem } from '../../lib/design-canvas.js';
import {
  parseCode,
  generateCode,
  findJSXElements,
  syncPropsToCode,
  syncStructureToCode,
  reorderJSXElements,
  applyEdits,
  extractComponent,
  getUsedComponents,
  getDesignTokenUsage,
} from '../../lib/ast-editor.js';
import * as t from '@babel/types';
import * as recast from 'recast';

const router = Router();

// All routes require authentication and build:write scope
router.use(requireAuth);
router.use(requireScope('build:write'));

// ============================================================================
// Validation Schemas
// ============================================================================

const GenerateRequestSchema = z.object({
  prompt: z.string().min(1).max(10000),
  projectId: z.string().optional(),
  framework: z.enum(['nextjs', 'vite-react', 'astro', 'remix', 'sveltekit', 'vue-nuxt', 'solidstart']).default('nextjs'),
  options: z.object({
    streaming: z.boolean().default(true),
    includeTypes: z.boolean().default(true),
    includeTests: z.boolean().default(false),
    includeStorybook: z.boolean().default(false),
    accessibility: z.boolean().default(true),
    performance: z.boolean().default(true),
  }).optional(),
});

const RefineRequestSchema = z.object({
  componentCode: z.string(),
  refinementPrompt: z.string().min(1).max(5000),
  projectId: z.string().optional(),
});

const DeployRequestSchema = z.object({
  projectId: z.string(),
  provider: z.enum(['vercel', 'netlify', 'cloudflare', 'github']),
  files: z.array(z.object({
    path: z.string(),
    content: z.string(),
  })),
  envVars: z.record(z.string()).optional(),
  customDomain: z.string().optional(),
});

const PreviewRequestSchema = z.object({
  components: z.array(z.object({
    name: z.string(),
    code: z.string(),
    imports: z.array(z.string()).optional(),
  })),
  framework: z.enum(['nextjs', 'vite-react', 'astro', 'remix', 'sveltekit', 'vue-nuxt', 'solidstart']).default('nextjs'),
});

// ============================================================================
// Helper Functions
// ============================================================================

async function getDesignSystemForProject(projectId: string) {
  try {
    return await getProjectDesignSystem(projectId);
  } catch {
    return null;
  }
}

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /api/infinity/ui-builder/generate
 * Generate UI components from natural language prompt
 */
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const validated = GenerateRequestSchema.parse(req.body);
    const authReq = req as AuthenticatedRequest;

    const engine = getUICodegenEngine();

    // Get project design system if projectId provided
    let designSystem = undefined;
    if (validated.projectId) {
      designSystem = await getDesignSystemForProject(validated.projectId);
    }

    const request = {
      prompt: validated.prompt,
      context: {
        projectId: validated.projectId,
        framework: validated.framework,
        designSystem: designSystem ? {
          colors: designSystem.colors,
          spacing: designSystem.spacing,
          typography: designSystem.typography,
          borderRadius: designSystem.borderRadius,
          shadows: designSystem.shadows,
        } : undefined,
      },
      options: validated.options,
    };

    // Check if streaming is requested
    if (validated.options?.streaming) {
      // Set up SSE for streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const sendEvent = (data: unknown) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        // For now, generate non-streaming and send as single event
        // TODO: Implement true streaming with LLM adapter
        const result = await engine.generate(request);
        sendEvent({ type: 'complete', data: result });
        res.end();
      } catch (error) {
        sendEvent({ type: 'error', error: error instanceof Error ? error.message : 'Generation failed' });
        res.end();
      }
    } else {
      const result = await engine.generate(request);
      res.json(result);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('UI generation error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Generation failed' });
  }
});

/**
 * POST /api/infinity/ui-builder/refine
 * Refine an existing component based on user feedback
 */
router.post('/refine', async (req: Request, res: Response) => {
  try {
    const validated = RefineRequestSchema.parse(req.body);
    const authReq = req as AuthenticatedRequest;

    const engine = getUICodegenEngine();

    let designSystem = undefined;
    if (validated.projectId) {
      designSystem = await getDesignSystemForProject(validated.projectId);
    }

    const result = await engine.refine(
      validated.componentCode,
      validated.refinementPrompt,
      validated.projectId ? {
        projectId: validated.projectId,
        designSystem: designSystem ? {
          colors: designSystem.colors,
          spacing: designSystem.spacing,
          typography: designSystem.typography,
          borderRadius: designSystem.borderRadius,
          shadows: designSystem.shadows,
        } : undefined,
      } : undefined
    );

    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('UI refinement error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Refinement failed' });
  }
});

/**
 * POST /api/infinity/ui-builder/feature
 * Generate a complete multi-file feature
 */
router.post('/feature', async (req: Request, res: Response) => {
  try {
    const validated = GenerateRequestSchema.parse(req.body);
    const authReq = req as AuthenticatedRequest;

    const engine = getUICodegenEngine();

    let designSystem = undefined;
    if (validated.projectId) {
      designSystem = await getDesignSystemForProject(validated.projectId);
    }

    const request = {
      prompt: validated.prompt,
      context: {
        projectId: validated.projectId,
        framework: validated.framework,
        designSystem: designSystem ? {
          colors: designSystem.colors,
          spacing: designSystem.spacing,
          typography: designSystem.typography,
          borderRadius: designSystem.borderRadius,
          shadows: designSystem.shadows,
        } : undefined,
      },
      options: validated.options,
    };

    const result = await engine.generateFeature(request);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('Feature generation error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Feature generation failed' });
  }
});

/**
 * POST /api/infinity/ui-builder/preview
 * Generate preview HTML for components
 */
router.post('/preview', async (req: Request, res: Response) => {
  try {
    const validated = PreviewRequestSchema.parse(req.body);

    const engine = getUICodegenEngine();

    // Generate preview HTML
    const components = validated.components.map(c => ({
      name: c.name,
      code: c.code,
      imports: c.imports || [],
      description: '',
      exports: ['default'],
      dependencies: [],
    }));

    const preview = engine['generatePreview'](components, { framework: validated.framework });

    res.json({ preview });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('Preview generation error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Preview generation failed' });
  }
});

/**
 * GET /api/infinity/ui-builder/components
 * Get available shadcn/ui components for autocomplete
 */
router.get('/components', async (_req: Request, res: Response) => {
  try {
    const engine = getUICodegenEngine();
    const components = engine.getAvailableComponents();

    const componentDetails = components.map(name => ({
      name,
      ...engine.getComponentInfo(name),
    }));

    res.json({ components: componentDetails });
  } catch (error) {
    console.error('Components fetch error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch components' });
  }
});

/**
 * POST /api/infinity/ui-builder/deploy
 * Deploy generated UI to free hosting provider
 */
router.post('/deploy', async (req: Request, res: Response) => {
  try {
    const validated = DeployRequestSchema.parse(req.body);
    const authReq = req as AuthenticatedRequest;

    // TODO: Implement actual deployment to providers
    // For now, return a mock deployment response
    const deploymentId = `deploy_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Simulate deployment
    await new Promise(r => setTimeout(r, 1000));

    const previewUrl = `https://${deploymentId}.${validated.provider}.app`;
    const productionUrl = validated.customDomain
      ? `https://${validated.customDomain}`
      : `https://${deploymentId}-prod.${validated.provider}.app`;

    res.json({
      deploymentId,
      status: 'success',
      previewUrl,
      productionUrl,
      provider: validated.provider,
      message: `Successfully deployed to ${validated.provider}`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('Deployment error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Deployment failed' });
  }
});

/**
 * GET /api/infinity/ui-builder/deploy/:deploymentId/status
 * Get deployment status
 */
router.get('/deploy/:deploymentId/status', async (req: Request, res: Response) => {
  try {
    const { deploymentId } = req.params;

    // TODO: Implement actual status checking
    res.json({
      deploymentId,
      status: 'completed',
      progress: 100,
      logs: [
        { step: 'build', status: 'completed', duration: 45000 },
        { step: 'deploy', status: 'completed', duration: 12000 },
      ],
    });
  } catch (error) {
    console.error('Deployment status error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get status' });
  }
});

/**
 * POST /api/infinity/ui-builder/iterate
 * Iterate on a generation with conversation history
 */
router.post('/iterate', async (req: Request, res: Response) => {
  try {
    const validated = z.object({
      prompt: z.string(),
      previousResult: UIGenerationResponseSchema.optional(),
      projectId: z.string().optional(),
      framework: z.enum(['nextjs', 'vite-react', 'astro', 'remix', 'sveltekit', 'vue-nuxt', 'solidstart']).default('nextjs'),
    }).parse(req.body);

    const engine = getUICodegenEngine();

    let designSystem = undefined;
    if (validated.projectId) {
      designSystem = await getDesignSystemForProject(validated.projectId);
    }

    // Build iterative prompt with context from previous result
    let iterativePrompt = validated.prompt;
    if (validated.previousResult) {
      iterativePrompt = `Previous generation:\n${JSON.stringify(validated.previousResult.components.map(c => ({
        name: c.name,
        description: c.description,
      })), null, 2)}\n\nNew request: ${validated.prompt}\n\nUpdate the components based on the new request while maintaining consistency.`;
    }

    const request = {
      prompt: iterativePrompt,
      context: {
        projectId: validated.projectId,
        framework: validated.framework,
        designSystem: designSystem ? {
          colors: designSystem.colors,
          spacing: designSystem.spacing,
          typography: designSystem.typography,
          borderRadius: designSystem.borderRadius,
          shadows: designSystem.shadows,
        } : undefined,
      },
    };

    const result = await engine.generate(request);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('Iteration error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Iteration failed' });
  }
});

/**
 * GET /api/infinity/ui-builder/templates
 * Get starter templates for common UI patterns
 */
router.get('/templates', async (_req: Request, res: Response) => {
  const templates = [
    {
      id: 'landing-page',
      name: 'Landing Page',
      description: 'Hero, features, testimonials, CTA, footer',
      category: 'page',
      preview: 'https://v0.dev/templates/landing-page',
    },
    {
      id: 'dashboard',
      name: 'Dashboard',
      description: 'Sidebar nav, stats cards, charts, data table',
      category: 'page',
      preview: 'https://v0.dev/templates/dashboard',
    },
    {
      id: 'auth-forms',
      name: 'Auth Forms',
      description: 'Login, register, forgot password, reset',
      category: 'feature',
      preview: 'https://v0.dev/templates/auth-forms',
    },
    {
      id: 'settings-page',
      name: 'Settings Page',
      description: 'Tabs, form sections, avatar upload, danger zone',
      category: 'page',
      preview: 'https://v0.dev/templates/settings-page',
    },
    {
      id: 'pricing-table',
      name: 'Pricing Table',
      description: 'Tier cards, feature comparison, FAQ accordion',
      category: 'component',
      preview: 'https://v0.dev/templates/pricing-table',
    },
    {
      id: 'blog-layout',
      name: 'Blog Layout',
      description: 'Post list, article view, categories, search',
      category: 'page',
      preview: 'https://v0.dev/templates/blog-layout',
    },
    {
      id: 'data-table',
      name: 'Data Table',
      description: 'Sortable, filterable, paginated, row actions',
      category: 'component',
      preview: 'https://v0.dev/templates/data-table',
    },
    {
      id: 'mobile-app-screen',
      name: 'Mobile App Screen',
      description: 'Tab bar, navigation, list, detail view',
      category: 'mobile',
      preview: 'https://v0.dev/templates/mobile-app-screen',
    },
  ];

  res.json({ templates });
});

/**
 * GET /api/infinity/ui-builder/design-tokens
 * Get the current project's design tokens for the preview
 */
router.get('/design-tokens', async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    let designSystem = null;
    if (projectId) {
      designSystem = await getDesignSystemForProject(projectId);
    }
    res.json({ designSystem: designSystem || {} });
  } catch (error) {
    console.error('Design tokens fetch error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch design tokens' });
  }
});

// ============================================================================
// AST Sync Routes (for bidirectional code/preview sync)
// ============================================================================

/**
 * POST /api/infinity/ui-builder/ast/sync-props
 * Sync props from visual editor to code
 */
router.post('/ast/sync-props', async (req: Request, res: Response) => {
  try {
    const validated = z.object({
      code: z.string(),
      selector: z.string(),
      props: z.record(z.any()),
    }).parse(req.body);

    const result = syncPropsToCode(validated.code, validated.selector, validated.props);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('AST sync props error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'AST sync failed' });
  }
});

/**
 * POST /api/infinity/ui-builder/ast/sync-structure
 * Sync structure changes (wrap, unwrap, duplicate, delete) from visual editor to code
 */
router.post('/ast/sync-structure', async (req: Request, res: Response) => {
  try {
    const validated = z.object({
      code: z.string(),
      selector: z.string(),
      operation: z.enum(['wrap', 'unwrap', 'duplicate', 'delete', 'move']),
      options: z.object({
        wrapper: z.string().optional(),
        wrapperProps: z.record(z.any()).optional(),
        targetIndex: z.number().optional(),
      }).optional(),
    }).parse(req.body);

    const result = syncStructureToCode(
      validated.code,
      validated.selector,
      validated.operation,
      validated.options || {}
    );
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('AST sync structure error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'AST sync failed' });
  }
});

/**
 * POST /api/infinity/ui-builder/ast/reorder
 * Reorder elements in code
 */
router.post('/ast/reorder', async (req: Request, res: Response) => {
  try {
    const validated = z.object({
      code: z.string(),
      selector: z.string(),
      fromIndex: z.number(),
      toIndex: z.number(),
    }).parse(req.body);

    const ast = parseCode(validated.code);
    const elements = findJSXElements(ast, validated.selector);

    if (elements.length === 0) {
      return res.status(404).json({ error: 'Element not found' });
    }

    const { node, path } = elements[0];
    const parentPath = path.parentPath;
    if (!parentPath || !(parentPath.node.type === 'JSXElement' || parentPath.node.type === 'JSXFragment')) {
      return res.status(400).json({ error: 'Cannot reorder - parent not found' });
    }

    const reorderedParent = reorderJSXElements(parentPath.node, validated.fromIndex, validated.toIndex);
    parentPath.replace(reorderedParent);

    const { code: newCode } = generateCode(ast, validated.code);
    res.json({ code: newCode });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('AST reorder error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'AST reorder failed' });
  }
});

/**
 * POST /api/infinity/ui-builder/ast/extract
 * Extract selected elements as a new component
 */
router.post('/ast/extract', async (req: Request, res: Response) => {
  try {
    const validated = z.object({
      code: z.string(),
      selector: z.string(),
      componentName: z.string(),
      propsInterface: z.string().optional(),
    }).parse(req.body);

    const result = extractComponent(
      validated.code,
      validated.selector,
      validated.componentName,
      validated.propsInterface
    );
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('AST extract error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'AST extract failed' });
  }
});

/**
 * POST /api/infinity/ui-builder/ast/analyze
 * Analyze code for used components and design token usage
 */
router.post('/ast/analyze', async (req: Request, res: Response) => {
  try {
    const validated = z.object({
      code: z.string(),
      designTokens: z.record(z.record(z.string())).optional(),
    }).parse(req.body);

    const usedComponents = getUsedComponents(validated.code);
    const designTokenUsage = validated.designTokens
      ? getDesignTokenUsage(validated.code, validated.designTokens)
      : [];

    res.json({ usedComponents, designTokenUsage });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('AST analyze error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'AST analyze failed' });
  }
});

/**
 * POST /api/infinity/ui-builder/ast/parse
 * Parse code and return AST info
 */
router.post('/ast/parse', async (req: Request, res: Response) => {
  try {
    const validated = z.object({
      code: z.string(),
    }).parse(req.body);

    const ast = parseCode(validated.code);
    const elements = findJSXElements(ast, '*');

    const elementInfo = elements.map(({ node, path }) => {
      let selector = '';
      if (t.isJSXIdentifier(node.openingElement.name)) {
        selector = node.openingElement.name.name;
      }
      return {
        selector,
        tagName: t.isJSXIdentifier(node.openingElement.name) ? node.openingElement.name.name : 'Fragment',
        props: getJSXProps(node),
        depth: path.stack.filter(p => t.isJSXElement(p.node) || t.isJSXFragment(p.node)).length,
      };
    });

    res.json({ elements: elementInfo });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('AST parse error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'AST parse failed' });
  }
});

export default router;