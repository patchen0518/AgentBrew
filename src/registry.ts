import fs from 'fs';
import path from 'path';
import * as toml from 'smol-toml';
import { isPackageEnabled } from './state';
import { Logger } from './logger';
import { getPackagesDir } from './config';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildSubprocessEnv } from './installer';

export interface PackageManifest {
  name: string;
  version: string;
  description?: string;
  servers?: {
    name: string;
    command: string;
    args: string[];
    description?: string;
    build_command?: string;
    env?: Record<string, string>;
    cwd?: string;
  }[];
  prompts?: {
    name: string;
    file: string;
    description: string;
  }[];
  instructions?: {
    name: string;
    file: string;
  }[];
}

/**
 * Static cache of capabilities discovered from an MCP server.
 * Saved as mcp-manifest.json in the package directory.
 */
export interface McpManifestCache extends PackageManifest {
  discovered?: {
    tools?: Record<string, any[]>;     // serverName -> Tool[]
    prompts?: Record<string, any[]>;   // serverName -> Prompt[]
    resources?: Record<string, any[]>; // serverName -> Resource[]
    resourceTemplates?: Record<string, any[]>; // serverName -> ResourceTemplate[]
  }
}

export interface PackageInfo {
  packageName: string;
  subPath: string; // Relative path from packagesDir/packageName
  path: string;    // Absolute path
  manifest: PackageManifest;
  isEnabled: boolean;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

/**
 * Discovers capabilities by briefly running the server and saves them to mcp-manifest.json.
 */
export async function generateMcpManifest(pkgPath: string, manifest: PackageManifest): Promise<McpManifestCache> {
    const cache: McpManifestCache = { ...manifest, discovered: { tools: {}, prompts: {}, resources: {}, resourceTemplates: {} } };
    
    // Add auto-detected prompts to discovered
    if (manifest.prompts) {
        cache.discovered!.prompts!["local"] = manifest.prompts.map(p => ({
            name: p.name,
            description: p.description
        }));
    }

    // Add instructions to discovered resources
    if (manifest.instructions) {
        cache.discovered!.resources!["local"] = manifest.instructions.map(i => ({
            name: i.name,
            uri: `file://${path.join(pkgPath, i.file)}`,
            description: `Instruction file: ${i.file}`
        }));
    }

    if (manifest.servers) {
        for (const server of manifest.servers) {
            Logger.info(`Discovering capabilities for server: ${server.name}...`);
            const transport = new StdioClientTransport({
                command: server.command,
                args: server.args,
                env: Object.fromEntries(
                    Object.entries({ ...buildSubprocessEnv(), ...server.env })
                        .filter((e): e is [string, string] => e[1] !== undefined)
                ),
                cwd: pkgPath,
                stderr: 'inherit'
            });

            const client = new Client(
                { name: "agentbrew-discovery", version: "1.0.0" },
                { capabilities: {} }
            );

            try {
                await withTimeout(client.connect(transport), 10000, "Connection timeout of 10s exceeded");
                
                let toolsList: any[] = [];
                let promptsList: any[] = [];
                let resourcesList: any[] = [];
                let resourceTemplatesList: any[] = [];

                try {
                    const result = await client.listTools();
                    toolsList = result.tools || [];
                } catch (e: any) {
                    Logger.info(`Server ${server.name} does not support tools discovery: ${e.message}`);
                }

                try {
                    const result = await client.listPrompts();
                    promptsList = result.prompts || [];
                } catch (e: any) {
                    Logger.info(`Server ${server.name} does not support prompts discovery: ${e.message}`);
                }

                try {
                    const result = await client.listResources();
                    resourcesList = result.resources || [];
                } catch (e: any) {
                    Logger.info(`Server ${server.name} does not support resources discovery: ${e.message}`);
                }

                try {
                    const result = await client.listResourceTemplates();
                    resourceTemplatesList = result.resourceTemplates || [];
                } catch (e: any) {
                    Logger.info(`Server ${server.name} does not support resource templates discovery: ${e.message}`);
                }

                if (cache.discovered) {
                    cache.discovered.tools![server.name] = toolsList;
                    cache.discovered.prompts![server.name] = promptsList;
                    cache.discovered.resources![server.name] = resourcesList;
                    cache.discovered.resourceTemplates = cache.discovered.resourceTemplates || {};
                    cache.discovered.resourceTemplates[server.name] = resourceTemplatesList;
                }

                await client.close();
            } catch (e: any) {
                Logger.error(`Failed to connect or discover capabilities for ${server.name}: ${e.message}`);
                try {
                    await transport.close();
                } catch (closeErr) {}
            }
        }
    }

    const cachePath = path.join(pkgPath, 'mcp-manifest.json');
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
    return cache;
}

/**
 * Logs a warning for any declared servers whose tools were absent from the discovery cache,
 * indicating they likely failed to start (e.g. missing API keys).
 */
export function warnIfDiscoveryFailed(manifest: PackageManifest, cache: McpManifestCache): void {
  if (!manifest.servers) return;
  const failedServers = manifest.servers.filter(s =>
    cache.discovered?.tools?.[s.name] === undefined
  );
  if (failedServers.length > 0) {
    Logger.warn(
      `Server(s) could not be discovered (may require API keys): ${failedServers.map(s => `'${s.name}'`).join(', ')}\n` +
      `  Set the required environment variables, then run: agentbrew refresh`
    );
  }
}

export function discoverPackages(includeDisabled = false): PackageInfo[] {
  const packagesDir = getPackagesDir();
  if (!fs.existsSync(packagesDir)) return [];

  const packages: PackageInfo[] = [];
  const rootDirs = fs.readdirSync(packagesDir);
  

  for (const rootDir of rootDirs) {
    const rootPath = path.join(packagesDir, rootDir);
    try {
        if (!fs.statSync(rootPath).isDirectory()) continue;
    } catch (e) {
        Logger.error(`statSync failed for ${rootPath}:`, e);
        continue;
    }

    // Recursive search up to 2 levels
    const manifests = findManifests(rootPath, 2);
    for (const manifestInfo of manifests) {
        const subPath = path.relative(rootPath, manifestInfo.path);
        const isEnabled = isPackageEnabled(rootDir, manifestInfo.manifest.name);
        if (isEnabled || includeDisabled) {
            packages.push({
                packageName: rootDir,
                subPath: subPath,
                path: manifestInfo.path,
                manifest: manifestInfo.manifest,
                isEnabled
            });
        }
    }
  }

  return packages;
}

export function findManifests(currentPath: string, depth: number): { path: string, manifest: PackageManifest }[] {
    const results: { path: string, manifest: PackageManifest }[] = [];
    
    let manifest: PackageManifest | null = null;
    let foundCache = false;

    // Check for cached manifest first
    const cachePath = path.join(currentPath, 'mcp-manifest.json');
    if (fs.existsSync(cachePath)) {
        try {
            manifest = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as McpManifestCache;
            foundCache = true;
            // Refresh SKILL.md descriptions from disk — cached values may be stale (e.g. "---")
            if (manifest.prompts) {
                for (const prompt of manifest.prompts) {
                    if (path.basename(prompt.file).toUpperCase() !== 'SKILL.MD') continue;
                    try {
                        const skillPath = path.resolve(currentPath, prompt.file);
                        const lines = fs.readFileSync(skillPath, 'utf-8').split('\n');
                        if (lines[0]?.trim() === '---') {
                            const fmEnd = lines.indexOf('---', 1);
                            if (fmEnd > 0) {
                                const fmLines = lines.slice(1, fmEnd);
                                const descIdx = fmLines.findIndex((l: string) => /^description\s*:/.test(l));
                                if (descIdx >= 0) {
                                    const inline = fmLines[descIdx].replace(/^description\s*:\s*/, '').trim();
                                    if (inline === '>-' || inline === '>' || inline === '|' || inline === '|-') {
                                        const blockLines: string[] = [];
                                        for (let i = descIdx + 1; i < fmLines.length; i++) {
                                            if (/^\s/.test(fmLines[i])) blockLines.push(fmLines[i].trim());
                                            else break;
                                        }
                                        prompt.description = blockLines.join(' ');
                                    } else {
                                        prompt.description = inline.replace(/^"|"$/g, '').trim();
                                    }
                                }
                            }
                        }
                    } catch {}
                }
            }
        } catch (e) {
            Logger.error(`Failed to parse cache ${cachePath}:`, e);
        }
    }

    if (!manifest) {
        const manifestPath = path.join(currentPath, 'agentbrew.toml');
        if (fs.existsSync(manifestPath)) {
            try {
                const content = fs.readFileSync(manifestPath, 'utf-8');
                manifest = toml.parse(content) as any;
            } catch (e) {
                Logger.error(`Failed to parse ${manifestPath}:`, e);
            }
        }
    }

    const autoManifest = autoDetectManifest(currentPath);

    if (manifest) {
        // Merge auto-detected into explicit manifest or cache
        // Explicit/Cache takes precedence for same-named items
        if (autoManifest.servers) {
            manifest.servers = manifest.servers || [];
            for (const autoSrv of autoManifest.servers) {
                if (!manifest.servers.find(s => s.name === autoSrv.name)) {
                    manifest.servers.push(autoSrv);
                }
            }
        }
        if (autoManifest.prompts) {
            manifest.prompts = manifest.prompts || [];
            for (const autoPrompt of autoManifest.prompts) {
                if (!manifest.prompts.find(p => p.name === autoPrompt.name)) {
                    manifest.prompts.push(autoPrompt);
                }
            }
        }
        if (autoManifest.instructions) {
            manifest.instructions = manifest.instructions || [];
            for (const autoInstr of autoManifest.instructions) {
                if (!manifest.instructions.find(i => i.name === autoInstr.name)) {
                    manifest.instructions.push(autoInstr);
                }
            }
        }
        results.push({ path: currentPath, manifest });
    } else {
        // Only include auto-detected if it found something useful
        if (fs.existsSync(path.join(currentPath, 'package.json')) || 
            fs.existsSync(path.join(currentPath, 'requirements.txt')) || 
            fs.existsSync(path.join(currentPath, 'pyproject.toml')) ||
            fs.existsSync(path.join(currentPath, 'poetry.lock')) ||
            fs.existsSync(path.join(currentPath, 'uv.lock')) ||
            (autoManifest.prompts && autoManifest.prompts.length > 0) ||
            (autoManifest.instructions && autoManifest.instructions.length > 0)) {
            results.push({ path: currentPath, manifest: autoManifest });
        }
    }

    // Continue recursion even if we found a manifest at this level, 
    // to find skills in subdirectories.
    if (depth > 0) {
        try {
            const files = fs.readdirSync(currentPath);
            const subdirs = files.filter(f => {
                const fullPath = path.join(currentPath, f);
                try {
                    return fs.statSync(fullPath).isDirectory() && f !== 'node_modules' && !f.startsWith('.');
                } catch (e) {
                    return false;
                }
            });
            for (const subdir of subdirs) {
                results.push(...findManifests(path.join(currentPath, subdir), depth - 1));
            }
        } catch (e) {
            // Likely not a directory or permission error
        }
    }
    
    return results;
}

function autoDetectManifest(pkgPath: string): PackageManifest {
  const pkgName = path.basename(pkgPath);
  const manifest: PackageManifest = {
    name: pkgName,
    version: '0.0.0-auto',
  };

  const packageJsonPath = path.join(pkgPath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
        const pkgJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        manifest.name = pkgJson.name || pkgName;
        manifest.version = pkgJson.version || '0.0.0-auto';
        manifest.description = pkgJson.description || "";
        
        const hasMcpSdk = pkgJson.dependencies?.['@modelcontextprotocol/sdk'] ||
                         pkgJson.devDependencies?.['@modelcontextprotocol/sdk'];

        // Monorepo workspace roots are not servers — the actual server lives in a
        // sub-package found via findManifests recursion. Skip server auto-detection
        // but still detect instructions and skills below.
        const isWorkspaceRoot = Boolean(pkgJson.workspaces);

        // Improved auto-detection for bin entries
        if (!isWorkspaceRoot && pkgJson.bin) {
            const binName = typeof pkgJson.bin === 'string' ? manifest.name : Object.keys(pkgJson.bin)[0];
            const binPath = typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin[binName];
            manifest.servers = [{
                name: binName,
                command: 'node',
                args: [binPath],
                description: `Node.js server from ${binName}`
            }];
        } else if (!isWorkspaceRoot && hasMcpSdk) {
            // If it has MCP SDK but no bin, try common patterns
            const commonNodeEntryPoints = ['dist/index.js', 'dist/server.js', 'index.js', 'server.js'];
            const entryPoint = commonNodeEntryPoints.find(f => fs.existsSync(path.join(pkgPath, f)));
            
            if (entryPoint) {
                manifest.servers = [{
                    name: manifest.name,
                    command: 'node',
                    args: [entryPoint],
                    description: `Detected Node.js MCP server`
                }];
            } else if (pkgJson.scripts?.start) {
                manifest.servers = [{
                    name: manifest.name,
                    command: 'npm',
                    args: ['start'],
                    description: `npm start server for ${manifest.name}`
                }];
            }
        }
    } catch (e) {
        Logger.error(`Failed to parse ${packageJsonPath}:`, e);
    }
  }

