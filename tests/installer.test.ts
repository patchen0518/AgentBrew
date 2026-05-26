// tests/installer.test.ts
import { installPackage, analyzePackage } from '../src/installer';
import { exec } from 'child_process';
import simpleGit from 'simple-git';
import fs from 'fs';
import path from 'path';
import * as registry from '../src/registry';

jest.mock('child_process');
jest.mock('simple-git');
jest.mock('../src/registry');
jest.mock('fs', () => {
    const actualFs = jest.requireActual('fs');
    return {
        ...actualFs,
        existsSync: jest.fn(),
        writeFileSync: jest.fn(),
        readFileSync: jest.fn(),
        promises: {
            ...actualFs.promises,
            readFile: jest.fn(),
            mkdir: jest.fn().mockResolvedValue(undefined),
            rm: jest.fn().mockResolvedValue(undefined),
        }
    };
});

function getExpectedPath(url: string) {
    const repoName = url.split('/').pop()?.replace('.git', '') || 'pkg';
    const brewRoot = path.join(process.env.HOME || '', '.agentbrew');
    return path.join(brewRoot, 'packages', repoName);
}

describe('Installer', () => {
  let mockClone: jest.Mock;
  let mockExec: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClone = jest.fn().mockResolvedValue(undefined);
    (simpleGit as jest.Mock).mockReturnValue({
      clone: mockClone,
      env: jest.fn().mockReturnThis(),
    });
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.readFileSync as jest.Mock).mockReturnValue('{}');
    
    mockExec = exec as unknown as jest.Mock;
    mockExec.mockImplementation((cmd, opts, callback) => {
        if (typeof opts === 'function') {
            opts(null, { stdout: '', stderr: '' });
        } else if (callback) {
            callback(null, { stdout: '', stderr: '' });
        }
    });

    (registry.findManifests as jest.Mock).mockReturnValue([]);
    (registry.generateMcpManifest as jest.Mock).mockResolvedValue({});
  });

  test('analyzePackage correctly extracts scripts', async () => {
    const pkgPath = '/tmp/test-pkg';
    (fs.existsSync as jest.Mock).mockImplementation((p) => p === path.join(pkgPath, 'package.json'));
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({
        scripts: {
            preinstall: 'echo pre',
            install: 'echo inst',
            postinstall: 'echo post',
            build: 'tsc',
            test: 'jest' // should be ignored
        }
    }));

    const result = await analyzePackage(pkgPath);
    expect(result.scripts).toContain('preinstall: echo pre');
    expect(result.scripts).toContain('install: echo inst');
    expect(result.scripts).toContain('postinstall: echo post');
    expect(result.scripts).toContain('build: tsc');
    expect(result.scripts).not.toContain('test: jest');
  });

  test('installPackage calls confirm callback and aborts if denied', async () => {
    const url = 'https://github.com/user/abortrepo.git';
    const targetPath = getExpectedPath(url);
    const confirm = jest.fn().mockResolvedValue(false);

    let abortRepoExists = false;
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p === targetPath) return abortRepoExists;
        if (p.endsWith('packages')) return true;
        return false;
    });

    mockClone.mockImplementation(() => {
        abortRepoExists = true;
        return Promise.resolve();
    });

    await expect(installPackage(url, confirm)).rejects.toThrow("Installation aborted by user after security review.");
    expect(confirm).toHaveBeenCalled();
    expect(fs.promises.rm).toHaveBeenCalledWith(targetPath, expect.objectContaining({ recursive: true }));
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

    (registry.findManifests as jest.Mock).mockReturnValue([
        { path: targetPath, manifest: { name: 'repo', version: '1.0.0' } }
    ]);

    await installPackage(url);

    expect(mockClone).toHaveBeenCalledWith('https://github.com/user/repo', targetPath);
    expect(mockExec).toHaveBeenCalledWith('npm install', expect.objectContaining({ cwd: targetPath }), expect.any(Function));
    expect(mockExec).toHaveBeenCalledWith('npm run build', expect.objectContaining({ cwd: targetPath }), expect.any(Function));
    expect(registry.generateMcpManifest).toHaveBeenCalled();
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

    (registry.findManifests as jest.Mock).mockReturnValue([
        { path: targetPath, manifest: { name: 'pnpmrepo', version: '1.0.0' } }
    ]);

    await installPackage(url);

    expect(mockClone).toHaveBeenCalledWith('https://github.com/user/pnpmrepo', targetPath);
    expect(mockExec).toHaveBeenCalledWith('pnpm install', expect.objectContaining({ cwd: targetPath }), expect.any(Function));
    expect(mockExec).toHaveBeenCalledWith('pnpm run build', expect.objectContaining({ cwd: targetPath }), expect.any(Function));
  });

  test('sets up venv and calls uv pip install when requirements.txt exists and uv is available', async () => {
    const url = 'https://github.com/user/pyrepo-uv.git';
    const targetPath = getExpectedPath(url);

    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p === targetPath) return false;
        if (p.endsWith('packages')) return true;
        if (p.endsWith('requirements.txt')) return true;
        return false;
    });

    await installPackage(url);

    expect(mockClone).toHaveBeenCalledWith('https://github.com/user/pyrepo-uv', targetPath);
    expect(mockExec).toHaveBeenCalledWith('uv --version', { timeout: 2000 }, expect.any(Function));
    expect(mockExec).toHaveBeenCalledWith('uv venv .venv', expect.objectContaining({ cwd: targetPath }), expect.any(Function));
    expect(mockExec).toHaveBeenCalledWith('uv pip install -r requirements.txt', expect.objectContaining({ cwd: targetPath }), expect.any(Function));
  });

  test('falls back to python3 -m venv when uv is not available', async () => {
    const url = 'https://github.com/user/pyrepo-no-uv.git';
    const targetPath = getExpectedPath(url);

    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p === targetPath) return false;
        if (p.endsWith('packages')) return true;
        if (p.endsWith('requirements.txt')) return true;
        return false;
    });

    mockExec.mockImplementation((cmd, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        if (cmd === 'uv --version') {
            cb(new Error('command not found'), { stdout: '', stderr: '' });
        } else {
            cb(null, { stdout: '', stderr: '' });
        }
    });

    await installPackage(url);

    expect(mockExec).toHaveBeenCalledWith('uv --version', { timeout: 2000 }, expect.any(Function));
    expect(mockExec).toHaveBeenCalledWith('python3 -m venv .venv', expect.objectContaining({ cwd: targetPath }), expect.any(Function));
    expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('pip install -r requirements.txt'), expect.objectContaining({ cwd: targetPath }), expect.any(Function));
  });

  test('calls poetry install when poetry.lock exists', async () => {
    const url = 'https://github.com/user/poetry-repo.git';
    const targetPath = getExpectedPath(url);

    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p === targetPath) return false;
        if (p.endsWith('packages')) return true;
        if (p.endsWith('poetry.lock')) return true;
        return false;
    });

    await installPackage(url);

    expect(mockExec).toHaveBeenCalledWith('poetry --version', expect.any(Function));
    expect(mockExec).toHaveBeenCalledWith('poetry install', expect.objectContaining({ cwd: targetPath }), expect.any(Function));
  });

  test('calls uv sync when uv.lock exists', async () => {
    const url = 'https://github.com/user/uv-repo.git';
    const targetPath = getExpectedPath(url);

    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p === targetPath) return false;
        if (p.endsWith('packages')) return true;
        if (p.endsWith('uv.lock')) return true;
        return false;
    });

    await installPackage(url);

    expect(mockExec).toHaveBeenCalledWith('uv --version', expect.any(Function));
    expect(mockExec).toHaveBeenCalledWith('uv sync', expect.objectContaining({ cwd: targetPath }), expect.any(Function));
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

  test('provides helpful error message on authentication failure', async () => {
    const url = 'git@github.com:private/repo.git';
    const targetPath = getExpectedPath(url);

    mockClone.mockRejectedValue(new Error('Permission denied (publickey). fatal: Could not read from remote repository.'));

    await expect(installPackage(url)).rejects.toThrow(/Authentication failed for private repository/);
    await expect(installPackage(url)).rejects.toThrow(/ssh-add -l/);
  });
});
