// src/cli.ts
import { Command } from 'commander';
import { installPackage } from './installer';

const program = new Command();

program
  .name('agentbrew')
  .description('Universal package manager for AI agents')
  .version('1.0.0');

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
    console.log("Listing packages...");
    // To be implemented in Task 7 logic
  });

program
  .command('uninstall')
  .description('Uninstall a package')
  .argument('<name>', 'Name of the package to uninstall')
  .action(async (name: string) => {
    console.log(`Uninstalling ${name}...`);
    // To be implemented in Task 7 logic
  });

program
  .command('status')
  .description('Check daemon status')
  .action(async () => {
    console.log("Checking status...");
    // To be implemented in Task 7 logic
  });

export function runCLI() {
  program.parse(process.argv);
}

if (require.main === module) {
  runCLI();
}