  // Detect Python projects
  const requirementsPath = path.join(pkgPath, 'requirements.txt');
  const pyprojectPath = path.join(pkgPath, 'pyproject.toml');
  const poetryLockPath = path.join(pkgPath, 'poetry.lock');
  
  if (fs.existsSync(requirementsPath) || fs.existsSync(pyprojectPath)) {
    let isMcp = false;
    if (fs.existsSync(requirementsPath)) {
        const reqs = fs.readFileSync(requirementsPath, 'utf-8');
        if (/\bmcp\b/i.test(reqs)) isMcp = true;
    }
    if (fs.existsSync(pyprojectPath)) {
        const pyproj = fs.readFileSync(pyprojectPath, 'utf-8');
        if (/\bmcp\b/i.test(pyproj)) isMcp = true;
    }

    if (isMcp) {
        manifest.servers = manifest.servers || [];
        
        // Check for local .venv or Poetry
        let pythonCmd = 'python3';
        if (fs.existsSync(poetryLockPath)) {
            pythonCmd = 'poetry run python';
        } else {
            const venvDir = '.venv';
            const venvPath = path.join(pkgPath, venvDir);
            if (fs.existsSync(venvPath)) {
                const venvPython = process.platform === 'win32' 
                    ? path.join(venvPath, 'Scripts', 'python.exe')
                    : path.join(venvPath, 'bin', 'python3');
                if (fs.existsSync(venvPython)) {
                    pythonCmd = venvPython;
                }
            }
        }

        // Improved entry point detection
        const commonEntryPoints = ['src/mcp_server.py', 'src/server.py', 'mcp_server.py', 'server.py', 'app.py', 'main.py'];
        const entryPoint = commonEntryPoints.find(f => fs.existsSync(path.join(pkgPath, f))) || 'main.py';

        manifest.servers.push({
          name: `${manifest.name}-python`,
          command: pythonCmd,
          args: [entryPoint],
          description: `Python server from ${entryPoint}`
        });
    }
  }

