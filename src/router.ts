import { discoverPackages, PackageInfo } from './registry';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export class Router {
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
          prompts: {},
          resources: {},
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
      const { prefix, name } = this.parseName(fullName);
      
      const client = this.clients.get(prefix);
      if (!client) throw new Error(`No client found for prefix: ${prefix}`);
      
      return await client.callTool({
          name: name,
          arguments: request.params.arguments
      });
    });

    // Prompts
    this.mcpServer.setRequestHandler(ListPromptsRequestSchema, async () => {
      const allPrompts: any[] = [];
      const promises = Array.from(this.clients.entries()).map(async ([prefix, client]) => {
        try {
          const response = await client.listPrompts();
          return response.prompts.map(prompt => ({
            ...prompt,
            name: `${prefix}__${prompt.name}`
          }));
        } catch (e) {
          return [];
        }
      });
      const results = await Promise.all(promises);
      results.forEach(p => allPrompts.push(...p));
      return { prompts: allPrompts };
    });

    this.mcpServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { prefix, name } = this.parseName(request.params.name);
      const client = this.clients.get(prefix);
      if (!client) throw new Error(`No client found for prefix: ${prefix}`);
      return await client.getPrompt({
        name: name,
        arguments: request.params.arguments
      });
    });

    // Resources
    this.mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => {
      const allResources: any[] = [];
      const promises = Array.from(this.clients.entries()).map(async ([prefix, client]) => {
        try {
          const response = await client.listResources();
          return response.resources.map(resource => ({
            ...resource,
            name: `${prefix}__${resource.name}`
          }));
        } catch (e) {
          return [];
        }
      });
      const results = await Promise.all(promises);
      results.forEach(r => allResources.push(...r));
      return { resources: allResources };
    });

    this.mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      // For ReadResource, we look at the URI. 
      // This is trickier as URIs don't have our prefix.
      // However, if we assume ListResources returned prefixed names, we might need a better strategy.
      // Actually, many agents use URI directly.
      // For now, let's prefix the URIs too during ListResources if we want to be safe, 
      // but standard MCP URI schemes might break.
      // Let's stick to name-based routing where possible.
      // ReadResource doesn't take a name, it takes a URI.
      // We'll have to broadcast or track which client owns which URI.
      
      // Simple broadcast strategy for ReadResource:
      for (const client of this.clients.values()) {
        try {
          return await client.readResource({ uri: request.params.uri });
        } catch (e) {
          // Continue to next client
        }
      }
      throw new Error(`Resource not found: ${request.params.uri}`);
    });

    this.mcpServer.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      const allTemplates: any[] = [];
      const promises = Array.from(this.clients.entries()).map(async ([prefix, client]) => {
        try {
          const response = await client.listResourceTemplates();
          return response.resourceTemplates.map(template => ({
            ...template,
            name: `${prefix}__${template.name}`
          }));
        } catch (e) {
          return [];
        }
      });
      const results = await Promise.all(promises);
      results.forEach(t => allTemplates.push(...t));
      return { resourceTemplates: allTemplates };
    });
  }

  private parseName(fullName: string): { prefix: string, name: string } {
    for (const prefix of this.clients.keys()) {
      if (fullName.startsWith(`${prefix}__`)) {
        return {
          prefix: prefix,
          name: fullName.substring(prefix.length + 2)
        };
      }
    }
    throw new Error(`Invalid name format or unknown prefix: ${fullName}`);
  }

  async start() {
    console.log("AgentBrew Router starting...");
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

export async function startRouter() {
  const router = new Router();
  await router.start();
  return router;
}
