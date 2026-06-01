#!/usr/bin/env node
// src/cli.ts
import { Command } from 'commander';
import { installPackage, resolveDependencies, createLinkPackage } from './installer';
import { updatePackage, updateAllPackages } from './updater';
import { startRouter } from './router';
import { enablePackage, disablePackage, isPackageEnabled } from './state';
import { discoverPackages, PackageInfo, McpManifestCache, findManifests, generateMcpManifest, warnIfDiscoveryFailed } from './registry';
import { runMigration, discoverExternalConfigs } from './migration';
import {
  syncInstructions,
  unsyncInstructions,
  getInstructionsPath,
  extractSkillEntries,
  syncSkillsToClaudeCode,
  unsyncSkillsFromClaudeCode,
  syncSkillsToGeminiCLI,
  unsyncSkillsFromGeminiCLI,
  syncSkillsToWindsurf,
  unsyncSkillsFromWindsurf,
  syncSkillsToAntigravityCLI,
  unsyncSkillsFromAntigravityCLI,
  syncSkillsToCursor,
  unsyncSkillsFromCursor,
  syncMcpServerToCursor,
  unsyncMcpServerFromCursor,
  syncMcpServerToCodex,
  unsyncMcpServerFromCodex,
  cleanOrphanSkills,
} from './sync';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

import * as toml from 'smol-toml';

import { Logger } from './logger';

