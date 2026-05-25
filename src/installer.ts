import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as toml from 'smol-toml';

import { Logger } from './logger';
import { PackageManifest, generateMcpManifest, findManifests } from './registry';
import { getPackagesDir } from './config';

const execAsync = promisify(exec);
const readFileAsync = fs.promises.readFile;
const writeFileAsync = fs.promises.writeFile;
const mkdirAsync = fs.promises.mkdir;
const rmAsync = fs.promises.rm;
const INSTALL_TIMEOUT = 300000; // 5 minutes

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '****';
    }
    return parsed.toString();
  } catch {
    // If not a standard URL, use regex as fallback
    return url.replace(/([^:]+):([^@]+)@/, '$1:****@');
  }
}

/**
 * Sanitizes Git URLs by removing prefixes like 'git+' and fragments.
 */
function sanitizeGitUrl(url: string): string {
  let sanitized = url.trim();
  
  // Remove git+ prefix (common in package.json)
  if (sanitized.startsWith('git+')) {
    sanitized = sanitized.substring(4);
  }
  
  // Remove .git suffix for consistency if it's a standard URL
  if (sanitized.endsWith('.git')) {
    sanitized = sanitized.substring(0, sanitized.length - 4);
  }

  // Remove fragments (e.g., #main)
  const fragmentIndex = sanitized.indexOf('#');
  if (fragmentIndex !== -1) {
    sanitized = sanitized.substring(0, fragmentIndex);
  }

  return sanitized;
}

function validateUrl(url: string) {
  if (url.trim().startsWith('-')) {
    throw new Error("Invalid Git URL: URL cannot start with a dash.");
  }
  // Basic protocol check
  const allowedProtocols = ['https:', 'git:', 'ssh:', 'http:'];
  try {
    const parsed = new URL(url);
    if (!allowedProtocols.includes(parsed.protocol)) {
       // Check if it's an scp-like ssh syntax (e.g. user@host:path)
       if (!url.includes('@') || !url.includes(':')) {
         throw new Error(`Invalid protocol: ${parsed.protocol}`);
       }
    }
  } catch (e) {
    // If URL parsing fails, check if it's a valid SSH shortcut
    if (!url.includes('@') || !url.includes(':')) {
        throw new Error("Invalid Git URL format.");
    }
  }
}

function validateName(name: string, context: string) {
  if (name.includes('__')) {
    throw new Error(
      `Invalid ${context} name: '${name}'.\n` +
      `The sequence '__' is reserved as a routing delimiter by AgentBrew.\n` +
      `Please rename the ${context} to proceed.`
    );
  }
}

export async function installPackage(url: string) {
  const sanitizedUrl = sanitizeGitUrl(url);
  validateUrl(sanitizedUrl);
  const safeLogUrl = redactUrl(sanitizedUrl);

  // Ensure directories exist
  const packagesDir = getPackagesDir();
  if (!fs.existsSync(packagesDir)) {
    await mkdirAsync(packagesDir, { recursive: true });
  }

  // Enforce strict uniqueness: use the repo name as the directory name
  const repoName = sanitizedUrl.split('/').pop()?.split(':').pop()?.replace('.git', '') || 'pkg';
  validateName(repoName, 'package');
  const targetPath = path.join(packagesDir, repoName);

  if (fs.existsSync(targetPath)) {
    throw new Error(`Package '${repoName}' is already installed at ${targetPath}. Uninstall it first to install a different version.`);
  }

  const git = simpleGit().env({ ...process.env, GIT_TERMINAL_PROMPT: '0' });
  try {
    Logger.info(`Cloning ${safeLogUrl} into ${targetPath}...`);
    await git.clone(sanitizedUrl, targetPath);
    
    // Post-install dependency resolution
    await resolveDependencies(targetPath);

    // Generate discovery cache
    const manifests = findManifests(targetPath, 2);
    for (const m of manifests) {
        // Validate names in the manifest
        if (m.manifest.servers) {
            for (const srv of m.manifest.servers) {
                validateName(srv.name, 'server');
            }
        }
        if (m.manifest.prompts) {
            for (const prompt of m.manifest.prompts) {
                validateName(prompt.name, 'prompt');
            }
        }
        await generateMcpManifest(m.path, m.manifest);
    }
    
    return targetPath;
  } catch (error: any) {
    let finalError = error;
    
    // Provide a clearer message for authentication failures (common in private repos)
    const errorMsg = error.message || '';
    if (errorMsg.includes('Authentication failed') || errorMsg.includes('could not read Username') || errorMsg.includes('Permission denied (publickey)')) {
      finalError = new Error(
        `Authentication failed for private repository: ${safeLogUrl}\n` +
        `Suggestions:\n` +
        `  - If using SSH, ensure your keys are added (ssh-add -l).\n` +
        `  - If using HTTPS, ensure you have a credential helper configured or provide a token.\n` +
        `  - Git terminal prompts are disabled to prevent hanging.`
      );
    }

    Logger.error(`Installation failed for ${safeLogUrl}:`, finalError.message);
    if (fs.existsSync(targetPath)) {
      Logger.info(`Cleaning up ${targetPath}...`);
      await rmAsync(targetPath, { recursive: true, force: true });
    }
    throw finalError;
  }
}

