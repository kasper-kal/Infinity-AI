// Test script for MCP Client - tests filesystem MCP server
import { createBuiltinMCPClient, BUILTIN_MCP_SERVERS } from './artifacts/api-server/src/lib/mcp-client.js';

async function testFilesystemServer() {
  console.log('Testing Filesystem MCP Server...');

  try {
    // Create filesystem MCP client with project path
    const client = await createBuiltinMCPClient('filesystem', {
      args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
    });

    console.log('✓ Connected to filesystem MCP server');
    console.log('Server info:', client.getServerInfo());

    // List tools
    const tools = await client.listTools();
    console.log('\nAvailable tools:');
    for (const tool of tools) {
      console.log(`  - ${tool.name}: ${tool.description}`);
    }

    // Test calling a tool (list files)
    console.log('\nTesting list_files tool...');
    const result = await client.callTool('list_files', { path: '.' });
    console.log('Result:', JSON.stringify(result, null, 2));

    // Test reading a file
    console.log('\nTesting read_file tool...');
    const readResult = await client.callTool('read_file', { path: 'CLAUDE.md' });
    console.log('Read result (first 500 chars):', JSON.stringify(readResult).substring(0, 500));

    // Convert to universal tools
    const universalTools = client.toUniversalTools('mcp.test');
    console.log('\nUniversal tools created:', universalTools.length);
    for (const ut of universalTools) {
      console.log(`  - ${ut.name}: ${ut.description}`);
    }

    // Disconnect
    await client.disconnect();
    console.log('\n✓ Disconnected successfully');

  } catch (error) {
    console.error('Error:', error);
  }
}

async function testGitHubServer() {
  console.log('\n\nTesting GitHub MCP Server...');

  // Note: GitHub requires a token, so this will likely fail without one
  try {
    const client = await createBuiltinMCPClient('github', {
      headers: {
        Authorization: 'Bearer test-token', // This will fail without real token
      },
    });

    console.log('✓ Connected to GitHub MCP server');
    const tools = await client.listTools();
    console.log('Available tools:', tools.map(t => t.name));

    await client.disconnect();
  } catch (error) {
    console.log('Expected error (no valid token):', error instanceof Error ? error.message : String(error));
  }
}

async function main() {
  console.log('=== MCP Client Test Suite ===\n');
  console.log('Built-in servers available:', Object.keys(BUILTIN_MCP_SERVERS));

  await testFilesystemServer();
  await testGitHubServer();

  console.log('\n=== Test Complete ===');
}

main().catch(console.error);