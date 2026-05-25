// tests/integration.test.ts
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

describe('Integration', () => {
    let TEST_HOME: string;

    beforeAll(async () => {
        TEST_HOME = path.join(os.tmpdir(), 'agentbrew-test-' + Date.now());
        fs.mkdirSync(TEST_HOME, { recursive: true });
        
        // Setup mock package
        const pkgDir = path.join(TEST_HOME, 'packages', 'mock-pkg');
        fs.mkdirSync(pkgDir, { recursive: true });
        
        const mockServerPath = path.join(__dirname, 'mock-mcp-server.ts');
        const tomlContent = `
name = "mock-pkg"
version = "1.0.0"
[[servers]]
name = "echo-server"
command = "npx"
args = ["ts-node", "${mockServerPath}"]
`;
        fs.writeFileSync(path.join(pkgDir, 'agentbrew.toml'), tomlContent);

        // Pre-generate the mcp-manifest.json as the router now uses lazy discovery from cache
        const manifestCache = {
            name: "mock-pkg",
            version: "1.0.0",
            servers: [
                {
                    name: "echo-server",
                    command: "npx",
                    args: ["ts-node", mockServerPath]
                }
            ],
            discovered: {
                tools: {
                    "echo-server": [
                        {
                            name: "echo",
                            description: "Echoes input",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    msg: { type: "string" }
                                }
                            }
                        }
                    ]
                },
                prompts: {},
                resources: {}
            }
        };
        fs.writeFileSync(path.join(pkgDir, 'mcp-manifest.json'), JSON.stringify(manifestCache, null, 2));
    });

    afterAll(async () => {
        // Give it a moment to die
        await new Promise(resolve => setTimeout(resolve, 500));
        fs.rmSync(TEST_HOME, { recursive: true, force: true });
    });

    test('should list tools and call echo tool via router', async () => {
        const transport = new StdioClientTransport({
            command: 'npx',
            args: ['ts-node', path.join(__dirname, '../src/cli.ts')],
            env: { ...process.env, AGENTBREW_ROOT: TEST_HOME }
        });

        const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
        await client.connect(transport);

        // List tools
        const toolsResponse = await client.listTools();
        expect(toolsResponse.tools).toBeDefined();
        const echoTool = toolsResponse.tools.find(t => t.name === 'mock-pkg_echo-server__echo');
        expect(echoTool).toBeDefined();

        // Call tool
        const callResponse = await client.callTool({
            name: 'mock-pkg_echo-server__echo',
            arguments: { msg: "integration-test" }
        });

        expect(callResponse.content).toBeDefined();
        const content = callResponse.content as any[];
        expect(content[0].type).toBe('text');
        expect(content[0].text).toBe('integration-test');

        await client.close();
    }, 20000); // Increase timeout for ts-node startup
});
