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

export function runCLI() {
  program.parse(process.argv);
}

if (require.main === module) {
  runCLI();
}
