/**
 * AST Editor - Bidirectional code/preview synchronization
 *
 * Uses Babel/Recast for precise code modifications while preserving
 * formatting, comments, and code structure.
 */

import * as babel from '@babel/core';
import * as recast from 'recast';
import * as t from '@babel/types';

interface Position {
  line: number;
  column: number;
}

interface Range {
  start: Position;
  end: Position;
}

interface AstNode {
  type: string;
  loc?: Range;
  [key: string]: unknown;
}

interface EditOperation {
  type: 'replace' | 'insert' | 'delete' | 'wrap' | 'unwrap' | 'move';
  target: string; // CSS-like selector or node path
  content?: string;
  attributes?: Record<string, string>;
  position?: 'before' | 'after' | 'prepend' | 'append';
}

interface TransformResult {
  code: string;
  map?: any;
  changes: Array<{
    type: string;
    nodeType: string;
    range: Range;
    description: string;
  }>;
}

/**
 * Parse source code into AST with source map preservation
 */
export function parseCode(source: string, filename = 'preview.tsx'): babel.File {
  return babel.parseSync(source, {
    filename,
    sourceType: 'module',
    plugins: [
      'typescript',
      'jsx',
      ['decorators', { decoratorsBeforeExport: true }],
      'classProperties',
    ],
    parserOpts: {
      sourceFileName: filename,
      allowReturnOutsideFunction: true,
    },
    retainLines: true,
  }) as babel.File;
}

/**
 * Generate code from AST preserving formatting
 */
export function generateCode(ast: babel.File, source: string): TransformResult {
  const originalLines = source.split('\n');

  const result = babel.transformFromAstSync(ast, source, {
    filename: 'preview.tsx',
    sourceMaps: true,
    retainLines: true,
    compact: false,
    presets: [
      ['@babel/preset-typescript', { allowDeclareFields: true }],
      ['@babel/preset-react', { runtime: 'automatic' }],
    ],
    generatorOpts: {
      retainLines: true,
      compact: false,
      concise: false,
    },
  });

  return {
    code: result?.code || source,
    map: result?.map,
    changes: [],
  };
}

/**
 * Find JSX elements matching a selector
 * Selector format: "ComponentName" or "ComponentName[prop=value]" or "[data-id=xxx]"
 */
export function findJSXElements(
  ast: babel.File,
  selector: string
): Array<{ node: t.JSXElement | t.JSXFragment; path: recast.NodePath<t.JSXElement | t.JSXFragment> }> {
  const results: Array<{ node: t.JSXElement | t.JSXFragment; path: recast.NodePath<t.JSXElement | t.JSXFragment> }> = [];

  recast.visit(ast, {
    visitJSXElement(path) {
      const node = path.node;

      // Match by component name
      if (t.isJSXIdentifier(node.openingElement.name)) {
        const componentName = node.openingElement.name.name;

        // Simple name match
        if (selector === componentName || selector === `*${componentName}`) {
          results.push({ node, path });
        }

        // Match with attribute: ComponentName[prop=value]
        const attrMatch = selector.match(/^(\w+)\[([^=]+)=([^\]]+)\]$/);
        if (attrMatch && attrMatch[1] === componentName) {
          const [, , attrName, attrValue] = attrMatch;
          const attr = node.openingElement.attributes.find(
            a => t.isJSXAttribute(a) && a.name.name === attrName
          );
          if (attr && t.isStringLiteral(attr.value) && attr.value.value === attrValue) {
            results.push({ node, path });
          }
        }

        // Match data attribute: [data-id=xxx]
        const dataMatch = selector.match(/^\[data-([^\]=]+)=([^\]]+)\]$/);
        if (dataMatch) {
          const [, dataAttr, dataValue] = dataMatch;
          const attr = node.openingElement.attributes.find(
            a => t.isJSXAttribute(a) && a.name.name === `data-${dataAttr}`
          );
          if (attr && t.isStringLiteral(attr.value) && attr.value.value === dataValue) {
            results.push({ node, path });
          }
        }
      }

      this.traverse(path);
    },

    visitJSXFragment(path) {
      // For fragments, check if selector is "fragment" or matches a child
      if (selector === 'fragment' || selector === 'Fragment') {
        results.push({ node: path.node, path });
      }
      this.traverse(path);
    },
  });

  return results;
}

