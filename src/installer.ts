// src/installer.ts
import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';

const BREW_ROOT = path.join(os.homedir(), '.agentbrew');
const PACKAGES_DIR = path.join(BREW_ROOT, 'packages');

export async function installPackage(url: string) {
  // Ensure directories exist
  if (!fs.existsSync(PACKAGES_DIR)) {
    fs.mkdirSync(PACKAGES_DIR, { recursive: true });
  }

  // Derive package name from URL (simple version)
  const pkgName = url.split('/').pop()?.replace('.git', '') || `pkg-${Date.now()}`;
  const targetPath = path.join(PACKAGES_DIR, pkgName);

  if (fs.existsSync(targetPath)) {
    throw new Error(`Package '${pkgName}' is already installed at ${targetPath}`);
  }

  const git = simpleGit();
  console.log(`Cloning ${url} into ${targetPath}...`);
  await git.clone(url, targetPath);
  
  // New: Post-install dependency resolution
  resolveDependencies(targetPath);
  
  return targetPath;
}

function resolveDependencies(pkgPath: string) {
  console.log(`Resolving dependencies in ${pkgPath}...`);
  if (fs.existsSync(path.join(pkgPath, 'pnpm-lock.yaml'))) {
    execSync('pnpm install', { cwd: pkgPath, stdio: 'inherit' });
  } else if (fs.existsSync(path.join(pkgPath, 'package.json'))) {
    execSync('npm install', { cwd: pkgPath, stdio: 'inherit' });
    const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgPath, 'package.json'), 'utf-8'));
    if (pkgJson.scripts?.build) {
        console.log("Running build script...");
        execSync('npm run build', { cwd: pkgPath, stdio: 'inherit' });
    }
  } else if (fs.existsSync(path.join(pkgPath, 'requirements.txt'))) {
    execSync('pip install -r requirements.txt', { cwd: pkgPath, stdio: 'inherit' });
  }
}
