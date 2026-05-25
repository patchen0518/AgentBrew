// tests/installer.test.ts
import { installPackage } from '../src/installer';
import { exec } from 'child_process';
import simpleGit from 'simple-git';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

jest.mock('child_process');
jest.mock('simple-git');
jest.mock('fs', () => {
    const actualFs = jest.requireActual('fs');
    return {
        ...actualFs,
        existsSync: jest.fn(),
        promises: {
            ...actualFs.promises,
            readFile: jest.fn(),
            mkdir: jest.fn().mockResolvedValue(undefined),
            rm: jest.fn().mockResolvedValue(undefined),
        }
    };
});

function getExpectedPath(url: string) {
    const urlHash = crypto.createHash('sha256').update(url).digest('hex').substring(0, 8);
    const repoName = url.split('/').pop()?.replace('.git', '') || 'pkg';
    const pkgDirName = `${repoName}-${urlHash}`;
    const brewRoot = path.join(process.env.HOME || '', '.agentbrew');
    return path.join(brewRoot, 'packages', pkgDirName);
}

describe('Installer', () => {
  let mockClone: jest.Mock;
  let mockExec: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClone = jest.fn().mockResolvedValue(undefined);
    (simpleGit as jest.Mock).mockReturnValue({
      clone: mockClone,
    });
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    
    mockExec = exec as unknown as jest.Mock;
    mockExec.mockImplementation((cmd, opts, callback) => {
        if (typeof opts === 'function') {
            opts(null, { stdout: '', stderr: '' });
        } else if (callback) {
            callback(null, { stdout: '', stderr: '' });
        }
    });
  });

  test('calls npm install and build when package.json exists', async () => {
    const url = 'https://github.com/user/repo.git';
    const targetPath = getExpectedPath(url);

    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p === targetPath) return false;
        if (p.endsWith('packages')) return true;
        if (p.endsWith('package.json')) return true;
        return false;
    });

    (fs.promises.readFile as jest.Mock).mockResolvedValue(JSON.stringify({
        scripts: { build: 'tsc' }
    }));

    await installPackage(url);

    expect(mockClone).toHaveBeenCalledWith(url, targetPath);
    expect(mockExec).toHaveBeenCalledWith('npm install', expect.objectContaining({ cwd: targetPath }), expect.any(Function));
    expect(mockExec).toHaveBeenCalledWith('npm run build', expect.objectContaining({ cwd: targetPath }), expect.any(Function));
  });

  test('calls pnpm install and pnpm run build when pnpm-lock.yaml and package.json with build exist', async () => {
    const url = 'https://github.com/user/pnpmrepo.git';
    const targetPath = getExpectedPath(url);

    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p === targetPath) return false;
        if (p.endsWith('packages')) return true;
        if (p.endsWith('pnpm-lock.yaml')) return true;
        if (p.endsWith('package.json')) return true;
        return false;
    });

    (fs.promises.readFile as jest.Mock).mockResolvedValue(JSON.stringify({
        scripts: { build: 'vite build' }
    }));

    await installPackage(url);

    expect(mockClone).toHaveBeenCalledWith(url, targetPath);
    expect(mockExec).toHaveBeenCalledWith('pnpm install', expect.objectContaining({ cwd: targetPath }), expect.any(Function));
    expect(mockExec).toHaveBeenCalledWith('pnpm run build', expect.objectContaining({ cwd: targetPath }), expect.any(Function));
  });

  test('sets up venv and calls local pip when requirements.txt exists', async () => {
    const url = 'https://github.com/user/pyrepo.git';
    const targetPath = getExpectedPath(url);

    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p === targetPath) return false;
        if (p.endsWith('packages')) return true;
        if (p.endsWith('requirements.txt')) return true;
        return false;
    });

    await installPackage(url);

    expect(mockClone).toHaveBeenCalledWith(url, targetPath);
    expect(mockExec).toHaveBeenCalledWith('python3 -m venv .venv', expect.objectContaining({ cwd: targetPath }), expect.any(Function));
    
    expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('pip install -r requirements.txt'), expect.objectContaining({ cwd: targetPath }), expect.any(Function));
  });

  test('cleans up target directory on failure', async () => {
    const url = 'https://github.com/user/failrepo.git';
    const targetPath = getExpectedPath(url);

    let failRepoExists = false;
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p === targetPath) return failRepoExists;
        if (p.endsWith('packages')) return true;
        return false;
    });

    mockClone.mockImplementation(() => {
        failRepoExists = true;
        return Promise.reject(new Error('Clone failed'));
    });

    await expect(installPackage(url)).rejects.toThrow('Clone failed');

    expect(fs.promises.rm).toHaveBeenCalledWith(targetPath, expect.objectContaining({ recursive: true }));
  });
});
