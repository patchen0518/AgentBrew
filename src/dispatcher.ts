import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Tool, Prompt, Resource, ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { ManagedClient } from "./router";
import fs from 'fs';
import path from 'path';
import { Logger } from './logger';

export interface LocalPrompt {
  pkgPath: string;
  file: string;
  name: string;
  description: string;
}

export interface LocalResource {
  pkgPath: string;
  file: string;
}

export interface LocalSkillTool {
  /** Absolute path to the directory containing SKILL.md */
  skillDir: string;
  skillName: string;
  description?: string;
}

export class CapabilityDispatch {
  private resourceToClient: Map<string, { prefix: string, originalUri: string }> = new Map();
  private localResources: Map<string, LocalResource> = new Map();
  private localSkillTools: Map<string, LocalSkillTool> = new Map();

  constructor(
    private managedClients: Map<string, ManagedClient>,
    private localPrompts: Map<string, LocalPrompt>
  ) {}

  scopeName(prefix: string, name: string): string {
    return `${prefix}__${name}`;
  }

  parseName(fullName: string): { prefix: string, name: string } {
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

  scopeUri(prefix: string, uri: string): string {
    const protocolIndex = uri.indexOf('://');
    if (protocolIndex !== -1) {
      const scheme = uri.substring(0, protocolIndex);
      const rest = uri.substring(protocolIndex + 3);
      return `mcp://${prefix}/${scheme}/${rest}`;
    }
    return `mcp://${prefix}/raw/${uri}`;
  }

  unscopeUri(uri: string): { prefix: string, originalUri: string } | null {
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
      
      originalUri += url.search;
      originalUri += url.hash;

      return { prefix, originalUri };
    } catch (e) {
      return null;
    }
  }

  async getClient(prefix: string): Promise<Client> {
    const managed = this.managedClients.get(prefix);
    if (!managed) {
      throw new Error(`No client found for prefix: ${prefix}`);
    }
    return await managed.getClient();
  }

  addSkillTool(fullName: string, skill: LocalSkillTool) {
    this.localSkillTools.set(fullName, skill);
  }

  /**
   * If fullName is a registered skill tool, reads and returns its SKILL.md content.
   * Returns null if the name is not a skill tool (caller should dispatch normally).
   */
  callSkillTool(fullName: string): { content: Array<{ type: string; text: string }> } | null {
    const skill = this.localSkillTools.get(fullName);
    if (!skill) return null;

    const skillMdPath = path.join(skill.skillDir, 'SKILL.md');
    try {
      const text = fs.readFileSync(skillMdPath, 'utf-8');
      return { content: [{ type: 'text', text }] };
    } catch (e: any) {
      return { content: [{ type: 'text', text: `Error reading skill: ${e.message}` }] };
    }
  }

  listAllTools(cachedTools: Map<string, Tool[]>): Tool[] {
    const allTools: Tool[] = [];

    // Skill tools are served locally — no child process needed
    for (const [name, skill] of this.localSkillTools.entries()) {
      allTools.push({
        name,
        description: skill.description
          ? `${skill.description} (AgentBrew skill — returns instructions)`
          : `AgentBrew skill: ${skill.skillName}. Returns the SKILL.md instructions.`,
        inputSchema: { type: 'object', properties: {} },
      });
    }

    for (const [prefix, tools] of cachedTools.entries()) {
      allTools.push(...tools.map(tool => ({
        ...tool,
        name: this.scopeName(prefix, tool.name)
      })));
    }
    return allTools;
  }

  listAllPrompts(cachedPrompts: Map<string, Prompt[]>): Prompt[] {
    const allPrompts: Prompt[] = [];

    // Add instruction index prompt if there are local resources
    if (this.localResources.size > 0) {
      allPrompts.push({
        name: 'agentbrew__instruction_index',
        description: 'Index of agent instruction files (CLAUDE.md, GEMINI.md, AGENTS.md, .cursorrules, .windsurfrules, .clinerules) for all installed packages.'
      });
    }

    // Add local prompts (skip skills already exposed as tools)
    for (const [fullName, local] of this.localPrompts.entries()) {
      if (this.localSkillTools.has(fullName)) continue;
      allPrompts.push({
        name: fullName,
        description: local.description
      });
    }

    for (const [prefix, prompts] of cachedPrompts.entries()) {
      allPrompts.push(...prompts.map(prompt => ({
        ...prompt,
        name: this.scopeName(prefix, prompt.name)
      })));
    }
    return allPrompts;
  }

