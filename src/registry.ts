import fs from 'fs';
import path from 'path';
import os from 'os';
import * as toml from 'smol-toml';
import { isPackageEnabled } from './state';

const BREW_ROOT = path.join(os.homedir(), '.agentbrew');
const PACKAGES_DIR = path.join(BREW_ROOT, 'packages');


export interface PackageManifest {
  name: string;
  version: string;
  description?: string;
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
  isEnabled: boolean;
}

export function discoverPackages(includeDisabled = false): PackageInfo[] {
  if (!fs.existsSync(PACKAGES_DIR)) return [];

  const packages: PackageInfo[] = [];
  const rootDirs = fs.readdirSync(PACKAGES_DIR);
  

  for (const rootDir of rootDirs) {
    const rootPath = path.join(PACKAGES_DIR, rootDir);
    try {
        if (!fs.statSync(rootPath).isDirectory()) continue;
    } catch (e) {
        console.error(`statSync failed for ${rootPath}:`, e);
        continue;
    }

    // Recursive search up to 2 levels
    const manifests = findManifests(rootPath, 2);
    for (const manifestInfo of manifests) {
        const isEnabled = isPackageEnabled(manifestInfo.manifest.name);
        if (isEnabled || includeDisabled) {
            packages.push({ path: manifestInfo.path, manifest: manifestInfo.manifest, isEnabled });
        }
    }
  }

  return packages;
}

function findManifests(currentPath: string, depth: number): { path: string, manifest: PackageManifest }[] {
    const results: { path: string, manifest: PackageManifest }[] = [];
    
    // Check current dir
    const manifestPath = path.join(currentPath, 'agentbrew.toml');
    const packageJsonPath = path.join(currentPath, 'package.json');
    const requirementsPath = path.join(currentPath, 'requirements.txt');
    
    

    if (fs.existsSync(manifestPath)) {
        try {
            const content = fs.readFileSync(manifestPath, 'utf-8');
            results.push({ path: currentPath, manifest: toml.parse(content) as any });
        } catch (e) {
            console.error(`Failed to parse ${manifestPath}:`, e);
        }
    } else {
        const manifest = autoDetectManifest(currentPath);
        // Only include auto-detected if it found something useful (servers or prompts)
        if (fs.existsSync(packageJsonPath) || fs.existsSync(requirementsPath) || (manifest.prompts && manifest.prompts.length > 0)) {
            results.push({ path: currentPath, manifest });
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
        
        // Improved auto-detection for bin entries
        if (pkgJson.bin) {
            const binName = typeof pkgJson.bin === 'string' ? manifest.name : Object.keys(pkgJson.bin)[0];
            const binPath = typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin[binName];
            manifest.servers = [{
                name: binName,
                command: 'node',
                args: [binPath]
            }];
        } else if (pkgJson.scripts?.start) {
            manifest.servers = [{
                name: manifest.name,
                command: 'npm',
                args: ['start']
            }];
        }
    } catch (e) {
        console.error(`Failed to parse ${packageJsonPath}:`, e);
    }
  }

  // Detect Python projects
  const requirementsPath = path.join(pkgPath, 'requirements.txt');
  if (fs.existsSync(requirementsPath)) {
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

    manifest.servers.push({
      name: `${manifest.name}-python`,
      command: pythonCmd,
      args: ['main.py'] // Guessing entry point
    });
  }

  // Detect Markdown skills
  try {
    const files = fs.readdirSync(pkgPath);
    const mdFiles = files.filter((f: string) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md');
    if (mdFiles.length > 0) {
        manifest.prompts = manifest.prompts || [];
        for (const file of mdFiles) {
        manifest.prompts.push({
            name: path.parse(file).name,
            file: file,
            description: `Markdown skill: ${file}`
        });
        }
    }
  } catch (e) {
      // Ignore
  }

  return manifest;
}
