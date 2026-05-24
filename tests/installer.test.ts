// tests/installer.test.ts
import { installPackage } from '../src/installer';
import { execSync } from 'child_process';
import simpleGit from 'simple-git';
import fs from 'fs';
import path from 'path';

jest.mock('child_process');
jest.mock('simple-git');
jest.mock('fs', () => {
    const actualFs = jest.requireActual('fs');
    return {
        ...actualFs,
        existsSync: jest.fn(),
        readFileSync: jest.fn(),
        mkdirSync: jest.fn(),
    };
});

describe('Installer', () => {
  let mockClone: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClone = jest.fn().mockResolvedValue(undefined);
    (simpleGit as jest.Mock).mockReturnValue({
      clone: mockClone,
    });
    (fs.existsSync as jest.Mock).mockReturnValue(false);
  });

  test('calls npm install and build when package.json exists', async () => {
    const url = 'https://github.com/user/repo.git';
    const pkgName = 'repo';
    const targetPath = path.join(process.env.HOME || '', '.agentbrew', 'packages', pkgName);

    // Mock fs to simulate package.json existence
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p.endsWith('repo')) return false; // Package not yet installed
        if (p.endsWith('packages')) return true;
        if (p.endsWith('package.json')) return true;
        return false;
    });

    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({
        scripts: { build: 'tsc' }
    }));

    await installPackage(url);

    expect(mockClone).toHaveBeenCalledWith(url, targetPath);
    expect(execSync).toHaveBeenCalledWith('npm install', expect.objectContaining({ cwd: targetPath }));
    expect(execSync).toHaveBeenCalledWith('npm run build', expect.objectContaining({ cwd: targetPath }));
  });

  test('calls pip install when requirements.txt exists', async () => {
    const url = 'https://github.com/user/pyrepo.git';
    const pkgName = 'pyrepo';
    const targetPath = path.join(process.env.HOME || '', '.agentbrew', 'packages', pkgName);

    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p.endsWith('pyrepo')) return false;
        if (p.endsWith('packages')) return true;
        if (p.endsWith('requirements.txt')) return true;
        return false;
    });

    await installPackage(url);

    expect(mockClone).toHaveBeenCalledWith(url, targetPath);
    expect(execSync).toHaveBeenCalledWith('pip install -r requirements.txt', expect.objectContaining({ cwd: targetPath }));
  });

  test('calls pnpm install when pnpm-lock.yaml exists', async () => {
    const url = 'https://github.com/user/pnpmrepo.git';
    const pkgName = 'pnpmrepo';
    const targetPath = path.join(process.env.HOME || '', '.agentbrew', 'packages', pkgName);

    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p.endsWith('pnpmrepo')) return false;
        if (p.endsWith('packages')) return true;
        if (p.endsWith('pnpm-lock.yaml')) return true;
        return false;
    });

    await installPackage(url);

    expect(mockClone).toHaveBeenCalledWith(url, targetPath);
    expect(execSync).toHaveBeenCalledWith('pnpm install', expect.objectContaining({ cwd: targetPath }));
  });
});