/**
 * Get all props from a JSX element
 */
export function getJSXProps(element: t.JSXElement): Record<string, any> {
  const props: Record<string, any> = {};

  for (const attr of element.openingElement.attributes) {
    if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name)) {
      const name = attr.name.name;
      if (attr.value) {
        if (t.isStringLiteral(attr.value)) {
          props[name] = attr.value.value;
        } else if (t.isJSXExpressionContainer(attr.value)) {
          props[name] = getExpressionValue(attr.value.expression);
        }
      } else {
        // Boolean prop (just the attribute name)
        props[name] = true;
      }
    } else if (t.isJSXSpreadAttribute(attr)) {
      props['...spread'] = getExpressionValue(attr.argument);
    }
  }

  return props;
}

/**
 * Extract value from expression (simplified)
 */
function getExpressionValue(node: t.Expression): any {
  if (t.isStringLiteral(node)) return node.value;
  if (t.isNumericLiteral(node)) return node.value;
  if (t.isBooleanLiteral(node)) return node.value;
  if (t.isNullLiteral(node)) return null;
  if (t.isObjectExpression(node)) {
    const obj: Record<string, any> = {};
    for (const prop of node.properties) {
      if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
        obj[prop.key.name] = getExpressionValue(prop.value);
      }
    }
    return obj;
  }
  if (t.isArrayExpression(node)) {
    return node.elements.map(e => e ? getExpressionValue(e) : null);
  }
  if (t.isIdentifier(node)) return `{${node.name}}`; // Variable reference
  if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) {
    return '() => {...}';
  }
  return recast.print(node).code;
}

/**
 * Set/replace a prop on a JSX element
 */
export function setJSXProp(
  element: t.JSXElement,
  propName: string,
  value: any,
  options: { isSpread?: boolean; spreadPath?: string } = {}
): t.JSXElement {
  const newElement = recast.types.namedTypes.JSXElement.assert(element);

  // Check if prop already exists
  const existingIndex = newElement.openingElement.attributes.findIndex(
    a => t.isJSXAttribute(a) && a.name.name === propName
  );

  let valueNode: t.JSXExpressionContainer | t.StringLiteral | null = null;

  if (value === true) {
    // Boolean prop - no value needed
    valueNode = null;
  } else if (typeof value === 'string') {
    valueNode = t.stringLiteral(value);
  } else if (typeof value === 'number') {
    valueNode = t.numericLiteral(value);
  } else if (typeof value === 'boolean') {
    valueNode = t.booleanLiteral(value);
  } else if (value === null) {
    valueNode = t.nullLiteral();
  } else if (typeof value === 'object') {
    valueNode = t.jsxExpressionContainer(createObjectExpression(value));
  }

  const newAttr = t.jsxAttribute(t.jsxIdentifier(propName), valueNode);

  if (existingIndex >= 0) {
    // Replace existing
    newElement.openingElement.attributes[existingIndex] = newAttr;
  } else {
    // Add new
    newElement.openingElement.attributes.push(newAttr);
  }

  return newElement;
}

/**
 * Create object expression from plain object
 */
function createObjectExpression(obj: Record<string, any>): t.ObjectExpression {
  const properties = Object.entries(obj).map(([key, value]) => {
    let valNode: t.Expression;
    if (typeof value === 'string') valNode = t.stringLiteral(value);
    else if (typeof value === 'number') valNode = t.numericLiteral(value);
    else if (typeof value === 'boolean') valNode = t.booleanLiteral(value);
    else if (value === null) valNode = t.nullLiteral();
    else if (typeof value === 'object') valNode = createObjectExpression(value);
    else valNode = t.identifier(String(value));

    return t.objectProperty(t.identifier(key), valNode);
  });

  return t.objectExpression(properties);
}