function syncSkillsAfterChange(opts: { cleanOrphans?: boolean } = {}) {
  if (opts.cleanOrphans) {
    const orphans = cleanOrphanSkills();
    if (orphans.length > 0) {
      Logger.info(`Removed ${orphans.length} stale skill link(s).`);
    }
  }
  const packages = discoverPackages();
  const skills = extractSkillEntries(packages);
  const allResults = [
    ...syncSkillsToClaudeCode(skills),
    ...syncSkillsToGeminiCLI(skills),
    ...syncSkillsToWindsurf(skills),
    ...syncSkillsToAntigravityCLI(skills),
    ...syncSkillsToCursor(skills),
  ];
  const linked = allResults.filter(r => r.status === 'linked');
  if (linked.length > 0) {
    Logger.info(`Registered ${linked.length} skill(s) with agents:`);
    linked.forEach(r => Logger.info(`  + ${r.entryName}`));
  }
}

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
  .option('--install', 'Also re-run dependency installation for each package (use after a manual clone)')
  .action(async (opts: { install?: boolean }) => {
    const packages = discoverPackages(true);
    if (packages.length === 0) {
      Logger.info("No packages to refresh.");
      return;
    }

    // Use a Set to avoid double-refreshing sub-projects in the same package
    const refreshedPaths = new Set<string>();

    for (const pkg of packages) {
      if (refreshedPaths.has(pkg.path)) continue;

      if (opts.install) {
        Logger.info(`Installing dependencies for ${pkg.packageName}...`);
        await resolveDependencies(pkg.path);
      }

      Logger.info(`Refreshing cache for ${pkg.packageName}...`);
      const manifests = findManifests(pkg.path, 2);
      for (const m of manifests) {
        const cache = await generateMcpManifest(m.path, m.manifest);
        warnIfDiscoveryFailed(m.manifest, cache);
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
      await installPackage(url, async (summary) => {
        if (summary.scripts.length > 0) {
          Logger.info("\nPotentially unsafe scripts found in package.json:");
          summary.scripts.forEach(s => Logger.info(`  - ${s}`));
          Logger.info("");
        } else {
          Logger.info("\nNo installation scripts found.");
        }

        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>(resolve => rl.question('Proceed with installation? [y/N] ', resolve));
        rl.close();
        return answer.toLowerCase() === 'y';
      });
      Logger.info(`Successfully installed package from ${url}`);
      syncSkillsAfterChange();
    } catch (error: any) {
      Logger.error(`Failed to install package: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('link')
  .description('Link an existing local MCP server into AgentBrew')
  .argument('<name>', 'Name for the linked server')
  .argument('<command>', 'Command to run the server')
  .argument('[args...]', 'Arguments to pass to the command')
  .option('--env <vars...>', 'Environment variables as KEY=VALUE pairs')
  .option('--cwd <path>', 'Working directory for the server')
  .action(async (name: string, command: string, args: string[], options: { env?: string[], cwd?: string }) => {
    const env: Record<string, string> = {};
    for (const pair of options.env ?? []) {
      const idx = pair.indexOf('=');
      if (idx === -1) {
        Logger.error(`Invalid env var format '${pair}'. Expected KEY=VALUE.`);
        process.exit(1);
      }
      env[pair.substring(0, idx)] = pair.substring(idx + 1);
    }
    try {
      await createLinkPackage(name, command, args, Object.keys(env).length > 0 ? env : undefined, options.cwd);
      Logger.info(`Successfully linked server '${name}'`);
      syncSkillsAfterChange();
    } catch (error: any) {
      Logger.error(`Failed to link server: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('update')
  .description('Update installed packages from their remote repositories')
  .argument('[packageName]', 'Name of the package to update')
  .option('--all', 'Update all installed packages')
  .action(async (packageName, options) => {
    try {
      if (options.all) {
        await updateAllPackages();
      } else if (packageName) {
        await updatePackage(packageName);
      } else {
        Logger.error("Please specify a package name or use --all");
        process.exit(1);
      }
    } catch (error: any) {
      Logger.error(error.message);
      process.exit(1);
    }

    syncSkillsAfterChange({ cleanOrphans: true });
  });

program
  .command('list')
  .description('List installed packages and their capabilities')
  .argument('[packageName]', 'Optional: filter by package name')
  .option('-v, --verbose', 'Show tool, prompt, and resource counts from the capability cache')
  .action(async (packageName: string | undefined, options: { verbose?: boolean }) => {
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
            const cache = item.manifest as McpManifestCache;

            // MCP Servers
            if (item.manifest.servers) {
                for (const srv of item.manifest.servers) {
                    const capEnabled = isPackageEnabled(pkgName, srv.name);
                    const capStatus = capEnabled ? "[ENABLED]" : "[DISABLED]";
                    Logger.info(`  ├── [MCP] ${srv.name} ${capStatus} - ${srv.description || ""}`);
                    if (options.verbose && cache.discovered) {
                        const tools = cache.discovered.tools?.[srv.name]?.length ?? 0;
                        const prompts = cache.discovered.prompts?.[srv.name]?.length ?? 0;
                        const resources = cache.discovered.resources?.[srv.name]?.length ?? 0;
                        Logger.info(`  │         (${tools} tools, ${prompts} prompts, ${resources} resources)`);
                    }
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
    if (enablePackage(id) === 'changed') {
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
    if (disablePackage(id) === 'changed') {
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
        const orphans = cleanOrphanSkills();
        if (orphans.length > 0) {
          Logger.info(`Removed ${orphans.length} stale skill link(s).`);
        }
        // Regenerate Cursor index with remaining skills (cleanOrphanSkills can't regenerate it)
        syncSkillsToCursor(extractSkillEntries(discoverPackages()));
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

      // Delete the stale cache so findManifests falls back to the updated TOML
      const cachePath = path.join(target.path, 'mcp-manifest.json');
      if (fs.existsSync(cachePath)) {
        fs.rmSync(cachePath, { force: true });
      }
      // Regenerate cache from the updated manifest
      const manifests = findManifests(target.path, 2);
      for (const m of manifests) {
        const cache = await generateMcpManifest(m.path, m.manifest);
        warnIfDiscoveryFailed(m.manifest, cache);
      }

      Logger.info(`Successfully uninstalled capability '${capability}' from package '${name}'`);

      const orphans = cleanOrphanSkills();
      if (orphans.length > 0) {
        Logger.info(`Removed ${orphans.length} stale skill link(s).`);
      }
      syncSkillsToCursor(extractSkillEntries(discoverPackages()));
    } catch (error: any) {
      Logger.error(`Failed to uninstall capability: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('migrate')
  .description('Migrate configurations and skills from other platforms (Gemini, Claude, Cursor, Windsurf)')
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
      const result = await runMigration();
      if (result) {
        Logger.info("\nMigration complete!");
        Logger.info("To use AgentBrew with your agents, follow these steps:");

        const sources = new Set([...result.servers.map(s => s.source), ...result.skills.map(s => s.source)]);
        
        if (sources.has('Gemini')) {
          Logger.info("\nFor Gemini CLI:");
          Logger.info("  gemini mcp add agentbrew agentbrew");
        }

        if (sources.has('Claude')) {
          Logger.info("\nFor Claude Code:");
          Logger.info("  /plugin add agentbrew agentbrew");
        }

        if (sources.has('Cursor')) {
          const cursorMcpResults = syncMcpServerToCursor();
          const registered = cursorMcpResults.find(r => r.status === 'linked' || r.status === 'already_exists');
          if (registered) {
            Logger.info(`\n✅  Cursor: agentbrew registered in ${registered.path}`);
          } else {
            Logger.info("\nFor Cursor:");
            Logger.info("  Open Cursor Settings > MCP and add a new server:");
            Logger.info("  Name: agentbrew  |  Type: command  |  Command: agentbrew");
          }
        }

        if (sources.has('Windsurf')) {
          Logger.info("\nFor Windsurf:");
          Logger.info("  Open Windsurf Settings > MCP Servers and add:");
          Logger.info("  Name: agentbrew  |  Command: agentbrew");
        }

        if (sources.has('OpenAI Codex CLI')) {
          const codexMcpResults = syncMcpServerToCodex();
          const registered = codexMcpResults.find(r => r.status === 'linked' || r.status === 'already_exists');
          if (registered) {
            Logger.info(`\n✅  Codex CLI: agentbrew registered in ${registered.path}`);
          } else {
            Logger.info("\nFor OpenAI Codex CLI:");
            Logger.info("  Run: codex mcp add agentbrew agentbrew");
            Logger.info("  Or manually add to ~/.codex/config.toml under [mcp_servers.agentbrew]");
          }
        }

        Logger.info("\nNote: You can always use 'agentbrew list' to see all available tools and skills.");
      }
    }
  });

program
  .command('sync')
  .description('Inject shared instructions into agent configs and register skills with Claude Code')
  .action(() => {
    const instructionsPath = getInstructionsPath();
    Logger.info('AgentBrew Sync');
    Logger.info('==============');
    Logger.info('⚠️  agentbrew sync will add an "AgentBrew Shared" section to your agent');
    Logger.info('   config files (e.g. CLAUDE.md, GEMINI.md, AGENTS.md). The section is clearly marked');
    Logger.info('   and can be removed at any time with: agentbrew unsync\n');

    const results = syncInstructions();

    if (results.length === 0) {
      Logger.info(`No INSTRUCTIONS.md found — created an example at:\n  ${instructionsPath}`);
      Logger.info('\nEdit it, then run agentbrew sync again.');
      return;
    }

    Logger.info(`Syncing instructions from: ${instructionsPath}\n`);

    const statusIcon: Record<string, string> = {
      created: '✅',
      updated: '✅',
      unchanged: '⏭️ ',
      skipped: '⚫',
      manual: 'ℹ️ ',
      removed: '🗑️ ',
      not_found: '⚫',
      no_section: '⚫',
    };

    const manualNotes: string[] = [];
    let synced = 0;

    for (const r of results) {
      const icon = statusIcon[r.status] ?? '  ';
      const detail = r.path ? ` (${r.path})` : r.note ? ` (${r.note})` : '';
      Logger.info(`${icon}  ${r.agent.padEnd(18)} → ${r.status}${detail}`);
      if (r.status === 'manual' && r.note) manualNotes.push(`  ${r.agent}: ${r.note}`);
      if (r.status === 'created' || r.status === 'updated') synced++;
    }

    if (manualNotes.length > 0) {
      Logger.info('\nManual steps required:');
      manualNotes.forEach(n => Logger.info(n));
    }

    // Sync skills to each agent
    Logger.info('\nSyncing skills...');
    const packages = discoverPackages();
    const skills = extractSkillEntries(packages);

    const skillStatusIcon: Record<string, string> = {
      linked: '✅',
      already_exists: '⏭️ ',
      skipped: '⚫',
      error: '❌',
      removed: '🗑️ ',
    };

    function printSkillResults(label: string, results: ReturnType<typeof syncSkillsToClaudeCode>) {
      if (results.length === 0) {
        Logger.info(`  ${label}: not installed, skipped`);
        return;
      }
      for (const r of results) {
        const icon = skillStatusIcon[r.status] ?? '  ';
        const detail = r.note ? ` (${r.note})` : '';
        Logger.info(`${icon}  [${label}] ${r.entryName}${detail}`);
      }
    }

    const claudeSkills = syncSkillsToClaudeCode(skills);
    const geminiSkills = syncSkillsToGeminiCLI(skills);
    const windsurfSkills = syncSkillsToWindsurf(skills);
    const antigravitySkills = syncSkillsToAntigravityCLI(skills);

    // Register agentbrew as an MCP server in Cursor — this exposes all skills as MCP tools.
    // Only fall back to the markdown index if MCP registration failed or Cursor isn't installed.
    const cursorMcpResults = syncMcpServerToCursor();
    const cursorMcpOk = cursorMcpResults.some(r => r.status === 'linked' || r.status === 'already_exists');
    const cursorSkills = cursorMcpOk
      ? unsyncSkillsFromCursor()   // remove stale index — MCP tools supersede it
      : syncSkillsToCursor(skills); // fallback: markdown index for non-MCP discovery

    // Register agentbrew as an MCP server in Codex CLI.
    const codexMcpResults = syncMcpServerToCodex();

    if (skills.length === 0) {
      Logger.info('  No skills found in installed packages.');
    } else {
      printSkillResults('Claude Code', claudeSkills);
      printSkillResults('Gemini CLI', geminiSkills);
      printSkillResults('Windsurf', windsurfSkills);
      printSkillResults('Antigravity CLI', antigravitySkills);
      printSkillResults('Cursor MCP', cursorMcpResults);
      if (!cursorMcpOk) printSkillResults('Cursor (fallback index)', cursorSkills);
      printSkillResults('Codex MCP', codexMcpResults);

      const totalLinked = [...claudeSkills, ...geminiSkills, ...windsurfSkills, ...antigravitySkills, ...cursorMcpResults, ...codexMcpResults]
        .filter(r => r.status === 'linked').length;
      if (totalLinked > 0) {
        Logger.info(`\n  Restart your agents to pick up ${totalLinked} new skill(s).`);
      }
    }

    Logger.info(`\nDone. ${synced} agent config(s) updated.`);
  });

program
  .command('unsync')
  .description('Remove the AgentBrew shared section from all agent config files and unlink skills')
  .action(() => {
    Logger.info('Removing AgentBrew shared section from agent config files...\n');
    const results = unsyncInstructions();

    for (const r of results) {
      const icon = r.status === 'removed' ? '🗑️ ' : r.status === 'manual' ? 'ℹ️ ' : '⚫';
      const detail = r.path ? ` (${r.path})` : r.note ? ` (${r.note})` : '';
      Logger.info(`${icon}  ${r.agent.padEnd(18)} → ${r.status}${detail}`);
    }

    Logger.info('\nRemoving skill links from agents...');
    const allUnsyncResults = [
      ...unsyncSkillsFromClaudeCode(),
      ...unsyncSkillsFromGeminiCLI(),
      ...unsyncSkillsFromWindsurf(),
      ...unsyncSkillsFromAntigravityCLI(),
      ...unsyncSkillsFromCursor(),
      ...unsyncMcpServerFromCursor(),
      ...unsyncMcpServerFromCodex(),
    ];
    if (allUnsyncResults.length === 0) {
      Logger.info('  No skill links to remove.');
    } else {
      for (const r of allUnsyncResults) {
        const icon = r.status === 'removed' ? '🗑️ ' : '⚫';
        const detail = r.note ? ` (${r.note})` : r.path ? ` (${r.path})` : '';
        Logger.info(`${icon}  ${r.entryName}${detail}`);
      }
    }

    Logger.info('\nDone. Run agentbrew sync to re-inject.');
  });

export function runCLI() {
  program.parse(process.argv);
}

if (require.main === module) {
  runCLI();
}
