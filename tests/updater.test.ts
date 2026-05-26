import path from 'path';
import fs from 'fs';
import { updatePackage, updateAllPackages } from '../src/updater';
import { Logger } from '../src/logger';
import * as config from '../src/config';
import * as installer from '../src/installer';
import * as registry from '../src/registry';
import simpleGit from 'simple-git';

jest.mock('../src/logger');
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    rm: jest.fn(),
  },
}));
jest.mock('../src/config');
jest.mock('../src/installer');
jest.mock('../src/registry');
jest.mock('simple-git');

describe('updater', () => {
  const mockPackagesDir = '/mock/packages';
  let mockGit: any;

  beforeEach(() => {
    jest.clearAllMocks();
    (config.getPackagesDir as jest.Mock).mockReturnValue(mockPackagesDir);
    mockGit = {
      fetch: jest.fn().mockResolvedValue({}),
      status: jest.fn().mockResolvedValue({ isClean: () => true }),
      revparse: jest.fn(),
      pull: jest.fn().mockResolvedValue({}),
    };
    (simpleGit as jest.Mock).mockReturnValue(mockGit);
  });

  it('should fail if package does not exist', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    await expect(updatePackage('non-existent')).rejects.toThrow("Package 'non-existent' not found");
  });

  it('should skip if not a git repo', async () => {
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
      if (p === path.join(mockPackagesDir, 'linked-pkg')) return true;
      if (p === path.join(mockPackagesDir, 'linked-pkg', '.git')) return false;
      return false;
    });

    const result = await updatePackage('linked-pkg');
    expect(result).toBe(false);
    expect(Logger.info).toHaveBeenCalledWith(expect.stringContaining("Not a Git-managed package"));
  });

  it('should fail if repo is not clean', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    mockGit.status.mockResolvedValue({ isClean: () => false });

    await expect(updatePackage('dirty-pkg')).rejects.toThrow("'dirty-pkg' has local changes");
  });

  it('should skip if already up to date', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    mockGit.revparse.mockImplementation((args: string[]) => {
      if (args.includes('HEAD')) return Promise.resolve('hash1');
      if (args.includes('@{u}')) return Promise.resolve('hash1');
      return Promise.resolve('');
    });

    const result = await updatePackage('up-to-date-pkg');
    expect(result).toBe(false);
    expect(Logger.info).toHaveBeenCalledWith(expect.stringContaining("already up to date"));
  });

  it('should update and re-provision if updates available', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    mockGit.revparse.mockImplementation((args: string[]) => {
      if (args.includes('HEAD')) return Promise.resolve('hash1');
      if (args.includes('@{u}')) return Promise.resolve('hash2');
      return Promise.resolve('');
    });
    (registry.findManifests as jest.Mock).mockReturnValue([
      { path: '/mock/packages/pkg/mcp.json', manifest: {} }
    ]);

    const result = await updatePackage('pkg');
    expect(result).toBe(true);
    expect(mockGit.pull).toHaveBeenCalledWith(['--ff-only']);
    expect(installer.resolveDependencies).toHaveBeenCalled();
    expect(registry.generateMcpManifest).toHaveBeenCalled();
  });

  it('updateAllPackages should iterate through directories', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readdirSync as jest.Mock).mockReturnValue(['pkg1', 'pkg2']);
    
    // mock updatePackage behavior via mockGit
    mockGit.status.mockResolvedValue({ isClean: () => true });
    mockGit.revparse.mockResolvedValue('hash');

    await updateAllPackages();
    
    expect(simpleGit).toHaveBeenCalledTimes(2);
  });
});
