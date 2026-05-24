// src/cli.ts
import { Command } from 'commander';
import { installPackage } from './installer';
import { startDaemon } from './daemon';
import { enablePackage, disablePackage } from './state';
import { discoverPackages } from './registry';
import fs from 'fs';
import path from 'path';

const program = new Command();

program
  .name('agentbrew')
  .description('Universal package manager for AI agents')
  .version('1.0.0');

// Default action: Start the MCP Router (for AI agents)
program
  .action(async () => {
    // Silencing console output to keep stdout clean for MCP JSON-RPC
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    console.log = () => {};
    console.error = () => {};
    
    await startDaemon();
  });

program
  .command('install')
  .description('Install a package from a Git URL')
  .argument('<url>', 'Git URL of the package')
  .action(async (url: string) => {
    try {
      await installPackage(url);
      console.log(`Successfully installed package from ${url}`);
    } catch (error: any) {
      console.error(`Failed to install package: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List installed packages')
  .action(async () => {
    const packages = discoverPackages(true); // include disabled
    if (packages.length === 0) {
      console.log("No packages installed.");
      return;
    }
    console.log("Installed Packages:");
    console.log("-------------------");
    for (const pkg of packages) {
      const status = pkg.isEnabled ? "[ENABLED]" : "[DISABLED]";
      console.log(`${status} ${pkg.manifest.name} (v${pkg.manifest.version})`);
    }
  });

program
  .command('enable')
  .description('Enable an installed package')
  .argument('<name>', 'Name of the package to enable')
  .action((name: string) => {
    if (enablePackage(name)) {
      console.log(`Enabled package '${name}'`);
    } else {
      console.log(`Package '${name}' is already enabled.`);
    }
  });

program
  .command('disable')
  .description('Disable an installed package')
  .argument('<name>', 'Name of the package to disable')
  .action((name: string) => {
    if (disablePackage(name)) {
      console.log(`Disabled package '${name}'`);
    } else {
      console.log(`Package '${name}' is already disabled.`);
    }
  });

program
  .command('uninstall')
  .description('Uninstall a package')
  .argument('<name>', 'Name of the package to uninstall')
  .action(async (name: string) => {
    const packages = discoverPackages(true);
    const target = packages.find(p => p.manifest.name === name);
    if (!target) {
      console.error(`Package '${name}' not found.`);
      process.exit(1);
    }
    try {
      console.log(`Uninstalling ${name} from ${target.path}...`);
      fs.rmSync(target.path, { recursive: true, force: true });
      console.log(`Successfully uninstalled ${name}`);
    } catch (error: any) {
      console.error(`Failed to uninstall: ${error.message}`);
      process.exit(1);
    }
  });

export function runCLI() {
  program.parse(process.argv);
}

if (require.main === module) {
  runCLI();
}
