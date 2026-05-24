import { spawn, ChildProcess } from 'child_process';
import { discoverPackages, PackageInfo } from './registry';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export class Daemon {
  private processes: Map<string, ChildProcess> = new Map();
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
      const packages = discoverPackages();
      const allTools = [];
      for (const pkg of packages) {
        if (pkg.manifest.servers) {
          for (const server of pkg.manifest.servers) {
            // Placeholder: In a real implementation, we would query the child server for its tools
            allTools.push({
              name: `${pkg.manifest.name}_${server.name}`,
              description: `Tool from ${pkg.manifest.name}`,
              inputSchema: { type: "object", properties: {} },
            });
          }
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
        console.log(`Starting server '${server.name}' for package '${pkg.manifest.name}'...`);
        const child = spawn(server.command, server.args, {
          cwd: pkg.path,
          stdio: ['pipe', 'pipe', 'pipe']
        });

        child.on('exit', (code) => {
          console.log(`Server '${server.name}' exited with code ${code}`);
          this.processes.delete(server.name);
        });

        child.stderr?.on('data', (data) => {
          console.error(`[${server.name}] ${data}`);
        });

        this.processes.set(server.name, child);
      }
    }
  }

  async stop() {
    for (const [name, child] of this.processes) {
      console.log(`Stopping server '${name}'...`);
      child.kill();
    }
    this.processes.clear();
    await this.mcpServer.close();
  }
}

export async function startDaemon() {
  const daemon = new Daemon();
  await daemon.start();
  return daemon;
}
