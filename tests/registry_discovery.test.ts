// tests/registry_discovery.test.ts
import { discoverPackages } from '../src/registry';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { isPackageEnabled } from '../src/state';

jest.mock('../src/state');
jest.mock('fs', () => {
    const actualFs = jest.requireActual('fs');
    return {
        ...actualFs,
        existsSync: jest.fn(),
        readdirSync: jest.fn(),
        readFileSync: jest.fn(),
        statSync: jest.fn(),
    };
});

describe('Registry Discovery', () => {
  const PACKAGES_DIR = path.join(os.homedir(), '.agentbrew', 'packages');
  console.log(`TEST PACKAGES_DIR: ${PACKAGES_DIR}`);

  beforeEach(() => {
    jest.clearAllMocks();
    (isPackageEnabled as jest.Mock).mockReturnValue(true);
  });

  test('discovers packages recursively up to 2 levels', () => {
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
      if (p === PACKAGES_DIR) return true;
      if (p.includes('agentbrew.toml')) return true;
      if (p.includes('package.json')) return false;
      return true;
    });

    (fs.readdirSync as jest.Mock).mockImplementation((p: string) => {
      if (p === PACKAGES_DIR) return ['monorepo'];
      if (p.endsWith('monorepo')) return ['pkg1', 'pkg2'];
      return [];
    });

    (fs.statSync as jest.Mock).mockImplementation((p: string) => ({
      isDirectory: () => !path.basename(p).includes('.') || path.basename(p) === '.agentbrew' || path.basename(p) === '.venv'
    }));

    (fs.readFileSync as jest.Mock).mockReturnValue('name = "test-pkg"\nversion = "1.0.0"');

    const packages = discoverPackages();
    // monorepo (if it had agentbrew.toml) + pkg1 + pkg2
    // Actually findManifests is called on monorepo with depth 2.
    // monorepo: depth 2. results.push(monorepo)
    //   monorepo/pkg1: depth 1. results.push(pkg1)
    //   monorepo/pkg2: depth 1. results.push(pkg2)
    expect(packages.length).toBe(3);
  });

  test('autoDetectManifest handles bin entries', () => {
    const pkgPath = path.join(PACKAGES_DIR, 'node-pkg');
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p === PACKAGES_DIR) return true;
        if (p === pkgPath) return true;
        if (p === path.join(pkgPath, 'agentbrew.toml')) return false;
        if (p === path.join(pkgPath, 'package.json')) return true;
        return false;
    });
    (fs.readdirSync as jest.Mock).mockImplementation((p: string) => {
        if (p === PACKAGES_DIR) return ['node-pkg'];
        return [];
    });
    (fs.statSync as jest.Mock).mockImplementation((p: string) => ({
        isDirectory: () => !path.basename(p).includes('.') || path.basename(p) === '.agentbrew' || path.basename(p) === '.venv'
    }));
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({
        name: 'node-pkg',
        bin: { 'node-pkg-cli': 'dist/cli.js' }
    }));

    const packages = discoverPackages();
    expect(packages.length).toBe(1);
    expect(packages[0].manifest.servers).toBeDefined();
    expect(packages[0].manifest.servers![0].command).toBe('node');
    expect(packages[0].manifest.servers![0].args).toContain('dist/cli.js');
  });

  test('autoDetectManifest handles Python venv', () => {
    const pkgPath = path.join(PACKAGES_DIR, 'py-pkg');
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p === PACKAGES_DIR) return true;
        if (p === pkgPath) return true;
        if (p.includes('requirements.txt')) return true;
        if (p.includes('.venv')) return true;
        if (p.includes('python3') || p.includes('python.exe')) return true;
        return false;
    });
    (fs.readdirSync as jest.Mock).mockImplementation((p: string) => {
        if (p === PACKAGES_DIR) return ['py-pkg'];
        return [];
    });
    (fs.statSync as jest.Mock).mockImplementation((p: string) => ({
        isDirectory: () => !path.basename(p).includes('.') || path.basename(p) === '.agentbrew' || path.basename(p) === '.venv'
    }));

    const packages = discoverPackages();
    expect(packages.length).toBe(1);
    const server = packages[0].manifest.servers![0];
    expect(server.command).toContain('.venv');
    if (process.platform === 'win32') {
        expect(server.command).toContain('Scripts');
    } else {
        expect(server.command).toContain('bin');
    }
  });
});