/**
 * Remove a prop from a JSX element
 */
export function removeJSXProp(element: t.JSXElement, propName: string): t.JSXElement {
  const newElement = recast.types.namedTypes.JSXElement.assert(element);

  newElement.openingElement.attributes = newElement.openingElement.attributes.filter(
    a => !(t.isJSXAttribute(a) && a.name.name === propName)
  );

  return newElement;
}

/**
 * Update element children
 */
export function setJSXChildren(element: t.JSXElement, children: t.JSXChild[]): t.JSXElement {
  const newElement = recast.types.namedTypes.JSXElement.assert(element);
  newElement.children = children;
  return newElement;
}

/**
 * Wrap element with another component
 */
export function wrapJSXElement(
  element: t.JSXElement,
  wrapperName: string,
  wrapperProps: Record<string, any> = {}
): t.JSXElement {
  const wrapperElement = t.jsxElement(
    t.jsxOpeningElement(
      t.jsxIdentifier(wrapperName),
      Object.entries(wrapperProps).map(([key, value]) =>
        t.jsxAttribute(t.jsxIdentifier(key), typeof value === 'string' ? t.stringLiteral(value) : t.jsxExpressionContainer(createObjectExpression(value)))
      ),
      false
    ),
    t.jsxClosingElement(t.jsxIdentifier(wrapperName)),
    [element],
    false
  );

  return wrapperElement;
}

/**
 * Unwrap element (replace with its children)
 */
export function unwrapJSXElement(element: t.JSXElement): t.JSXChild[] {
  return element.children;
}

/**
 * Reorder elements (move element at index to new index)
 */
export function reorderJSXElements(
  parent: t.JSXElement | t.JSXFragment,
  fromIndex: number,
  toIndex: number
): t.JSXElement | t.JSXFragment {
  const newParent = recast.types.namedTypes.JSXElement.assert(parent) || recast.types.namedTypes.JSXFragment.assert(parent);
  const children = [...newParent.children];

  if (fromIndex < 0 || fromIndex >= children.length) return newParent;

  const [removed] = children.splice(fromIndex, 1);
  const insertIndex = Math.min(toIndex, children.length);
  children.splice(insertIndex, 0, removed);

  if (t.isJSXElement(newParent)) {
    newParent.children = children;
  } else if (t.isJSXFragment(newParent)) {
    newParent.children = children;
  }

  return newParent;
}

/**
 * Duplicate an element
 */
export function duplicateJSXElement(element: t.JSXElement): t.JSXElement {
  return recast.types.namedTypes.JSXElement.assert(recast.parse(recast.print(element).code).program.body[0]);
}

/**
 * Apply multiple edit operations to code
 */
