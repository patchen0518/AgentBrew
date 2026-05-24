import { spawn, ChildProcess } from 'child_process';
import { discoverPackages, PackageInfo } from './registry';

export class Daemon {
  private processes: Map<string, ChildProcess> = new Map();

  async start() {
    console.log("AgentBrew Daemon starting...");
    const packages = discoverPackages();
    console.log(`Discovered ${packages.length} packages.`);

    for (const pkg of packages) {
      await this.initializePackage(pkg);
    }

    return true;
  }

  private async initializePackage(pkg: PackageInfo) {
    if (pkg.manifest.servers) {
      for (const server of pkg.manifest.servers) {
        console.log(`Starting server '${server.name}' for package '${pkg.manifest.name}'...`);
        const child = spawn(server.command, server.args, {
          cwd: pkg.path,
          stdio: ['pipe', 'pipe', 'pipe']
        });

        child.on('exit', (code) => {
          console.log(`Server '${server.name}' exited with code ${code}`);
          this.processes.delete(server.name);
        });

        child.stderr?.on('data', (data) => {
          console.error(`[${server.name}] ${data}`);
        });

        this.processes.set(server.name, child);
      }
    }
  }

  stop() {
    for (const [name, child] of this.processes) {
      console.log(`Stopping server '${name}'...`);
      child.kill();
    }
    this.processes.clear();
  }
}

export function startDaemon() {
  const daemon = new Daemon();
  daemon.start();
  return true;
}
