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
  Tool,
  Prompt,
  Resource,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/types.js";
import { Logger } from './logger';

class ManagedClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  constructor(
    public prefix: string,
    private pkgPath: string,
    private serverConfig: { command: string; args: string[] }
  ) {}

  async getClient(): Promise<Client> {
    if (this.client) return this.client;

    Logger.info(`Starting MCP server for ${this.prefix}...`);
    this.transport = new StdioClientTransport({
      command: this.serverConfig.command,
      args: this.serverConfig.args,
      stderr: 'inherit',
      cwd: this.pkgPath,
    });

    this.client = new Client(
      { name: "agentbrew-client", version: "1.0.0" },
      { capabilities: {} }
    );

    await this.client.connect(this.transport);
    return this.client;
  }

  async stop() {
    if (this.client) {
      Logger.info(`Stopping MCP server for ${this.prefix}...`);
      await this.client.close();
      this.client = null;
      this.transport = null;
    }
  }

  isConnected(): boolean {
    return this.client !== null;
  }
}

export class Router {
  private managedClients: Map<string, ManagedClient> = new Map();
  private resourceToClient: Map<string, string> = new Map();
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
      const allTools: Tool[] = [];
      const promises = Array.from(this.managedClients.values()).map(async (managed) => {
        try {
          const client = await managed.getClient();
          const response = await client.listTools();
          return response.tools.map(tool => ({
            ...tool,
            name: `${managed.prefix}__${tool.name}`
          }));
        } catch (e) {
          Logger.error(`Failed to list tools for ${managed.prefix}:`, e);
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
      
      const managed = this.managedClients.get(prefix);
      if (!managed) throw new Error(`No client found for prefix: ${prefix}`);
      
      const client = await managed.getClient();
      return await client.callTool({
          name: name,
          arguments: request.params.arguments
      });
    });

    // Prompts
    this.mcpServer.setRequestHandler(ListPromptsRequestSchema, async () => {
      const allPrompts: Prompt[] = [];
      const promises = Array.from(this.managedClients.values()).map(async (managed) => {
        try {
          const client = await managed.getClient();
          const response = await client.listPrompts();
          return response.prompts.map(prompt => ({
            ...prompt,
            name: `${managed.prefix}__${prompt.name}`
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
      const managed = this.managedClients.get(prefix);
      if (!managed) throw new Error(`No client found for prefix: ${prefix}`);
      const client = await managed.getClient();
      return await client.getPrompt({
        name: name,
        arguments: request.params.arguments
      });
    });

    // Resources
    this.mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => {
      const allResources: Resource[] = [];
      const promises = Array.from(this.managedClients.values()).map(async (managed) => {
        try {
          const client = await managed.getClient();
          const response = await client.listResources();
          return response.resources.map(resource => {
            // Resource routing: track which client owns this URI
            this.resourceToClient.set(resource.uri, managed.prefix);
            return {
              ...resource,
              name: `${managed.prefix}__${resource.name}`
            };
          });
        } catch (e) {
          return [];
        }
      });
      const results = await Promise.all(promises);
      results.forEach(r => allResources.push(...r));
      return { resources: allResources };
    });

    this.mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      const prefix = this.resourceToClient.get(uri);
      
      if (prefix) {
        const managed = this.managedClients.get(prefix);
        if (managed) {
          const client = await managed.getClient();
          return await client.readResource({ uri });
        }
      }

      // Fallback to broadcast if URI wasn't discovered or prefix is missing
      Logger.warn(`URI ${uri} not found in cache, falling back to broadcast`);
      for (const managed of this.managedClients.values()) {
        try {
          const client = await managed.getClient();
          return await client.readResource({ uri });
        } catch (e) {
          // Continue to next client
        }
      }
      throw new Error(`Resource not found: ${uri}`);
    });

    this.mcpServer.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      const allTemplates: ResourceTemplate[] = [];
      const promises = Array.from(this.managedClients.values()).map(async (managed) => {
        try {
          const client = await managed.getClient();
          const response = await client.listResourceTemplates();
          return response.resourceTemplates.map(template => ({
            ...template,
            name: `${managed.prefix}__${template.name}`
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
    for (const prefix of this.managedClients.keys()) {
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
    Logger.info("AgentBrew Router starting...");
    const packages = discoverPackages();
    Logger.info(`Discovered ${packages.length} packages.`);

    for (const pkg of packages) {
      this.registerPackage(pkg);
    }

    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
    Logger.info("AgentBrew MCP Router connected via Stdio");

    return true;
  }

  private registerPackage(pkg: PackageInfo) {
    if (pkg.manifest.servers) {
      for (const server of pkg.manifest.servers) {
        const prefix = `${pkg.manifest.name}_${server.name}`;
        const managed = new ManagedClient(prefix, pkg.path, server);
        this.managedClients.set(prefix, managed);
      }
    }
  }

  async stop() {
    for (const managed of this.managedClients.values()) {
      await managed.stop();
    }
    this.managedClients.clear();
    await this.mcpServer.close();
  }
}

export async function startRouter() {
  const router = new Router();
  await router.start();
  return router;
}
