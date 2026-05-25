import fs from 'fs';
import path from 'path';
import os from 'os';
import { discoverPackages } from '../src/registry';

// Mock fs and path for registry discovery
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

describe('Registry Discovery Merging', () => {
  const BREW_ROOT = process.env.AGENTBREW_ROOT || path.join(os.homedir(), '.agentbrew');
  const PACKAGES_DIR = path.join(BREW_ROOT, 'packages');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('merges TOML manifest with auto-detected skills', () => {
    const pkgPath = path.join(PACKAGES_DIR, 'test-pkg');
    
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p === PACKAGES_DIR) return true;
        if (p === pkgPath) return true;
        if (p === path.join(pkgPath, 'agentbrew.toml')) return true;
        if (p === path.join(pkgPath, 'skill1.md')) return true;
        return false;
    });

    (fs.readdirSync as jest.Mock).mockImplementation((p: string) => {
        if (p === PACKAGES_DIR) return ['test-pkg'];
        if (p === pkgPath) return ['agentbrew.toml', 'skill1.md'];
        return [];
    });

    (fs.statSync as jest.Mock).mockImplementation((p: string) => ({
        isDirectory: () => p === PACKAGES_DIR || p === pkgPath
    }));

    const tomlContent = `
name = "test-pkg"
version = "1.0.0"
description = "A test package"

[[servers]]
name = "srv1"
command = "node"
args = ["index.js"]
`;
    (fs.readFileSync as jest.Mock).mockImplementation((p: string) => {
        if (p === path.join(pkgPath, 'agentbrew.toml')) return tomlContent;
        if (p === path.join(pkgPath, 'skill1.md')) return "# Skill 1\nThis is a skill";
        return "";
    });

    const packages = discoverPackages(true);
    expect(packages.length).toBe(1);
    const pkg = packages[0];

    // Assert packageName is the directory name
    expect(pkg.packageName).toBe('test-pkg');
    
    // Should have the server from TOML
    expect(pkg.manifest.servers).toBeDefined();
    expect(pkg.manifest.servers?.length).toBe(1);
    expect(pkg.manifest.servers?.[0].name).toBe('srv1');

    // Should have the skill from auto-detection
    expect(pkg.manifest.prompts).toBeDefined();
    expect(pkg.manifest.prompts?.length).toBe(1);
    expect(pkg.manifest.prompts?.[0].name).toBe('skill1');
    expect(pkg.manifest.prompts?.[0].description).toBe('Skill 1');
  });
});
