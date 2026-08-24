// Test script for MCP Registry - tests integration with Universal Tool Registry
import { getMCPRegistry, setupProjectMCPServers } from './artifacts/api-server/src/lib/mcp-registry.js';
import { getAllTools } from './artifacts/api-server/src/lib/tool-registry.js';

async function testMCPRegistry() {
  console.log('Testing MCP Registry with Universal Tool Registry...\n');

  const projectId = 'test-project-' + Date.now();

  try {
    // Create registry for a test project
    const registry = getMCPRegistry(projectId);

    // Connect to filesystem server
    console.log('Connecting to filesystem MCP server...');
    await registry.connectBuiltinServer('filesystem', 'fs-server', {
      projectPath: process.cwd(),
    });

    // Wait longer for connection
    await new Promise(r => setTimeout(r, 3000));

    console.log('✓ Connected to filesystem server');

    // Wait a moment for tools to be registered
    await new Promise(r => setTimeout(r, 1000));

    // Check server status
    const status = registry.getServerStatus('fs-server');
    console.log('Server status:', status);

    // Get all MCP tools
    const mcpTools = registry.getAllMCPTools();
    console.log('\nMCP Tools registered:', mcpTools.length);
    for (const tool of mcpTools) {
      console.log(`  - ${tool.name}: ${tool.description}`);
    }

    // Check Universal Tool Registry
    const allTools = getAllTools();
    const mcpToolsInRegistry = allTools.filter(t => t.name.startsWith('mcp.'));
    console.log('\nMCP Tools in Universal Registry:', mcpToolsInRegistry.length);
    for (const tool of mcpToolsInRegistry) {
      console.log(`  - ${tool.name}: ${tool.description}`);
    }

    // Test calling a tool via Universal Tool Registry
    console.log('\nTesting tool execution via Universal Registry...');
    const listDirTool = mcpToolsInRegistry.find(t => t.name.includes('list_directory'));
    if (listDirTool) {
      const result = await listDirTool.execute({ path: '.' }, {} as any);
      console.log('list_directory result:', JSON.stringify(result).substring(0, 300));
    }

    // Test read_file
    const readFileTool = mcpToolsInRegistry.find(t => t.name.includes('read_text_file'));
    if (readFileTool) {
      const result = await readFileTool.execute({ path: 'CLAUDE.md' }, {} as any);
      console.log('read_text_file result (first 200 chars):', JSON.stringify(result).substring(0, 200));
    }

    // Test search_files
    const searchTool = mcpToolsInRegistry.find(t => t.name.includes('search_files'));
    if (searchTool) {
      const result = await searchTool.execute({ pattern: '*.md' }, {} as any);
      console.log('search_files result:', JSON.stringify(result).substring(0, 300));
    }

    // Disconnect
    await registry.disconnectServer('fs-server');
    console.log('\n✓ Disconnected from filesystem server');

    // Clean up
    await registry.shutdown();
    console.log('✓ Registry shutdown complete');

  } catch (error) {
    console.error('Error:', error);
  }
}

async function testSetupProjectMCPServers() {
  console.log('\n\nTesting setupProjectMCPServers helper...\n');

  const projectId = 'test-project-setup-' + Date.now();

  try {
    const registry = await setupProjectMCPServers(projectId, process.cwd(), [
      { type: 'filesystem', id: 'fs-main' },
      { type: 'fetch', id: 'fetch-web' },
    ]);

    console.log('✓ Project MCP servers setup complete');

    // Wait for connections
    await new Promise(r => setTimeout(r, 2000));

    // Check status
    const summary = registry.getSummary();
    console.log('Registry summary:', JSON.stringify(summary, null, 2));

    // Check universal tools
    const allTools = getAllTools();
    const mcpToolsInRegistry = allTools.filter(t => t.name.startsWith('mcp.'));
    console.log('\nTotal MCP Tools in Universal Registry:', mcpToolsInRegistry.length);

    // Clean up
    await registry.shutdown();

  } catch (error) {
    console.error('Error:', error);
  }
}

async function main() {
  console.log('=== MCP Registry Integration Test ===\n');

  await testMCPRegistry();
  await testSetupProjectMCPServers();

  console.log('\n=== Test Complete ===');
}

main().catch(console.error);