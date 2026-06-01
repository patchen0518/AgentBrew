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
    const skillsPath = path.join(pkgPath, 'skills');
    
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p === PACKAGES_DIR) return true;
        if (p === pkgPath) return true;
        if (p === skillsPath) return true;
        if (p === path.join(pkgPath, 'agentbrew.toml')) return true;
        if (p === path.join(skillsPath, 'skill1.md')) return true;
        return false;
    });

    (fs.readdirSync as jest.Mock).mockImplementation((p: string) => {
        if (p === PACKAGES_DIR) return ['test-pkg'];
        if (p === pkgPath) return ['agentbrew.toml', 'skills'];
        if (p === skillsPath) return ['skill1.md'];
        return [];
    });

    (fs.statSync as jest.Mock).mockImplementation((p: string) => ({
        isDirectory: () => p === PACKAGES_DIR || p === pkgPath || p === skillsPath
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
        if (p === path.join(skillsPath, 'skill1.md')) return "# Skill 1\nThis is a skill";
        return "";
    });

    const packages = discoverPackages(true);
    expect(packages.length).toBe(2);
    
    // Package 1: root with servers
    const pkg1 = packages.find(p => p.subPath === '');
    expect(pkg1).toBeDefined();
    expect(pkg1?.manifest.servers).toBeDefined();
    expect(pkg1?.manifest.servers?.length).toBe(1);
    expect(pkg1?.manifest.servers?.[0].name).toBe('srv1');

    // Package 2: skills subdirectory with prompts
    const pkg2 = packages.find(p => p.subPath === 'skills');
    expect(pkg2).toBeDefined();
    expect(pkg2?.manifest.prompts).toBeDefined();
    expect(pkg2?.manifest.prompts?.length).toBe(1);
    expect(pkg2?.manifest.prompts?.[0].name).toBe('skill1');
    expect(pkg2?.manifest.prompts?.[0].description).toBe('Skill 1');
  });

  test('does not auto-detect a server for monorepo workspace roots', () => {
    const rootPath = path.join(PACKAGES_DIR, 'monorepo-pkg');
    const subPkgPath = path.join(rootPath, 'packages', 'mcp');

    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p === PACKAGES_DIR) return true;
        if (p === rootPath) return true;
        if (p === path.join(rootPath, 'packages')) return true;
        if (p === subPkgPath) return true;
        if (p === path.join(rootPath, 'package.json')) return true;
        if (p === path.join(subPkgPath, 'package.json')) return true;
        if (p === path.join(subPkgPath, 'dist', 'index.js')) return true;
        return false;
    });

    (fs.readdirSync as jest.Mock).mockImplementation((p: string) => {
        if (p === PACKAGES_DIR) return ['monorepo-pkg'];
        if (p === rootPath) return ['package.json', 'packages'];
        if (p === path.join(rootPath, 'packages')) return ['mcp'];
        if (p === subPkgPath) return ['package.json', 'dist'];
        return [];
    });

    (fs.statSync as jest.Mock).mockImplementation((p: string) => ({
        isDirectory: () => [PACKAGES_DIR, rootPath, path.join(rootPath, 'packages'), subPkgPath].includes(p)
    }));

    (fs.readFileSync as jest.Mock).mockImplementation((p: string) => {
        if (p === path.join(rootPath, 'package.json')) {
            return JSON.stringify({
                name: 'monorepo-root',
                version: '1.0.0',
                workspaces: ['packages/*'],
                bin: { 'my-mcp-server': 'dist/index.js' }
            });
        }
        if (p === path.join(subPkgPath, 'package.json')) {
            return JSON.stringify({
                name: 'my-mcp-server',
                version: '1.0.0',
                dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' }
            });
        }
        return '';
    });

    const packages = discoverPackages(true);

    // The workspace root should NOT register a server even though it has a bin entry
    const rootPkg = packages.find(p => p.subPath === '');
    expect(rootPkg?.manifest.servers ?? []).toHaveLength(0);

    // The sub-package should register the MCP server
    const subPkg = packages.find(p => p.path === subPkgPath);
    expect(subPkg).toBeDefined();
    expect(subPkg?.manifest.servers).toBeDefined();
    expect(subPkg?.manifest.servers?.length).toBeGreaterThan(0);
  });

  test('auto-detects poetry projects with poetry run python', () => {
    const pkgPath = path.join(PACKAGES_DIR, 'poetry-pkg');
    
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p === PACKAGES_DIR) return true;
        if (p === pkgPath) return true;
        if (p === path.join(pkgPath, 'pyproject.toml')) return true;
        if (p === path.join(pkgPath, 'poetry.lock')) return true;
        return false;
    });

    (fs.readdirSync as jest.Mock).mockImplementation((p: string) => {
        if (p === PACKAGES_DIR) return ['poetry-pkg'];
        if (p === pkgPath) return ['pyproject.toml', 'poetry.lock'];
        return [];
    });

    (fs.statSync as jest.Mock).mockImplementation((p: string) => ({
        isDirectory: () => p === PACKAGES_DIR || p === pkgPath
    }));

    (fs.readFileSync as jest.Mock).mockImplementation((p: string) => {
        if (p === path.join(pkgPath, 'pyproject.toml')) return 'dependencies = { mcp = "*" }';
        return "";
    });

    const packages = discoverPackages(true);
    expect(packages.length).toBe(1);
    expect(packages[0].manifest.servers).toBeDefined();
    expect(packages[0].manifest.servers?.[0].command).toBe('poetry');
    expect(packages[0].manifest.servers?.[0].args[0]).toBe('run');
    expect(packages[0].manifest.servers?.[0].args[1]).toBe('python');
  });
});
