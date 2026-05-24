// src/registry.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import * as toml from 'smol-toml';

const BREW_ROOT = path.join(os.homedir(), '.agentbrew');
const PACKAGES_DIR = path.join(BREW_ROOT, 'packages');

export interface PackageManifest {
  name: string;
  version: string;
  servers?: {
    name: string;
    command: string;
    args: string[];
    build_command?: string;
  }[];
  prompts?: {
    name: string;
    file: string;
    description: string;
  }[];
}

export interface PackageInfo {
  path: string;
  manifest: PackageManifest;
}

export function discoverPackages(): PackageInfo[] {
  if (!fs.existsSync(PACKAGES_DIR)) return [];

  const dirs = fs.readdirSync(PACKAGES_DIR);
  const packages: PackageInfo[] = [];

  for (const dir of dirs) {
    const fullPath = path.join(PACKAGES_DIR, dir);
    if (!fs.statSync(fullPath).isDirectory()) continue;

    const manifestPath = path.join(fullPath, 'agentbrew.toml');
    let manifest: PackageManifest;

    if (fs.existsSync(manifestPath)) {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      manifest = toml.parse(content) as any;
    } else {
      // Auto-detection fallback
      manifest = autoDetectManifest(fullPath);
    }

    packages.push({ path: fullPath, manifest });
  }

  return packages;
}

function autoDetectManifest(pkgPath: string): PackageManifest {
  const pkgName = path.basename(pkgPath);
  const manifest: PackageManifest = {
    name: pkgName,
    version: '0.0.0-auto',
  };

  const packageJsonPath = path.join(pkgPath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const pkgJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    manifest.name = pkgJson.name || pkgName;
    manifest.version = pkgJson.version || '0.0.0-auto';
    
    // Simplistic auto-detection for Node MCP servers
    if (pkgJson.scripts?.start) {
      manifest.servers = [{
        name: manifest.name,
        command: 'npm',
        args: ['start']
      }];
    }
  }

  return manifest;
}
