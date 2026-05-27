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

export enum ClientStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RETRYING = 'RETRYING',
  FAILED = 'FAILED'
}

export class ManagedClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private status: ClientStatus = ClientStatus.DISCONNECTED;
  private retryCount: number = 0;
  private lastError: string | null = null;
  private maxRetries: number = 3;
  private connectingPromise: Promise<Client> | null = null;

  constructor(
    public prefix: string,
    private pkgPath: string,
    private serverConfig: { command: string; args: string[]; env?: Record<string, string>; cwd?: string }
  ) {}

  private async spawnClient(wasRetrying: boolean): Promise<Client> {
    Logger.info(`Starting MCP server for ${this.prefix}...`);
    this.transport = new StdioClientTransport({
      command: this.serverConfig.command,
      args: this.serverConfig.args,
      env: this.serverConfig.env,
      stderr: 'inherit',
      cwd: this.serverConfig.cwd || this.pkgPath,
    });

    this.client = new Client(
      { name: "agentbrew-client", version: "1.0.0" },
      { capabilities: {} }
    );

    await this.client.connect(this.transport);
    
    this.status = ClientStatus.CONNECTED;
    if (!wasRetrying) {
      this.retryCount = 0;
    }

    // Add exit handler:
    this.transport.onclose = () => {
      if (this.status !== ClientStatus.DISCONNECTED) {
          this.handleCrash();
      }
    };

    return this.client;
  }

  async getClient(): Promise<Client> {
    if (this.status === ClientStatus.FAILED) {
      throw new Error(`[AgentBrew] Server '${this.prefix}' failed after ${this.maxRetries} attempts. Last error: ${this.lastError}`);
    }
    if (this.client && this.status === ClientStatus.CONNECTED) return this.client;
    if (this.connectingPromise) return this.connectingPromise;

    this.status = ClientStatus.CONNECTING;

    this.connectingPromise = (async () => {
      try {
        return await this.spawnClient(false);
      } catch (e: any) {
        this.lastError = e.message;
        throw e;
      } finally {
        this.connectingPromise = null;
      }
    })();

    return this.connectingPromise;
  }

  private async handleCrash() {
    if (this.status === ClientStatus.FAILED || this.status === ClientStatus.DISCONNECTED) return;
    this.status = ClientStatus.RETRYING;

    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      const delay = Math.pow(2, this.retryCount) * 1000;
      Logger.info(`Server ${this.prefix} crashed. Retrying ${this.retryCount}/${this.maxRetries} in ${delay/1000}s...`);

      // Set connectingPromise to represent the wait delay + reconnect sequence
      this.connectingPromise = (async () => {
        await new Promise(resolve => setTimeout(resolve, delay));
        try {
          this.client = null;
          this.transport = null;
          return await this.spawnClient(true);
        } catch (e: any) {
          this.lastError = e.message;
          throw e;
        } finally {
          this.connectingPromise = null;
        }
      })();

      try {
        await this.connectingPromise;
      } catch (e) {
        // If the reconnect failed, trigger the next retry if still applicable
        const currentStatus = this.status as ClientStatus;
        if (currentStatus !== ClientStatus.DISCONNECTED && currentStatus !== ClientStatus.FAILED) {
          this.handleCrash();
        }
      }
    } else {
      this.status = ClientStatus.FAILED;
      Logger.error(`Server ${this.prefix} failed permanently after ${this.maxRetries} attempts.`);
    }
  }

  async stop() {
    this.status = ClientStatus.DISCONNECTED;
    if (this.client) {
      Logger.info(`Stopping MCP server for ${this.prefix}...`);
      await this.client.close();
      this.client = null;
      this.transport = null;
    }
  }

  isConnected(): boolean {
    return this.status === ClientStatus.CONNECTED;
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

      // Check for direct mapping first (optimistic/performance)
      const mapping = this.resourceToClient.get(uri);
      if (mapping) {
        const managed = this.managedClients.get(mapping.prefix);
        if (managed) {
          const client = await managed.getClient();
          return await client.readResource({ uri: mapping.originalUri });
        }
      }

      // Fallback to unscoping for templated or unknown URIs
      const unscoped = this.unscopeUri(uri);
      if (unscoped) {
        const managed = this.managedClients.get(unscoped.prefix);
        if (managed) {
          const client = await managed.getClient();
          return await client.readResource({ uri: unscoped.originalUri });
        }
      }

      throw new Error(`Resource not found: ${uri}`);
    });

    this.mcpServer.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      const allTemplates: ResourceTemplate[] = [];
      for (const [prefix, managed] of this.managedClients.entries()) {
        try {
          const client = await managed.getClient();
          const result = await client.listResourceTemplates();
          allTemplates.push(...result.resourceTemplates.map(t => ({
            ...t,
            uriTemplate: this.scopeUri(prefix, t.uriTemplate)
          })));
        } catch (e) {
          Logger.error(`Failed to list resource templates for ${prefix}: ${e}`);
        }
      }
      return { resourceTemplates: allTemplates };
    });
  }

  private scopeUri(prefix: string, uri: string): string {
    const protocolIndex = uri.indexOf('://');
    if (protocolIndex !== -1) {
      const scheme = uri.substring(0, protocolIndex);
      const rest = uri.substring(protocolIndex + 3);
      return `mcp://${prefix}/${scheme}/${rest}`;
    }
    return `mcp://${prefix}/raw/${uri}`;
  }

  private unscopeUri(uri: string): { prefix: string, originalUri: string } | null {
    try {
      const url = new URL(uri);
      if (url.protocol !== 'mcp:') return null;

      const prefix = url.host;
      const pathname = url.pathname; // e.g., /https/example.com/path
      const parts = pathname.split('/');
      if (parts.length < 2) return null;

      const scheme = parts[1];
      const rest = parts.slice(2).join('/');
      
      let originalUri: string;
      if (scheme === 'raw') {
        originalUri = rest;
      } else {
        originalUri = `${scheme}://${rest}`;
      }
      
      // Re-add search and hash if they exist
      originalUri += url.search;
      originalUri += url.hash;

      return { prefix, originalUri };
    } catch (e) {
      return null;
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
        if (!isPackageEnabled(pkg.packageName, prompt.name)) continue;
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
