import fs from 'fs';
import path from 'path';
import { discoverPackages, PackageInfo, McpManifestCache } from './registry';
import { isPackageEnabled } from './state';
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

export class ManagedClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  constructor(
    public prefix: string,
    private pkgPath: string,
    private serverConfig: { command: string; args: string[]; env?: Record<string, string> }
  ) {}

  async getClient(): Promise<Client> {
    if (this.client) return this.client;

    Logger.info(`Starting MCP server for ${this.prefix}...`);
    this.transport = new StdioClientTransport({
      command: this.serverConfig.command,
      args: this.serverConfig.args,
      env: this.serverConfig.env,
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

interface LocalPrompt {
  pkgPath: string;
  file: string;
  name: string;
  description: string;
}

interface LocalResource {
  pkgPath: string;
  file: string;
}

export class Router {
  private managedClients: Map<string, ManagedClient> = new Map();
  private localPrompts: Map<string, LocalPrompt> = new Map();
  private localResources: Map<string, LocalResource> = new Map();
  private resourceToClient: Map<string, { prefix: string, originalUri: string }> = new Map();
  private mcpServer: Server;

  private cachedTools: Map<string, Tool[]> = new Map();
  private cachedPrompts: Map<string, Prompt[]> = new Map();
  private cachedResources: Map<string, Resource[]> = new Map();

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
      
      for (const [prefix, tools] of this.cachedTools.entries()) {
          allTools.push(...tools.map(tool => ({
              ...tool,
              name: `${prefix}__${tool.name}`
          })));
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

      // Add instruction index prompt
      if (this.localResources.size > 0) {
        allPrompts.push({
          name: 'agentbrew__instruction_index',
          description: 'Index of instruction files (GEMINI.md, CLAUDE.md) for all installed tools.'
        });
      }

      // Add local prompts
      for (const [prefix, local] of this.localPrompts.entries()) {
        allPrompts.push({
          name: prefix,
          description: local.description
        });
      }

      for (const [prefix, prompts] of this.cachedPrompts.entries()) {
        allPrompts.push(...prompts.map(prompt => ({
            ...prompt,
            name: `${prefix}__${prompt.name}`
        })));
      }
      return { prompts: allPrompts };
    });

    this.mcpServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const fullName = request.params.name;

      if (fullName === 'agentbrew__instruction_index') {
        let content = "The following instruction files are available as resources in AgentBrew:\n\n";
        for (const [uri, resource] of this.localResources.entries()) {
          content += `- ${resource.file} for ${path.basename(resource.pkgPath)}: ${uri}\n`;
        }
        content += "\nYou can read these resources to get specific instructions for each tool.";
        
        return {
          description: "Index of instruction files",
          messages: [{
            role: 'user',
            content: {
              type: 'text',
              text: content
            }
          }]
        };
      }

      // Check local prompts first
      const local = this.localPrompts.get(fullName);
      if (local) {
        const fullPath = path.resolve(local.pkgPath, local.file);
        if (!fullPath.startsWith(path.resolve(local.pkgPath))) {
          throw new Error(`Invalid prompt file path: ${local.file}`);
        }
        
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          return {
            description: local.description,
            messages: [{
              role: 'user',
              content: {
                type: 'text',
                text: content
              }
            }]
          };
        } catch (e) {
          throw new Error(`Failed to read prompt file: ${local.file}`);
        }
      }

      const { prefix, name } = this.parseName(fullName);
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

      // Add local instruction resources
      for (const [uri, local] of this.localResources.entries()) {
        allResources.push({
          uri,
          name: `${path.basename(local.pkgPath)} instructions (${local.file})`,
          description: `Instruction file for ${path.basename(local.pkgPath)}`
        });
      }

      for (const [prefix, resources] of this.cachedResources.entries()) {
          allResources.push(...resources.map(resource => {
              const scopedUri = this.scopeUri(prefix, resource.uri);
              this.resourceToClient.set(scopedUri, { prefix, originalUri: resource.uri });
              return {
                  ...resource,
                  uri: scopedUri,
                  name: `${prefix}__${resource.name}`
              };
          }));
      }
      return { resources: allResources };
    });

    this.mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;

      // Check local instruction resources
      const local = this.localResources.get(uri);
      if (local) {
        const fullPath = path.resolve(local.pkgPath, local.file);
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          return {
            contents: [{
              uri,
              mimeType: 'text/markdown',
              text: content
            }]
          };
        } catch (e) {
          throw new Error(`Failed to read instruction file: ${local.file}`);
        }
      }

      const mapping = this.resourceToClient.get(uri);
      
      if (mapping) {
        const managed = this.managedClients.get(mapping.prefix);
        if (managed) {
          const client = await managed.getClient();
          return await client.readResource({ uri: mapping.originalUri });
        }
      }

      throw new Error(`Resource not found: ${uri}`);
    });

    this.mcpServer.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      const allTemplates: ResourceTemplate[] = [];
      // (Lazy loading for templates can be added if needed, currently focusing on core tools/prompts)
      return { resourceTemplates: allTemplates };
    });
  }

  private scopeUri(prefix: string, uri: string): string {
    // If it's a standard MCP URI, inject prefix into authority or path
    // Simple approach: agentbrew://prefix/original_scheme/rest_of_uri
    try {
        const url = new URL(uri);
        return `mcp://${prefix}/${url.protocol.replace(':', '')}/${url.host}${url.pathname}${url.search}`;
    } catch (e) {
        // Fallback for non-standard URIs
        return `mcp://${prefix}/raw/${uri}`;
    }
  }

  private parseName(fullName: string): { prefix: string, name: string } {
    const delimiter = '__';
    const lastIndex = fullName.lastIndexOf(delimiter);
    if (lastIndex === -1) {
        throw new Error(`Invalid name format: ${fullName}. Expected 'prefix${delimiter}name'`);
    }

    const prefix = fullName.substring(0, lastIndex);
    const name = fullName.substring(lastIndex + delimiter.length);

    if (!this.managedClients.has(prefix) && !this.localPrompts.has(fullName)) {
        throw new Error(`Unknown prefix: ${prefix} for name: ${fullName}`);
    }

    return { prefix, name };
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
    // Unique ID for the package + sub-project
    // e.g. "my-repo" or "my-repo/sub-dir"
    const pkgId = pkg.subPath ? `${pkg.packageName}/${pkg.subPath}` : pkg.packageName;
    const cache = pkg.manifest as McpManifestCache;

    // Register executable servers
    if (pkg.manifest.servers) {
      for (const server of pkg.manifest.servers) {
        // Use the logical ID for checking enablement
        if (!isPackageEnabled(pkg.packageName, server.name)) continue;
        
        // Use prefix: pkgId_serverName
        // Replace slashes with underscores for valid MCP names if needed, 
        // but let's keep it consistent with the logic we have.
        const sanitizedPkgId = pkgId.replace(/\//g, '_').replace(/\\/g, '_');
        const prefix = `${sanitizedPkgId}_${server.name}`;
        const managed = new ManagedClient(prefix, pkg.path, server);
        this.managedClients.set(prefix, managed);

        // Load from cache
        if (cache.discovered) {
            if (cache.discovered.tools?.[server.name]) {
                this.cachedTools.set(prefix, cache.discovered.tools[server.name]);
            }
            if (cache.discovered.prompts?.[server.name]) {
                this.cachedPrompts.set(prefix, cache.discovered.prompts[server.name]);
            }
            if (cache.discovered.resources?.[server.name]) {
                const resources = cache.discovered.resources[server.name];
                this.cachedResources.set(prefix, resources);
                
                // ISSUE 1 FIX: Populate resource mapping from cache on startup
                for (const resource of resources) {
                    const scopedUri = this.scopeUri(prefix, resource.uri);
                    this.resourceToClient.set(scopedUri, { prefix, originalUri: resource.uri });
                }
            }
        }
      }
    }

    // Register local instruction resources
    if (pkg.manifest.instructions) {
      for (const instruction of pkg.manifest.instructions) {
        const pkgId = pkg.subPath ? `${pkg.packageName}/${pkg.subPath}` : pkg.packageName;
        const uri = `mcp://agentbrew/instructions/${pkgId}/${instruction.file}`;
        this.localResources.set(uri, {
          pkgPath: pkg.path,
          file: instruction.file
        });
      }
    }

    // Register local markdown prompts
    if (pkg.manifest.prompts) {
      for (const prompt of pkg.manifest.prompts) {
        if (!isPackageEnabled(pkgId, prompt.name)) continue;
        const prefix = `${pkgId}__${prompt.name}`;
        this.localPrompts.set(prefix, {
          pkgPath: pkg.path,
          file: prompt.file,
          name: prompt.name,
          description: prompt.description
        });
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
