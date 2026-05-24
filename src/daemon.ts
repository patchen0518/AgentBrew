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
      const allTools: any[] = [];
      const promises = Array.from(this.clients.entries()).map(async ([prefix, client]) => {
        try {
          const response = await client.listTools();
          const tools = response.tools.map(tool => ({
            ...tool,
            name: `${prefix}__${tool.name}`
          }));
          return tools;
        } catch (e) {
          console.error(`Failed to list tools for ${prefix}:`, e);
          return [];
        }
      });
      
      const results = await Promise.all(promises);
      for (const tools of results) {
        allTools.push(...tools);
      }
      return { tools: allTools };
    });

    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const fullName = request.params.name;
      
      let matchedPrefix: string | undefined;
      let toolName: string | undefined;
      
      for (const prefix of this.clients.keys()) {
          if (fullName.startsWith(`${prefix}__`)) {
              matchedPrefix = prefix;
              toolName = fullName.substring(prefix.length + 2);
              break;
          }
      }
      
      if (!matchedPrefix || !toolName) {
          throw new Error("Invalid tool name format or unknown prefix");
      }
      
      const client = this.clients.get(matchedPrefix);
      if (!client) throw new Error(`No client found for prefix: ${matchedPrefix}`);
      
      return await client.callTool({
          name: toolName,
          arguments: request.params.arguments
      });
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
        try {
          const transport = new StdioClientTransport({
            command: server.command,
            args: server.args,
            stderr: 'inherit',
            cwd: pkg.path
          });
          const client = new Client({ name: "agentbrew-client", version: "1.0.0" }, { capabilities: {} });
          await client.connect(transport);
          this.clients.set(`${pkg.manifest.name}_${server.name}`, client);
        } catch (e) {
          console.error(`Failed to initialize server ${pkg.manifest.name}_${server.name}:`, e);
        }
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