  async getPrompt(fullName: string, args?: Record<string, any>): Promise<any> {
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
      const safeRoot = path.resolve(local.pkgPath);
      if (!fullPath.startsWith(safeRoot + path.sep) && fullPath !== safeRoot) {
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
      } catch (e: any) {
        throw new Error(`Failed to read prompt file: ${e.message}`);
      }
    }

    const { prefix, name } = this.parseName(fullName);
    const client = await this.getClient(prefix);
    return await client.getPrompt({
      name: name,
      arguments: args
    });
  }

  listAllResources(cachedResources: Map<string, Resource[]>): Resource[] {
    const allResources: Resource[] = [];

    // Add local instruction resources
    for (const [uri, local] of this.localResources.entries()) {
      allResources.push({
        uri,
        name: `${path.basename(local.pkgPath)} instructions (${local.file})`,
        description: `Instruction file for ${path.basename(local.pkgPath)}`
      });
    }

    for (const [prefix, resources] of cachedResources.entries()) {
      allResources.push(...resources.map(resource => {
        const scopedUri = this.scopeUri(prefix, resource.uri);
        this.resourceToClient.set(scopedUri, { prefix, originalUri: resource.uri });
        return {
          ...resource,
          uri: scopedUri,
          name: this.scopeName(prefix, resource.name)
        };
      }));
    }
    return allResources;
  }

  listAllResourceTemplates(cachedTemplates: Map<string, ResourceTemplate[]>): ResourceTemplate[] {
    const allTemplates: ResourceTemplate[] = [];
    for (const [prefix, templates] of cachedTemplates.entries()) {
      allTemplates.push(...templates.map(t => ({
        ...t,
        uriTemplate: this.scopeUri(prefix, t.uriTemplate)
      })));
    }
    return allTemplates;
  }

  async readResource(uri: string): Promise<any> {
    // Check local instruction resources
    const local = this.localResources.get(uri);
    if (local) {
      const fullPath = path.resolve(local.pkgPath, local.file);
      const safeRoot = path.resolve(local.pkgPath);
      if (!fullPath.startsWith(safeRoot + path.sep) && fullPath !== safeRoot) {
        throw new Error(`Invalid instruction file path: ${local.file}`);
      }
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        return {
          contents: [{
            uri,
            mimeType: 'text/markdown',
            text: content
          }]
        };
      } catch (e: any) {
        throw new Error(`Failed to read instruction file: ${e.message}`);
      }
    }

    // Check for direct mapping first (optimistic/performance)
    const mapping = this.resourceToClient.get(uri);
    if (mapping) {
      try {
        const client = await this.getClient(mapping.prefix);
        return await client.readResource({ uri: mapping.originalUri });
      } catch (e: any) {
        Logger.debug(`readResource direct mapping failed for ${uri}: ${e.message}`);
      }
    }

    // Fallback to unscoping for templated or unknown URIs
    const unscoped = this.unscopeUri(uri);
    if (unscoped) {
      try {
        const client = await this.getClient(unscoped.prefix);
        return await client.readResource({ uri: unscoped.originalUri });
      } catch (e: any) {
        Logger.debug(`readResource unscope fallback failed for ${uri}: ${e.message}`);
      }
    }

    throw new Error(`Resource not found: ${uri}`);
  }

  addResourceMapping(scopedUri: string, prefix: string, originalUri: string) {
    this.resourceToClient.set(scopedUri, { prefix, originalUri });
  }

  addLocalResource(uri: string, local: LocalResource) {
    this.localResources.set(uri, local);
  }
}
