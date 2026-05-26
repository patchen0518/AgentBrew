import path from 'path';
import fs from 'fs';
import simpleGit from 'simple-git';
import { getPackagesDir } from './config';
import { Logger } from './logger';
import { resolveDependencies } from './installer';
import { findManifests, generateMcpManifest } from './registry';

export async function updatePackage(packageName: string): Promise<boolean> {
  const packagesDir = getPackagesDir();
  const pkgPath = path.join(packagesDir, packageName);

  if (!fs.existsSync(pkgPath)) {
    throw new Error(`Package '${packageName}' not found at ${pkgPath}`);
  }

  if (!fs.existsSync(path.join(pkgPath, '.git'))) {
    Logger.info(`Skipping '${packageName}': Not a Git-managed package.`);
    return false;
  }

  const git = simpleGit(pkgPath);
  
  Logger.info(`Checking for updates for '${packageName}'...`);
  await git.fetch();
  
  const status = await git.status();
  if (!status.isClean()) {
    throw new Error(`'${packageName}' has local changes. Commit or stash them first.`);
  }

  const localHead = await git.revparse(['HEAD']);
  const remoteHead = await git.revparse(['@{u}']);

  if (localHead === remoteHead) {
    Logger.info(`Package '${packageName}' is already up to date.`);
    return false;
  }

  Logger.info(`Updating '${packageName}'...`);
  await git.pull(['--ff-only']);
  
  // Re-provision
  await resolveDependencies(pkgPath);
  const manifests = findManifests(pkgPath, 2);
  for (const m of manifests) {
    await generateMcpManifest(m.path, m.manifest);
  }

  Logger.info(`Successfully updated '${packageName}'.`);
  return true;
}

export async function updateAllPackages(): Promise<void> {
  const packagesDir = getPackagesDir();
  if (!fs.existsSync(packagesDir)) return;

  const dirs = fs.readdirSync(packagesDir);
  for (const dir of dirs) {
    try {
      await updatePackage(dir);
    } catch (e: any) {
      Logger.error(`Failed to update '${dir}': ${e.message}`);
    }
  }
}
