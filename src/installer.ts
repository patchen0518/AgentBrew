import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const readFileAsync = fs.promises.readFile;
const mkdirAsync = fs.promises.mkdir;
const rmAsync = fs.promises.rm;

const BREW_ROOT = process.env.AGENTBREW_ROOT || path.join(os.homedir(), '.agentbrew');
const PACKAGES_DIR = path.join(BREW_ROOT, 'packages');

export async function installPackage(url: string) {
  // Ensure directories exist
  if (!fs.existsSync(PACKAGES_DIR)) {
    await mkdirAsync(PACKAGES_DIR, { recursive: true });
  }

  // Derive package name from URL (simple version)
  const pkgName = url.split('/').pop()?.replace('.git', '') || `pkg-${Date.now()}`;
  const targetPath = path.join(PACKAGES_DIR, pkgName);

  if (fs.existsSync(targetPath)) {
    throw new Error(`Package '${pkgName}' is already installed at ${targetPath}`);
  }

  const git = simpleGit();
  try {
    console.log(`Cloning ${url} into ${targetPath}...`);
    await git.clone(url, targetPath);
    
    // Post-install dependency resolution
    await resolveDependencies(targetPath);
    
    return targetPath;
  } catch (error) {
    console.error(`Installation failed for ${url}:`, error);
    if (fs.existsSync(targetPath)) {
      console.log(`Cleaning up ${targetPath}...`);
      await rmAsync(targetPath, { recursive: true, force: true });
    }
    throw error;
  }
}

async function resolveDependencies(pkgPath: string) {
  console.log(`Resolving dependencies in ${pkgPath}...`);
  
  const packageJsonPath = path.join(pkgPath, 'package.json');
  const pnpmLockPath = path.join(pkgPath, 'pnpm-lock.yaml');
  const requirementsPath = path.join(pkgPath, 'requirements.txt');

  let packageManager: 'npm' | 'pnpm' | null = null;

  if (fs.existsSync(pnpmLockPath)) {
    packageManager = 'pnpm';
  } else if (fs.existsSync(packageJsonPath)) {
    packageManager = 'npm';
  }

  const execOpts = { cwd: pkgPath, maxBuffer: 1024 * 1024 * 50 };

  if (packageManager) {
    console.log(`Installing JS dependencies with ${packageManager}...`);
    await execAsync(`${packageManager} install`, execOpts);

    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkgJson = JSON.parse(await readFileAsync(packageJsonPath, 'utf-8'));
        if (pkgJson.scripts?.build) {
          console.log(`Running build script with ${packageManager}...`);
          await execAsync(`${packageManager} run build`, execOpts);
        }
      } catch (e) {
        console.error(`Failed to parse or run build script for ${packageJsonPath}:`, e);
        throw e;
      }
    }
  } else if (fs.existsSync(requirementsPath)) {
    console.log("Setting up Python virtual environment...");
    const venvDir = '.venv';
    await execAsync(`python3 -m venv ${venvDir}`, execOpts);
    
    const pipPath = process.platform === 'win32' 
      ? path.join(venvDir, 'Scripts', 'pip') 
      : path.join(venvDir, 'bin', 'pip');
      
    console.log("Installing Python dependencies...");
    await execAsync(`${pipPath} install -r requirements.txt`, execOpts);
  }
}