export function applyEdits(source: string, operations: EditOperation[]): TransformResult {
  const ast = parseCode(source);
  const changes: TransformResult['changes'] = [];

  // Sort operations by line number (bottom-up to preserve positions)
  const opsWithPositions = operations.map(op => {
    const elements = findJSXElements(ast, op.target);
    return { op, elements, line: elements[0]?.node.loc?.start.line || 0 };
  }).sort((a, b) => b.line - a.line);

  for (const { op, elements } of opsWithPositions) {
    for (const { node, path } of elements) {
      let newNode: t.JSXElement | t.JSXFragment | null = node;
      let description = '';

      switch (op.type) {
        case 'replace':
          if (op.content) {
            const newAst = parseCode(op.content);
            const newElement = findJSXElements(newAst, '*')[0]?.node;
            if (newElement) {
              newNode = newElement;
              description = `Replaced ${getNodeName(node)} with ${op.content.substring(0, 50)}`;
            }
          }
          break;

        case 'insert':
          if (op.content) {
            const newAst = parseCode(op.content);
            const newElement = findJSXElements(newAst, '*')[0]?.node;
            if (newElement && t.isJSXElement(node)) {
              const position = op.position || 'append';
              if (position === 'prepend') {
                node.children.unshift(newElement);
              } else if (position === 'after') {
                // Insert after current node in parent
                description = `Inserted after ${getNodeName(node)}`;
              } else {
                node.children.push(newElement);
              }
              description = `Inserted ${op.content.substring(0, 50)} ${position} ${getNodeName(node)}`;
            }
          }
          break;

        case 'delete':
          // Mark for removal by setting a special property
          (node as any).__toDelete = true;
          description = `Deleted ${getNodeName(node)}`;
          break;

        case 'wrap':
          if (op.content) {
            newNode = wrapJSXElement(node, op.content, op.attributes || {});
            description = `Wrapped ${getNodeName(node)} with <${op.content}>`;
          }
          break;

        case 'unwrap':
          // Replace with children
          description = `Unwrapped ${getNodeName(node)}`;
          break;

        case 'move':
          // Handled separately as it needs parent context
          break;
      }

      if (newNode && newNode !== node) {
        path.replace(newNode);
      }

      if (description) {
        changes.push({
          type: op.type,
          nodeType: getNodeName(node),
          range: node.loc || { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
          description,
        });
      }
    }
  }

  // Clean up deleted nodes
  recast.visit(ast, {
    visitJSXElement(path) {
      if ((path.node as any).__toDelete) {
        const parentPath = path.parentPath;
        if (parentPath && (t.isJSXElement(parentPath.node) || t.isJSXFragment(parentPath.node))) {
          const parent = parentPath.node;
          parent.children = parent.children.filter((child: any) => child !== path.node);
        } else {
          path.prune();
        }
      }
      this.traverse(path);
    },
  });

  return generateCode(ast, source);
}

/**
 * Get display name for a JSX node
 */
function getNodeName(node: t.JSXElement | t.JSXFragment): string {
  if (t.isJSXFragment(node)) return 'Fragment';
  if (t.isJSXIdentifier(node.openingElement.name)) {
    return node.openingElement.name.name;
  }
  return 'Element';
}

/**
 * Sync props from preview selection to code
 */
export function syncPropsToCode(
  source: string,
  selector: string,
  props: Record<string, any>
): TransformResult {
  const ast = parseCode(source);
  const elements = findJSXElements(ast, selector);
  const changes: TransformResult['changes'] = [];

  for (const { node, path } of elements) {
    let newNode = node;

    for (const [propName, propValue] of Object.entries(props)) {
      if (propValue === undefined || propValue === null) {
        newNode = removeJSXProp(newNode, propName);
        changes.push({
          type: 'remove-prop',
          nodeType: getNodeName(node),
          range: node.loc || { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
          description: `Removed prop ${propName}`,
        });
      } else {
        newNode = setJSXProp(newNode, propName, propValue);
        changes.push({
          type: 'set-prop',
          nodeType: getNodeName(node),
          range: node.loc || { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
          description: `Set ${propName}="${propValue}"`,
        });
      }
    }

    if (newNode !== node) {
      path.replace(newNode);
    }
  }

  return generateCode(ast, source);
}

/**
 * Sync structure changes (wrap, unwrap, reorder, duplicate) from preview to code
 */
export function syncStructureToCode(
  source: string,
  selector: string,
  operation: 'wrap' | 'unwrap' | 'duplicate' | 'delete' | 'move',
  options: { wrapper?: string; wrapperProps?: Record<string, any>; targetIndex?: number } = {}
): TransformResult {
  const ast = parseCode(source);
  const elements = findJSXElements(ast, selector);
  const changes: TransformResult['changes'] = [];

  for (const { node, path } of elements) {
    let newNode: t.JSXElement | t.JSXFragment | t.JSXChild[] | null = node;
    let description = '';

    switch (operation) {
      case 'wrap':
        if (options.wrapper) {
          newNode = wrapJSXElement(node, options.wrapper, options.wrapperProps || {});
          description = `Wrapped ${getNodeName(node)} with <${options.wrapper}>`;
        }
        break;

      case 'unwrap':
        newNode = unwrapJSXElement(node);
        description = `Unwrapped ${getNodeName(node)}`;
        break;

      case 'duplicate':
        newNode = [node, duplicateJSXElement(node)];
        description = `Duplicated ${getNodeName(node)}`;
        break;

      case 'delete':
        newNode = [];
        description = `Deleted ${getNodeName(node)}`;
        break;

      case 'move':
        // Move requires parent context - handled differently
        description = `Move ${getNodeName(node)} to index ${options.targetIndex}`;
        break;
    }

    if (Array.isArray(newNode)) {
      // Multiple nodes - replace parent's child array
      const parentPath = path.parentPath;
      if (parentPath && (t.isJSXElement(parentPath.node) || t.isJSXFragment(parentPath.node))) {
        const parent = parentPath.node;
        const childIndex = parent.children.indexOf(node);
        parent.children.splice(childIndex, 1, ...newNode);
      }
    } else if (newNode !== node) {
      path.replace(newNode);
    }

    if (description) {
      changes.push({
        type: operation,
        nodeType: getNodeName(node),
        range: node.loc || { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
        description,
      });
    }
  }

  return generateCode(ast, source);
}

/**
 * Extract a component from selected elements
 */
export function extractComponent(
  source: string,
  selector: string,
  componentName: string,
  propsInterface?: string
): { componentCode: string; updatedSource: string } {
  const ast = parseCode(source);
  const elements = findJSXElements(ast, selector);

  if (elements.length === 0) {
    throw new Error(`No elements found for selector: ${selector}`);
  }

  // Create new component from selected elements
  const componentElements = elements.map(e => e.node);

  // Generate component code
  const componentBody = componentElements.length === 1
    ? componentElements[0]
    : t.jsxFragment(
        t.jsxOpeningFragment(),
        t.jsxClosingFragment(),
        componentElements,
        false
      );

  const componentProps = propsInterface
    ? `{ ${propsInterface} }`
    : '{}';

  const componentCode = `import React from 'react';
import { cn } from '@/lib/utils';

interface ${componentName}Props ${componentProps}

export function ${componentName}({ className, ...props }: ${componentName}Props) {
  return (
${recast.print(componentBody).code}
  );
}
`;

  // Replace selected elements with new component usage
  const updatedResult = syncStructureToCode(source, selector, 'wrap', {
    wrapper: componentName,
    wrapperProps: { '...props': true },
  });

  return {
    componentCode,
    updatedSource: updatedResult.code,
  };
}

/**
 * Get all component names used in code
 */
export function getUsedComponents(source: string): string[] {
  const ast = parseCode(source);
  const components = new Set<string>();

  recast.visit(ast, {
    visitJSXElement(path) {
      if (t.isJSXIdentifier(path.node.openingElement.name)) {
        components.add(path.node.openingElement.name.name);
      }
      this.traverse(path);
    },
  });

  return Array.from(components).sort();
}

/**
 * Get design token usage in code (Tailwind classes that reference design tokens)
 */
export function getDesignTokenUsage(source: string, tokens: Record<string, Record<string, string>>): string[] {
  const usage: string[] = [];
  const classRegex = /className\s*=\s*["'`]([^"'`]+)["'`]/g;

  let match;
  while ((match = classRegex.exec(source)) !== null) {
    const classes = match[1].split(/\s+/);
    for (const cls of classes) {
      // Check if class references a design token pattern
      for (const [category, tokenMap] of Object.entries(tokens)) {
        for (const [tokenName, tokenValue] of Object.entries(tokenMap)) {
          if (cls.includes(tokenName) || cls.includes(tokenValue)) {
            usage.push(`${category}.${tokenName} (${cls})`);
          }
        }
      }
    }
  }

  return Array.from(new Set(usage));
}