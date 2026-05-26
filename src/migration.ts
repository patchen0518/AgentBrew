import fs from 'fs';
import path from 'path';
import os from 'os';
import * as readline from 'readline';
import * as toml from 'smol-toml';
import { Logger } from './logger';
import { createLinkPackage, installPackage } from './installer';
import { getPackagesDir } from './config';

export interface DiscoveredServer {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  source: string;
  repoUrl?: string;
}

export interface DiscoveredSkill {
  name: string;
  path: string;
  source: string;
  repoUrl?: string;
}

export interface DiscoveryResult {
  servers: DiscoveredServer[];
  skills: DiscoveredSkill[];
}

export async function runMigration(): Promise<DiscoveryResult | undefined> {
  const result = discoverExternalConfigs();
  if (result.servers.length === 0 && result.skills.length === 0) {
    Logger.info('No external configurations found to migrate.');
    return undefined;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query: string) => new Promise<string>((resolve) => rl.question(query, resolve));

  try {
    for (const srv of result.servers) {
      const answer = (await question(`Found ${srv.source} server '${srv.name}'. Migrate? [L]ink, [I]nstall (if Git), [S]kip: `)).toLowerCase();
      if (answer === 'l') {
        try {
          await createLinkPackage(srv.name, srv.command, srv.args, srv.env);
          Logger.info(`Successfully linked ${srv.name}`);
        } catch (e: any) {
          Logger.error(`Failed to link ${srv.name}: ${e.message}`);
        }
      } else if (answer === 'i') {
        if (srv.repoUrl) {
          try {
            await installPackage(srv.repoUrl);
            Logger.info(`Successfully installed ${srv.name} from ${srv.repoUrl}`);
          } catch (e: any) {
            Logger.error(`Failed to install ${srv.name}: ${e.message}`);
          }
        } else {
          Logger.info(`No repository URL found for ${srv.name}, falling back to Link...`);
          try {
            await createLinkPackage(srv.name, srv.command, srv.args, srv.env);
            Logger.info(`Successfully linked ${srv.name}`);
          } catch (e: any) {
            Logger.error(`Failed to link ${srv.name}: ${e.message}`);
          }
        }
      }
    }

    for (const skill of result.skills) {
      // Automatically migrate skills without prompting
      const migratedSkillsDir = path.join(getPackagesDir(), 'migrated-skills');
      if (!fs.existsSync(migratedSkillsDir)) {
        fs.mkdirSync(migratedSkillsDir, { recursive: true });
      }
      const tomlPath = path.join(migratedSkillsDir, 'agentbrew.toml');
      if (!fs.existsSync(tomlPath)) {
        const manifest = {
          name: 'migrated-skills',
          version: '1.0.0',
          description: 'Skills migrated from other platforms'
        };
        fs.writeFileSync(tomlPath, toml.stringify(manifest as any), 'utf-8');
      }

      // To avoid collisions in migrated-skills directory, we'll use a unique name
      // based on the path if it's a generic "SKILL.md" or similar.
      let targetFileName = path.basename(skill.path);
      if (targetFileName.toUpperCase() === 'SKILL.MD') {
          const parentDir = path.basename(path.dirname(skill.path));
          targetFileName = `${parentDir}-SKILL.md`;
      }

      const targetPath = path.join(migratedSkillsDir, targetFileName);
      if (!fs.existsSync(targetPath)) {
        fs.copyFileSync(skill.path, targetPath);
        Logger.info(`Successfully migrated skill: ${skill.name} (copied from ${skill.path})`);
      } else {
        // Skip silently or log if already exists
      }
    }
    
    if (result.skills.length > 0) {
      Logger.info("\nNote: AgentBrew has made a copy of the migrated skills in its own directory.");
      Logger.info("The original files still exist. You can safely remove them if you only plan to use them via AgentBrew.");
    }

    return result;
  } catch (e: any) {
    Logger.error(`Migration failed: ${e.message}`);
    return undefined;
  } finally {
    rl.close();
  }
}

