import fs from 'fs';
import path from 'path';
import * as toml from 'smol-toml';
import { isPackageEnabled } from './state';
import { Logger } from './logger';
import { getPackagesDir } from './config';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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
  }[];
  prompts?: {
    name: string;
    file: string;
    description: string;
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
  }
}

export interface PackageInfo {
  packageName: string;
  path: string;
  manifest: PackageManifest;
  isEnabled: boolean;
}

/**
 * Discovers capabilities by briefly running the server and saves them to mcp-manifest.json.
 */
export async function generateMcpManifest(pkgPath: string, manifest: PackageManifest): Promise<McpManifestCache> {
    const cache: McpManifestCache = { ...manifest, discovered: { tools: {}, prompts: {}, resources: {} } };
    
    if (manifest.servers) {
        for (const server of manifest.servers) {
            Logger.info(`Discovering capabilities for server: ${server.name}...`);
            const transport = new StdioClientTransport({
                command: server.command,
                args: server.args,
                env: server.env,
                cwd: pkgPath,
                stderr: 'inherit'
            });

            const client = new Client(
                { name: "agentbrew-discovery", version: "1.0.0" },
                { capabilities: {} }
            );

            try {
                await client.connect(transport);
                
                const tools = await client.listTools();
                const prompts = await client.listPrompts();
                const resources = await client.listResources();

                if (cache.discovered) {
                    cache.discovered.tools![server.name] = tools.tools;
                    cache.discovered.prompts![server.name] = prompts.prompts;
                    cache.discovered.resources![server.name] = resources.resources;
                }

                await client.close();
            } catch (e: any) {
                Logger.error(`Failed to discover capabilities for ${server.name}: ${e.message}`);
            }
        }
    }

    const cachePath = path.join(pkgPath, 'mcp-manifest.json');
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
    return cache;
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
        const isEnabled = isPackageEnabled(rootDir, manifestInfo.manifest.name);
        if (isEnabled || includeDisabled) {
            packages.push({
                packageName: rootDir,
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
    
    // Check for cached manifest first
    const cachePath = path.join(currentPath, 'mcp-manifest.json');
    if (fs.existsSync(cachePath)) {
        try {
            const manifest = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as McpManifestCache;
            results.push({ path: currentPath, manifest });
            return results; // If cache exists, we trust it and stop here for this path
        } catch (e) {
            Logger.error(`Failed to parse cache ${cachePath}:`, e);
        }
    }

    const manifestPath = path.join(currentPath, 'agentbrew.toml');
    const packageJsonPath = path.join(currentPath, 'package.json');
    const requirementsPath = path.join(currentPath, 'requirements.txt');
    
    let manifest: PackageManifest | null = null;

    if (fs.existsSync(manifestPath)) {
        try {
            const content = fs.readFileSync(manifestPath, 'utf-8');
            manifest = toml.parse(content) as any;
        } catch (e) {
            Logger.error(`Failed to parse ${manifestPath}:`, e);
        }
    }

    const autoManifest = autoDetectManifest(currentPath);

    if (manifest) {
        // Merge auto-detected into explicit manifest
        // TOML takes precedence for same-named items
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
        results.push({ path: currentPath, manifest });
    } else {
        // Only include auto-detected if it found something useful (servers or prompts)
        if (fs.existsSync(packageJsonPath) || fs.existsSync(requirementsPath) || (autoManifest.prompts && autoManifest.prompts.length > 0)) {
            results.push({ path: currentPath, manifest: autoManifest });
        }
    }

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

        // Improved auto-detection for bin entries
        if (pkgJson.bin) {
            const binName = typeof pkgJson.bin === 'string' ? manifest.name : Object.keys(pkgJson.bin)[0];
            const binPath = typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin[binName];
            manifest.servers = [{
                name: binName,
                command: 'node',
                args: [binPath],
                description: `Node.js server from ${binName}`
            }];
        } else if (hasMcpSdk) {
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
  
  if (fs.existsSync(requirementsPath) || fs.existsSync(pyprojectPath)) {
    let isMcp = false;
    if (fs.existsSync(requirementsPath)) {
        const reqs = fs.readFileSync(requirementsPath, 'utf-8');
        if (reqs.includes('mcp')) isMcp = true;
    }
    if (fs.existsSync(pyprojectPath)) {
        const pyproj = fs.readFileSync(pyprojectPath, 'utf-8');
        if (pyproj.includes('mcp')) isMcp = true;
    }

    if (isMcp) {
        manifest.servers = manifest.servers || [];
        
        // Check for local .venv
        let pythonCmd = 'python3';
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

  // Detect Markdown skills
  try {
    const files = fs.readdirSync(pkgPath);
    const mdFiles = files.filter((f: string) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md');
    if (mdFiles.length > 0) {
        manifest.prompts = manifest.prompts || [];
        for (const file of mdFiles) {
            let description = `Markdown skill: ${file}`;
            try {
                const firstLines = fs.readFileSync(path.join(pkgPath, file), 'utf-8').split('\n');
                const firstNonEmpty = firstLines.find(l => l.trim().length > 0);
                if (firstNonEmpty) {
                    description = firstNonEmpty.replace(/^#+\s*/, '').trim();
                }
            } catch (e) {}

            manifest.prompts.push({
                name: path.parse(file).name,
                file: file,
                description: description
            });
        }
    }
  } catch (e) {
      // Ignore
  }

  return manifest;
}
