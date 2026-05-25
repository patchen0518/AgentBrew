import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

import { Logger } from './logger';

const execAsync = promisify(exec);
const readFileAsync = fs.promises.readFile;
const mkdirAsync = fs.promises.mkdir;
const rmAsync = fs.promises.rm;

const BREW_ROOT = process.env.AGENTBREW_ROOT || path.join(os.homedir(), '.agentbrew');
const PACKAGES_DIR = path.join(BREW_ROOT, 'packages');
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

export async function installPackage(url: string) {
  validateUrl(url);
  const safeLogUrl = redactUrl(url);

  // Ensure directories exist
  if (!fs.existsSync(PACKAGES_DIR)) {
    await mkdirAsync(PACKAGES_DIR, { recursive: true });
  }

  // Generate a unique name based on the URL to avoid collisions
  const urlHash = crypto.createHash('sha256').update(url).digest('hex').substring(0, 8);
  const repoName = url.split('/').pop()?.replace('.git', '') || 'pkg';
  const pkgDirName = `${repoName}-${urlHash}`;
  const targetPath = path.join(PACKAGES_DIR, pkgDirName);

  if (fs.existsSync(targetPath)) {
    throw new Error(`Package from '${safeLogUrl}' is already installed at ${targetPath}`);
  }

  const git = simpleGit();
  try {
    Logger.info(`Cloning ${safeLogUrl} into ${targetPath}...`);
    await git.clone(url, targetPath);
    
    // Post-install dependency resolution
    await resolveDependencies(targetPath);
    
    return targetPath;
  } catch (error) {
    Logger.error(`Installation failed for ${safeLogUrl}:`, error);
    if (fs.existsSync(targetPath)) {
      Logger.info(`Cleaning up ${targetPath}...`);
      await rmAsync(targetPath, { recursive: true, force: true });
    }
    throw error;
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
    Logger.info("Setting up Python virtual environment...");
    const venvDir = '.venv';
    await execAsync(`python3 -m venv ${venvDir}`, execOpts);
    
    const pipPath = process.platform === 'win32' 
      ? path.join(venvDir, 'Scripts', 'pip') 
      : path.join(venvDir, 'bin', 'pip');
      
    Logger.info("Installing Python dependencies...");
    await execAsync(`${pipPath} install -r requirements.txt`, execOpts);
  }
}
