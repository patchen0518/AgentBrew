#!/usr/bin/env node
// src/cli.ts
import { Command } from 'commander';
import { installPackage } from './installer';
import { startRouter, ManagedClient } from './router';
import { enablePackage, disablePackage, isPackageEnabled } from './state';
import { discoverPackages, PackageInfo, findManifests, generateMcpManifest } from './registry';
import { runMigration, discoverExternalConfigs } from './migration';
import fs from 'fs';
import path from 'path';

import * as toml from 'smol-toml';

import { Logger } from './logger';

export const program = new Command();

program
  .name('agentbrew')
  .description('Universal package manager for AI agents')
  .version('1.0.0');

// Default action: Start the MCP Router (for AI agents)
program
  .action(async () => {
    const router = await startRouter();

    // Graceful shutdown
    const shutdown = async () => {
      Logger.info("Shutting down AgentBrew Router...");
      await router.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program
  .command('refresh')
  .description('Refresh the capability cache for all installed packages')
  .action(async () => {
    const packages = discoverPackages(true);
    if (packages.length === 0) {
      Logger.info("No packages to refresh.");
      return;
    }

    // Use a Set to avoid double-refreshing sub-projects in the same package
    const refreshedPaths = new Set<string>();

    for (const pkg of packages) {
      if (refreshedPaths.has(pkg.path)) continue;
      
      Logger.info(`Refreshing cache for ${pkg.packageName}...`);
      const manifests = findManifests(pkg.path, 2);
      for (const m of manifests) {
        await generateMcpManifest(m.path, m.manifest);
      }
      refreshedPaths.add(pkg.path);
    }
    Logger.info("Refresh complete.");
  });

program
  .command('install')
  .description('Install a package from a Git URL')
  .argument('<url>', 'Git URL of the package')
  .action(async (url: string) => {
    try {
      await installPackage(url);
      Logger.info(`Successfully installed package from ${url}`);
    } catch (error: any) {
      Logger.error(`Failed to install package: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List installed packages and their capabilities')
  .argument('[packageName]', 'Optional: filter by package name')
  .action(async (packageName?: string) => {
    let packages = discoverPackages(true); // include disabled
    if (packageName) {
      packages = packages.filter(p => p.packageName === packageName);
    }

    if (packages.length === 0) {
      Logger.info(packageName ? `Package '${packageName}' not found.` : "No packages installed.");
      return;
    }

    // Group by packageName
    const grouped = new Map<string, PackageInfo[]>();
    for (const pkg of packages) {
        const list = grouped.get(pkg.packageName) || [];
        list.push(pkg);
        grouped.set(pkg.packageName, list);
    }

    Logger.info("Installed Packages:");
    Logger.info("====================");

    for (const [pkgName, items] of grouped.entries()) {
        const pkgEnabled = isPackageEnabled(pkgName);
        const status = pkgEnabled ? "[ENABLED]" : "[DISABLED]";
        Logger.info(`\n${status} ${pkgName}`);
        
        for (const item of items) {
            // MCP Servers
            if (item.manifest.servers) {
                for (const srv of item.manifest.servers) {
                    const capEnabled = isPackageEnabled(pkgName, srv.name);
                    const capStatus = capEnabled ? "[ENABLED]" : "[DISABLED]";
                    Logger.info(`  ├── [MCP] ${srv.name} ${capStatus} - ${srv.description || ""}`);
                }
            }
            // Skills
            if (item.manifest.prompts) {
                for (const prompt of item.manifest.prompts) {
                    const capEnabled = isPackageEnabled(pkgName, prompt.name);
                    const capStatus = capEnabled ? "[ENABLED]" : "[DISABLED]";
                    Logger.info(`  ├── [SKILL] ${prompt.name} ${capStatus} - ${prompt.description || ""}`);
                }
            }
            // Resources (Instructions)
            if (item.manifest.instructions) {
                for (const instr of item.manifest.instructions) {
                    Logger.info(`  ├── [RESOURCE] ${instr.name} (${instr.file})`);
                }
            }
        }
    }
  });

program
  .command('enable')
  .description('Enable an installed package or a specific capability')
  .argument('<name>', 'Package name')
  .argument('[capability]', 'Optional: specific capability name')
  .action((name: string, capability?: string) => {
    const id = capability ? `${name}:${capability}` : name;
    if (enablePackage(id)) {
      Logger.info(`Enabled ${capability ? `capability '${capability}' in ` : ''}package '${name}'`);
    } else {
      Logger.info(`${capability ? `Capability '${capability}' in ` : ''}Package '${name}' is already enabled.`);
    }
  });

program
  .command('disable')
  .description('Disable an installed package or a specific capability')
  .argument('<name>', 'Package name')
  .argument('[capability]', 'Optional: specific capability name')
  .action((name: string, capability?: string) => {
    const id = capability ? `${name}:${capability}` : name;
    if (disablePackage(id)) {
      Logger.info(`Disabled ${capability ? `capability '${capability}' in ` : ''}package '${name}'`);
    } else {
      Logger.info(`${capability ? `Capability '${capability}' in ` : ''}Package '${name}' is already disabled.`);
    }
  });

program
  .command('uninstall')
  .description('Uninstall a package or a specific capability')
  .argument('<name>', 'Package name')
  .argument('[capability]', 'Optional: specific capability name')
  .action(async (name: string, capability?: string) => {
    const packages = discoverPackages(true);
    const target = packages.find(p => p.packageName === name);
    if (!target) {
      Logger.error(`Package '${name}' not found.`);
      process.exit(1);
    }

    if (!capability) {
      try {
        Logger.info(`Uninstalling ${name} from ${target.path}...`);
        fs.rmSync(target.path, { recursive: true, force: true });
        Logger.info(`Successfully uninstalled package '${name}'`);
      } catch (error: any) {
        Logger.error(`Failed to uninstall: ${error.message}`);
        process.exit(1);
      }
      return;
    }

    // Capability provided
    let found = false;
    if (target.manifest.servers) {
      if (target.manifest.servers.some(s => s.name === capability)) {
        found = true;
      }
    }
    if (target.manifest.prompts) {
      if (target.manifest.prompts.some(p => p.name === capability)) {
        found = true;
      }
    }

    if (!found) {
      Logger.error(`Capability '${capability}' not found in package '${name}'.`);
      process.exit(1);
    }

    try {
      Logger.info(`Uninstalling capability '${capability}' from package '${name}'...`);

      // Read and update agentbrew.toml if it exists
      const manifestPath = path.join(target.path, 'agentbrew.toml');
      if (fs.existsSync(manifestPath)) {
        let content = fs.readFileSync(manifestPath, 'utf-8');
        // Let's parse it as TOML
        let parsed: any;
        try {
          parsed = toml.parse(content);
        } catch (e) {
          parsed = {};
        }

        if (parsed.servers) {
          parsed.servers = parsed.servers.filter((s: any) => s.name !== capability);
        }
        if (parsed.prompts) {
          parsed.prompts = parsed.prompts.filter((p: any) => p.name !== capability);
        }

        content = toml.stringify(parsed);
        fs.writeFileSync(manifestPath, content, 'utf-8');
      }

      // Also check if prompt file exists and delete it
      if (target.manifest.prompts) {
        const targetPrompt = target.manifest.prompts.find(p => p.name === capability);
        if (targetPrompt) {
          const promptFilePath = path.join(target.path, targetPrompt.file);
          if (fs.existsSync(promptFilePath)) {
            fs.rmSync(promptFilePath, { force: true });
          }
        }
      }

      Logger.info(`Successfully uninstalled capability '${capability}' from package '${name}'`);
    } catch (error: any) {
      Logger.error(`Failed to uninstall capability: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('migrate')
  .description('Migrate configurations and skills from other platforms (Gemini, Claude, Cursor)')
  .option('--dry-run', 'List discovered configurations without performing migration')
  .action(async (options) => {
    if (options.dryRun) {
      const result = discoverExternalConfigs();
      Logger.info("Discovered External Configurations (Dry Run):");
      
      if (result.servers.length === 0 && result.skills.length === 0) {
        Logger.info("No external configurations found.");
        return;
      }

      if (result.servers.length > 0) {
        Logger.info("\nServers:");
        for (const srv of result.servers) {
          Logger.info(`- [${srv.source}] ${srv.name}: ${srv.command} ${srv.args.join(' ')}`);
        }
      }

      if (result.skills.length > 0) {
        Logger.info("\nSkills:");
        for (const skill of result.skills) {
          Logger.info(`- [${skill.source}] ${skill.name} (${skill.path})`);
        }
      }
    } else {
      await runMigration();
      Logger.info("Migration complete!");
      Logger.info("To use AgentBrew with your agents, run:");
      Logger.info("  gemini mcp add agentbrew agentbrew");
      Logger.info("\nNote: If you need to disable AgentBrew later, use 'gemini mcp remove agentbrew'.");
    }
  });

export function runCLI() {
  program.parse(process.argv);
}

if (require.main === module) {
  runCLI();
}
