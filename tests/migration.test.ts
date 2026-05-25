import fs from 'fs';
import path from 'path';
import os from 'os';
import { discoverExternalConfigs } from '../src/migration';

jest.mock('fs', () => {
    const actualFs = jest.requireActual('fs');
    return {
        ...actualFs,
        existsSync: jest.fn(),
        readFileSync: jest.fn(),
        readdirSync: jest.fn(),
        statSync: jest.fn(),
    };
});
jest.mock('os', () => ({
  homedir: jest.fn().mockReturnValue('/home/user')
}));

describe('Discovery Engine', () => {
  const home = '/home/user';

  beforeEach(() => {
    jest.clearAllMocks();
    (os.homedir as jest.Mock).mockReturnValue(home);
  });

  test('discovers Gemini MCP servers', () => {
    const geminiConfig = path.join(home, '.gemini', 'config', 'mcp_config.json');
    (fs.existsSync as jest.Mock).mockImplementation((p) => p === geminiConfig);
    (fs.readFileSync as jest.Mock).mockImplementation((p) => {
      if (p === geminiConfig) {
        return JSON.stringify({
          mcpServers: {
            'test-server': {
              command: 'node',
              args: ['test.js'],
              env: { KEY: 'VALUE' }
            }
          }
        });
      }
      return '';
    });

    const result = discoverExternalConfigs();

    expect(result.servers).toContainEqual(expect.objectContaining({
      name: 'test-server',
      source: 'Gemini',
      command: 'node',
      args: ['test.js'],
      env: { KEY: 'VALUE' }
    }));
  });

  test('discovers Claude plugins and MCP servers', () => {
    const claudeConfig = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
    const pluginPath = path.join(home, '.claude', 'plugins', 'test-plugin');
    const mcpJsonPath = path.join(pluginPath, '.mcp.json');
    const pkgJsonPath = path.join(pluginPath, 'package.json');

    (fs.existsSync as jest.Mock).mockImplementation((p) => {
      return [claudeConfig, pluginPath, mcpJsonPath, pkgJsonPath].includes(p);
    });

    (fs.readFileSync as jest.Mock).mockImplementation((p) => {
      if (p === claudeConfig) {
        return JSON.stringify([
          { installPath: pluginPath }
        ]);
      }
      if (p === mcpJsonPath) {
        return JSON.stringify({
          name: 'claude-server',
          command: 'python3',
          args: ['server.py']
        });
      }
      if (p === pkgJsonPath) {
        return JSON.stringify({
          repository: { url: 'https://github.com/user/repo' }
        });
      }
      return '';
    });

    (fs.readdirSync as jest.Mock).mockReturnValue([]);

    const result = discoverExternalConfigs();

    expect(result.servers).toContainEqual(expect.objectContaining({
      name: 'claude-server',
      source: 'Claude',
      repoUrl: 'https://github.com/user/repo'
    }));
  });

  test('discovers Cursor MCP servers', () => {
    const cursorConfig = path.join(home, '.cursor', 'mcp.json');
    (fs.existsSync as jest.Mock).mockImplementation((p) => p === cursorConfig);
    (fs.readFileSync as jest.Mock).mockImplementation((p) => {
      if (p === cursorConfig) {
        return JSON.stringify({
          mcpServers: {
            'cursor-server': {
              command: 'npx',
              args: ['@mcp/everything']
            }
          }
        });
      }
      return '';
    });

    const result = discoverExternalConfigs();

    expect(result.servers).toContainEqual(expect.objectContaining({
      name: 'cursor-server',
      source: 'Cursor'
    }));
  });

  test('discovers Gemini skills', () => {
    const extensionsDir = path.join(home, '.gemini', 'extensions');
    const extDir = path.join(extensionsDir, 'test-ext');
    const skillsDir = path.join(extDir, 'skills');
    const skillFile = path.join(skillsDir, 'test-skill.md');
    const pkgJsonPath = path.join(extDir, 'package.json');

    (fs.existsSync as jest.Mock).mockImplementation((p) => {
      return [extensionsDir, extDir, skillsDir, skillFile, pkgJsonPath].includes(p);
    });

    (fs.readdirSync as jest.Mock).mockImplementation((p) => {
      if (p === extensionsDir) return ['test-ext'];
      if (p === skillsDir) return ['test-skill.md'];
      return [];
    });

    (fs.statSync as jest.Mock).mockImplementation((p) => ({
      isDirectory: () => ![skillFile, pkgJsonPath].includes(p)
    }));

    (fs.readFileSync as jest.Mock).mockImplementation((p) => {
        if (p === pkgJsonPath) {
            return JSON.stringify({ homepage: 'https://gemini.skills/test' });
        }
        return '';
    });

    const result = discoverExternalConfigs();

    expect(result.skills).toContainEqual(expect.objectContaining({
      name: 'test-skill',
      source: 'Gemini',
      repoUrl: 'https://gemini.skills/test'
    }));
  });
});