async function resolveDependencies(pkgPath: string) {
  Logger.info(`Resolving dependencies in ${pkgPath}...`);
  
  const packageJsonPath = path.join(pkgPath, 'package.json');
  const pnpmLockPath = path.join(pkgPath, 'pnpm-lock.yaml');
  const requirementsPath = path.join(pkgPath, 'requirements.txt');

  let packageManager: 'npm' | 'pnpm' | null = null;

  if (fs.existsSync(pnpmLockPath)) {
    packageManager = 'pnpm';
  } else if (fs.existsSync(packageJsonPath)) {
    packageManager = 'npm';
  }

  const execOpts = { cwd: pkgPath, maxBuffer: 1024 * 1024 * 50, timeout: INSTALL_TIMEOUT };

  if (packageManager) {
    Logger.info(`Installing JS dependencies with ${packageManager}...`);
    await execAsync(`${packageManager} install`, execOpts);

    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkgJson = JSON.parse(await readFileAsync(packageJsonPath, 'utf-8'));
        if (pkgJson.scripts?.build) {
          Logger.info(`Running build script with ${packageManager}...`);
          await execAsync(`${packageManager} run build`, execOpts);
        }
      } catch (e) {
        Logger.error(`Failed to parse or run build script for ${packageJsonPath}:`, e);
        throw e;
      }
    }
  } else if (fs.existsSync(requirementsPath)) {
    const venvDir = '.venv';
    let hasUv = false;
    try {
      await execAsync('uv --version', { timeout: 2000 });
      hasUv = true;
    } catch (e) {
      // uv not found, will fall back to standard venv
    }

    if (hasUv) {
      Logger.info("Setting up Python virtual environment with uv...");
      await execAsync(`uv venv ${venvDir}`, execOpts);
      Logger.info("Installing Python dependencies with uv...");
      await execAsync(`uv pip install -r requirements.txt`, execOpts);
    } else {
      Logger.info("Setting up Python virtual environment...");
      await execAsync(`python3 -m venv ${venvDir}`, execOpts);
      
      const pipPath = process.platform === 'win32' 
        ? path.join(venvDir, 'Scripts', 'pip') 
        : path.join(venvDir, 'bin', 'pip');
        
      Logger.info("Installing Python dependencies...");
      await execAsync(`${pipPath} install -r requirements.txt`, execOpts);
    }
  }
}

export async function createLinkPackage(name: string, command: string, args: string[], env?: Record<string, string>) {
  validateName(name, 'package');
  // Basic validation to prevent path traversal
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new Error("Invalid package name: name cannot contain path traversal characters.");
  }

  // Ensure PACKAGES_DIR exists
  const packagesDir = getPackagesDir();
  if (!fs.existsSync(packagesDir)) {
    await mkdirAsync(packagesDir, { recursive: true });
  }

  // Enforce strict uniqueness: use the name as the directory name
  const pkgDirName = `linked-${name}`;
  const targetPath = path.join(packagesDir, pkgDirName);

  if (fs.existsSync(targetPath)) {
    throw new Error(`Linked package '${name}' is already installed at ${targetPath}`);
  }

  await mkdirAsync(targetPath, { recursive: true });

  const manifest: PackageManifest = {
    name: `linked-${name}`,
    version: "1.0.0",
    description: "Linked server migrated to AgentBrew",
    servers: [
      {
        name,
        command,
        args,
        description: `Linked server: ${name}`,
        env: env && Object.keys(env).length > 0 ? env : undefined
      }
    ]
  };

  await writeFileAsync(path.join(targetPath, 'agentbrew.toml'), toml.stringify(manifest as any), 'utf-8');

  // Generate discovery cache
  await generateMcpManifest(targetPath, manifest);

  return targetPath;
}