export function discoverExternalConfigs(): DiscoveryResult {
  const result: DiscoveryResult = {
    servers: [],
    skills: [],
  };

  const home = os.homedir();

  // 1. Gemini
  const geminiConfigs = [
    path.join(home, '.gemini', 'config', 'mcp_config.json'),
    path.join(home, '.gemini', 'antigravity', 'mcp_config.json'),
  ];

  for (const configPath of geminiConfigs) {
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        if (!content.trim()) continue; // Skip empty files
        const config = JSON.parse(content);
        if (config.mcpServers) {
          for (const [name, serverConfig] of Object.entries(config.mcpServers as any)) {
            const sc = serverConfig as any;
            result.servers.push({
              name,
              command: sc.command,
              args: sc.args || [],
              env: sc.env,
              source: 'Gemini',
            });
          }
        }
      } catch (e) {
        Logger.error(`Failed to parse Gemini config at ${configPath}:`, e);
      }
    }
  }

  // Gemini Skills
  const extensionsDir = path.join(home, '.gemini', 'extensions');
  if (fs.existsSync(extensionsDir)) {
    try {
      const extensionDirs = fs.readdirSync(extensionsDir);
      for (const extDir of extensionDirs) {
        const fullExtPath = path.join(extensionsDir, extDir);
        if (!fs.statSync(fullExtPath).isDirectory()) continue;
        
        const skillsDir = path.join(fullExtPath, 'skills');
        if (fs.existsSync(skillsDir)) {
          let repoUrl: string | undefined;
          const pkgJsonPath = path.join(fullExtPath, 'package.json');
          if (fs.existsSync(pkgJsonPath)) {
              try {
                  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
                  repoUrl = extractRepoUrl(pkgJson);
              } catch (e) {}
          }

          const files = findFilesRecursive(skillsDir, '.md');
          for (const file of files) {
            let name = path.parse(file).name;
            if (name.toUpperCase() === 'SKILL') {
                name = `${path.basename(path.dirname(file))}/SKILL`;
            }
            result.skills.push({
              name,
              path: file,
              source: 'Gemini',
              repoUrl
            });
          }
        }
      }
    } catch (e) {
        // Ignore
    }
  }

  // 2. Claude
  const claudePluginsConfig = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
  if (fs.existsSync(claudePluginsConfig)) {
    try {
      const content = fs.readFileSync(claudePluginsConfig, 'utf-8');
      const plugins = JSON.parse(content);
      const pluginList = Array.isArray(plugins) ? plugins : Object.values(plugins);
      
      for (const plugin of pluginList as any[]) {
        const installPath = plugin.installPath;
        if (installPath && fs.existsSync(installPath)) {
          // MCP Server
          const mcpJsonPath = path.join(installPath, '.mcp.json');
          if (fs.existsSync(mcpJsonPath)) {
            try {
              const mcpContent = fs.readFileSync(mcpJsonPath, 'utf-8');
              const mcpConfig = JSON.parse(mcpContent);
              const pkgJsonPath = path.join(installPath, 'package.json');
              let repoUrl: string | undefined;
              if (fs.existsSync(pkgJsonPath)) {
                  try {
                      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
                      repoUrl = extractRepoUrl(pkgJson);
                  } catch (e) {}
              }

              result.servers.push({
                name: mcpConfig.name || path.basename(installPath),
                command: mcpConfig.command,
                args: mcpConfig.args || [],
                env: mcpConfig.env,
                source: 'Claude',
                repoUrl
              });
            } catch (e) {
              Logger.error(`Failed to parse Claude MCP config at ${mcpJsonPath}:`, e);
            }
          }
          
          // Skills
          const skillsPath = path.join(installPath, 'skills');
          if (fs.existsSync(skillsPath)) {
            const files = findFilesRecursive(skillsPath, '.md');
            for (const file of files) {
              let name = path.parse(file).name;
              if (name.toUpperCase() === 'SKILL') {
                  name = `${path.basename(path.dirname(file))}/SKILL`;
              }
              result.skills.push({
                name,
                path: file,
                source: 'Claude',
              });
            }
          }
        }
      }
    } catch (e) {
      Logger.error(`Failed to parse Claude plugins config at ${claudePluginsConfig}:`, e);
    }
  }

  // 3. Cursor
  const cursorConfig = path.join(home, '.cursor', 'mcp.json');
  if (fs.existsSync(cursorConfig)) {
    try {
      const content = fs.readFileSync(cursorConfig, 'utf-8');
      const config = JSON.parse(content);
      if (config.mcpServers) {
        for (const [name, serverConfig] of Object.entries(config.mcpServers as any)) {
          const sc = serverConfig as any;
          result.servers.push({
            name,
            command: sc.command,
            args: sc.args || [],
            env: sc.env,
            source: 'Cursor',
          });
        }
      }
    } catch (e) {
      Logger.error(`Failed to parse Cursor config at ${cursorConfig}:`, e);
    }
  }

  return result;
}

function findFilesRecursive(dir: string, ext: string): string[] {
  let results: string[] = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        results = results.concat(findFilesRecursive(fullPath, ext));
      } else if (file.endsWith(ext)) {
        results.push(fullPath);
      }
    }
  } catch (e) {
    // Ignore
  }
  return results;
}

function extractRepoUrl(pkgJson: any): string | undefined {
    if (pkgJson.repository) {
        if (typeof pkgJson.repository === 'string') {
            return pkgJson.repository;
        } else if (typeof pkgJson.repository === 'object' && pkgJson.repository.url) {
            return pkgJson.repository.url;
        }
    }
    if (pkgJson.homepage) {
        return pkgJson.homepage;
    }
    return undefined;
}
