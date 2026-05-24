import { discoverPackages, PackageInfo } from './registry';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export class Daemon {
  private clients: Map<string, Client> = new Map();
  private mcpServer: Server;

  constructor() {
    this.mcpServer = new Server(
      {
        name: "agentbrew-router",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupMcpHandlers();
  }

  private setupMcpHandlers() {
    this.mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
      const allTools = [];
      for (const [prefix, client] of this.clients) {
        const response = await client.listTools();
        for (const tool of response.tools) {
            allTools.push({
                ...tool,
                name: `${prefix}_${tool.name}`
            });
        }
      }
      return { tools: allTools };
    });

    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      console.log(`Routing tool call: ${request.params.name}`);
      // Routing logic to child processes would go here
      return {
        content: [{ type: "text", text: `Routed call to ${request.params.name}` }],
      };
    });
  }

  async start() {
    console.log("AgentBrew Daemon starting...");
    const packages = discoverPackages();
    console.log(`Discovered ${packages.length} packages.`);

    for (const pkg of packages) {
      await this.initializePackage(pkg);
    }

    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
    console.log("AgentBrew MCP Router connected via Stdio");

    return true;
  }

  private async initializePackage(pkg: PackageInfo) {
    if (pkg.manifest.servers) {
      for (const server of pkg.manifest.servers) {
        const transport = new StdioClientTransport({
          command: server.command,
          args: server.args,
          stderr: 'inherit',
          cwd: pkg.path
        });
        const client = new Client({ name: "agentbrew-client", version: "1.0.0" }, { capabilities: {} });
        await client.connect(transport);
        this.clients.set(`${pkg.manifest.name}_${server.name}`, client);
      }
    }
  }

  async stop() {
    for (const [name, client] of this.clients) {
      console.log(`Stopping client '${name}'...`);
      await client.close();
    }
    this.clients.clear();
    await this.mcpServer.close();
  }
}

export async function startDaemon() {
  const daemon = new Daemon();
  await daemon.start();
  return daemon;
}
