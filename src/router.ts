import fs from 'fs';
import path from 'path';
import { discoverPackages, PackageInfo, McpManifestCache } from './registry';
import { CapabilityDispatch, LocalPrompt, LocalResource } from './dispatcher';
import { isPackageEnabled, getSkillsAsMcpTools } from './state';
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
import { buildSubprocessEnv } from './installer';

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
      env: Object.fromEntries(
        Object.entries({ ...buildSubprocessEnv(), ...this.serverConfig.env })
          .filter((e): e is [string, string] => e[1] !== undefined)
      ),
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

export class Router {
  private managedClients: Map<string, ManagedClient> = new Map();
  private localPrompts: Map<string, LocalPrompt> = new Map();
  private mcpServer: Server;
  private dispatcher: CapabilityDispatch;

  private cachedTools: Map<string, Tool[]> = new Map();
  private cachedPrompts: Map<string, Prompt[]> = new Map();
  private cachedResources: Map<string, Resource[]> = new Map();
  private cachedResourceTemplates: Map<string, ResourceTemplate[]> = new Map();

  constructor() {
    this.dispatcher = new CapabilityDispatch(this.managedClients, this.localPrompts);
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
      return { tools: this.dispatcher.listAllTools(this.cachedTools) };
    });

    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const fullName = request.params.name;

      // Skill tools are served locally — check before dispatching to child clients
      const skillResult = this.dispatcher.callSkillTool(fullName);
      if (skillResult !== null) return skillResult;

      const { prefix, name } = this.dispatcher.parseName(fullName);
      const client = await this.dispatcher.getClient(prefix);
      return await client.callTool({
          name: name,
          arguments: request.params.arguments
      });
    });

    this.mcpServer.setRequestHandler(ListPromptsRequestSchema, async () => {
      return { prompts: this.dispatcher.listAllPrompts(this.cachedPrompts) };
    });

    this.mcpServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
      return await this.dispatcher.getPrompt(request.params.name, request.params.arguments);
    });

    this.mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => {
      return { resources: this.dispatcher.listAllResources(this.cachedResources) };
    });

    this.mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      return await this.dispatcher.readResource(request.params.uri);
    });

    this.mcpServer.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      return { resourceTemplates: this.dispatcher.listAllResourceTemplates(this.cachedResourceTemplates) };
    });
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
    const pkgId = pkg.subPath ? `${pkg.packageName}/${pkg.subPath}` : pkg.packageName;
    const cache = pkg.manifest as McpManifestCache;

    if (pkg.manifest.servers) {
      for (const server of pkg.manifest.servers) {
        if (!isPackageEnabled(pkg.packageName, server.name)) continue;
        
        const sanitizedPkgId = pkgId.replace(/\//g, '_').replace(/\\/g, '_');
        const prefix = `${sanitizedPkgId}_${server.name}`;
        const managed = new ManagedClient(prefix, pkg.path, server);
        this.managedClients.set(prefix, managed);

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
                
                for (const resource of resources) {
                    const scopedUri = this.dispatcher.scopeUri(prefix, resource.uri);
                    this.dispatcher.addResourceMapping(scopedUri, prefix, resource.uri);
                }
            }
            if (cache.discovered.resourceTemplates?.[server.name]) {
                this.cachedResourceTemplates.set(prefix, cache.discovered.resourceTemplates[server.name]);
            }
        }
      }
    }

    if (pkg.manifest.instructions) {
      for (const instruction of pkg.manifest.instructions) {
        const pkgId = pkg.subPath ? `${pkg.packageName}/${pkg.subPath}` : pkg.packageName;
        const uri = `mcp://agentbrew/instructions/${pkgId}/${instruction.file}`;
        this.dispatcher.addLocalResource(uri, {
          pkgPath: pkg.path,
          file: instruction.file
        });
      }
    }

    if (pkg.manifest.prompts) {
      // Read once per package; SKILL.md prompts are exposed as MCP tools unless the user opts out
      // via skillsAsMcpTools=false in ~/.agentbrew/state.json (e.g. Claude Code users who run sync
      // already get skills as native slash commands and don't need the MCP tool duplicate).
      const exposedAsTools = getSkillsAsMcpTools();
      for (const prompt of pkg.manifest.prompts) {
        if (!isPackageEnabled(pkg.packageName, prompt.name)) continue;
        const fullName = this.dispatcher.scopeName(pkgId, prompt.name);
        this.localPrompts.set(fullName, {
          pkgPath: pkg.path,
          file: prompt.file,
          name: prompt.name,
          description: prompt.description
        });

        if (path.basename(prompt.file).toUpperCase() === 'SKILL.MD' && exposedAsTools) {
          this.dispatcher.addSkillTool(fullName, {
            skillDir: path.dirname(path.resolve(pkg.path, prompt.file)),
            skillName: prompt.name,
            description: prompt.description,
          });
        }
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