  // Detect per-agent instruction files shipped inside a package.
  // Each agent auto-loads its own file when it reads resources from AgentBrew.
  const instructionFiles = [
    'CLAUDE.md',       // Claude Code
    'GEMINI.md',       // Gemini CLI
    'AGENTS.md',       // OpenAI Codex CLI
    '.cursorrules',    // Cursor (legacy single-file format; directory rules in .cursor/rules/ are served separately)
    '.windsurfrules',  // Windsurf (legacy; newer versions also use .windsurf/rules/)
    '.clinerules',     // Roo Code / Cline
  ];
  for (const file of instructionFiles) {
    const filePath = path.join(pkgPath, file);
    if (fs.existsSync(filePath)) {
      manifest.instructions = manifest.instructions || [];
      manifest.instructions.push({
        name: path.parse(file).name || file, // .cursorrules has no stem; use full name
        file: file
      });
    }
  }

  // Detect Markdown skills (only in skills/, prompts/, or migrated-skills/ directories)
  const dirName = path.basename(pkgPath).toLowerCase();
  const isSkillDir = dirName === 'skills' || dirName === 'prompts' || dirName === 'migrated-skills';

  if (isSkillDir) {
    try {
      const detectSkillsRecursive = (dir: string, baseDir: string) => {
          const files = fs.readdirSync(dir);
          for (const file of files) {
              const fullPath = path.join(dir, file);
              const relativePath = path.relative(baseDir, fullPath);
              if (fs.statSync(fullPath).isDirectory()) {
                  if (file !== 'node_modules' && !file.startsWith('.')) {
                      detectSkillsRecursive(fullPath, baseDir);
                  }
              } else if (file.endsWith('.md')) {
                  if (!instructionFiles.some(f => f.toLowerCase() === file.toLowerCase()) && file.toLowerCase() !== 'readme.md') {
                      let description = `Markdown skill: ${relativePath}`;
                      try {
                          const firstLines = fs.readFileSync(fullPath, 'utf-8').split('\n');
                          if (firstLines[0]?.trim() === '---') {
                              // YAML frontmatter — extract description: field
                              const fmEnd = firstLines.indexOf('---', 1);
                              if (fmEnd > 0) {
                                  const fmLines = firstLines.slice(1, fmEnd);
                                  const descIdx = fmLines.findIndex(l => /^description\s*:/.test(l));
                                  if (descIdx >= 0) {
                                      const inline = fmLines[descIdx].replace(/^description\s*:\s*/, '').trim();
                                      if (inline === '>-' || inline === '>' || inline === '|' || inline === '|-') {
                                          const blockLines: string[] = [];
                                          for (let i = descIdx + 1; i < fmLines.length; i++) {
                                              if (/^\s/.test(fmLines[i])) blockLines.push(fmLines[i].trim());
                                              else break;
                                          }
                                          description = blockLines.join(' ');
                                      } else {
                                          description = inline.replace(/^"|"$/g, '').trim();
                                      }
                                  } else {
                                      const heading = firstLines.slice(fmEnd + 1).find(l => /^#+\s/.test(l));
                                      if (heading) description = heading.replace(/^#+\s*/, '').trim();
                                  }
                              }
                          } else {
                              const firstNonEmpty = firstLines.find(l => l.trim().length > 0);
                              if (firstNonEmpty) description = firstNonEmpty.replace(/^#+\s*/, '').trim();
                          }
                      } catch (e) {}

                      manifest.prompts = manifest.prompts || [];
                      let skillName = path.parse(file).name;
                      if (skillName.toUpperCase() === 'SKILL' && dir !== pkgPath) {
                          skillName = path.basename(dir);
                      }
                      manifest.prompts.push({
                          name: skillName,
                          file: relativePath,
                          description: description
                      });
                  }
              }
          }
      };

      detectSkillsRecursive(pkgPath, pkgPath);
    } catch (e) {
        // Ignore
    }
  }

  return manifest;
}
