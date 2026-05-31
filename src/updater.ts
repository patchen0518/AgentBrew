import path from 'path';
import fs from 'fs';
import simpleGit from 'simple-git';
import { getPackagesDir } from './config';
import { Logger } from './logger';
import { resolveDependencies } from './installer';
import { findManifests, generateMcpManifest, warnIfDiscoveryFailed } from './registry';

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
  
  const remotes = await git.getRemotes();
  if (remotes.length === 0) {
    Logger.info(`Skipping '${packageName}': No remotes configured.`);
    return false;
  }

  Logger.info(`Checking for updates for '${packageName}'...`);
  await git.fetch();
  
  const status = await git.status();
  const hasModifiedTrackedFiles = 
    (status.modified && status.modified.length > 0) || 
    (status.deleted && status.deleted.length > 0) || 
    (status.staged && status.staged.length > 0);

  if (hasModifiedTrackedFiles) {
    throw new Error('Local changes detected in tracked files.');
  }

  const localHead = await git.revparse(['HEAD']);
  let remoteHead: string;
  try {
    remoteHead = await git.revparse(['@{u}']);
  } catch {
    Logger.info(`Skipping '${packageName}': Branch has no upstream tracking configured.`);
    return false;
  }

  if (localHead === remoteHead) {
    Logger.info(`Package '${packageName}' is already up to date.`);
    return false;
  }

  Logger.info(`Updating '${packageName}'...`);
  try {
    await git.pull(['--ff-only']);
  } catch (error) {
    throw new Error('Branches have diverged. Manual intervention required.');
  }
  
  // Re-provision
  await resolveDependencies(pkgPath);
  const manifests = findManifests(pkgPath, 2);
  for (const m of manifests) {
    const cache = await generateMcpManifest(m.path, m.manifest);
    warnIfDiscoveryFailed(m.manifest, cache);
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
