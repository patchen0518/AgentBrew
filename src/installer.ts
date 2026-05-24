// src/installer.ts
import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs';
import os from 'os';

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
  
  return targetPath;
}
