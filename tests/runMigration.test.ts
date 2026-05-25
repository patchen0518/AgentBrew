import fs from 'fs';
import path from 'path';
import os from 'os';
import * as readline from 'readline';
import { runMigration } from '../src/migration';
import { createLinkPackage, installPackage } from '../src/installer';
import { Logger } from '../src/logger';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  copyFileSync: jest.fn(),
  symlinkSync: jest.fn(),
  readFileSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    rm: jest.fn(),
  }
}));
jest.mock('os', () => ({
  homedir: jest.fn().mockReturnValue('/home/user')
}));
jest.mock('readline');
jest.mock('../src/installer');
jest.mock('../src/logger');

describe('runMigration', () => {
  let rlMock: any;
  const home = '/home/user';

  beforeEach(() => {
    jest.clearAllMocks();
    (os.homedir as jest.Mock).mockReturnValue(home);
    
    rlMock = {
      question: jest.fn(),
      close: jest.fn(),
    };
    (readline.createInterface as jest.Mock).mockReturnValue(rlMock);
  });

  test('does nothing if no configs found', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    await runMigration();

    expect(Logger.info).toHaveBeenCalledWith(expect.stringContaining('No external configurations found'));
    expect(readline.createInterface).not.toHaveBeenCalled();
  });

  test('migrates servers via linking', async () => {
    const geminiConfig = path.join(home, '.gemini', 'config', 'mcp_config.json');
    (fs.existsSync as jest.Mock).mockImplementation((p) => p === geminiConfig);
    (fs.readFileSync as jest.Mock).mockImplementation((p) => {
      if (p === geminiConfig) {
        return JSON.stringify({
          mcpServers: {
            'test-srv': {
              command: 'node',
              args: []
            }
          }
        });
      }
      return '';
    });

    rlMock.question.mockImplementation((query: string, cb: (ans: string) => void) => {
      cb('l');
    });

    await runMigration();

    expect(createLinkPackage).toHaveBeenCalledWith('test-srv', 'node', [], undefined);
    expect(Logger.info).toHaveBeenCalledWith(expect.stringContaining('Successfully linked test-srv'));
    expect(rlMock.close).toHaveBeenCalled();
  });

  test('migrates servers via installing', async () => {
    const claudeConfig = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
    const pluginPath = path.join(home, '.claude', 'plugins', 'test-plugin');
    const mcpJsonPath = path.join(pluginPath, '.mcp.json');
    const pkgJsonPath = path.join(pluginPath, 'package.json');

    (fs.existsSync as jest.Mock).mockImplementation((p) => {
      return [claudeConfig, pluginPath, mcpJsonPath, pkgJsonPath].includes(p);
    });

    (fs.readFileSync as jest.Mock).mockImplementation((p) => {
      if (p === claudeConfig) {
        return JSON.stringify([{ installPath: pluginPath }]);
      }
      if (p === mcpJsonPath) {
        return JSON.stringify({
          name: 'test-srv',
          command: 'node',
          args: []
        });
      }
      if (p === pkgJsonPath) {
        return JSON.stringify({
          repository: { url: 'https://github.com/repo' }
        });
      }
      return '';
    });

    (fs.readdirSync as jest.Mock).mockReturnValue([]);

    rlMock.question.mockImplementation((query: string, cb: (ans: string) => void) => {
      cb('i');
    });

    await runMigration();

    expect(installPackage).toHaveBeenCalledWith('https://github.com/repo');
    expect(Logger.info).toHaveBeenCalledWith(expect.stringContaining('Successfully installed test-srv'));
  });

  test('migrates skills', async () => {
    const extensionsDir = path.join(home, '.gemini', 'extensions');
    const extDir = path.join(extensionsDir, 'test-ext');
    const skillsDir = path.join(extDir, 'skills');
    const skillFile = path.join(skillsDir, 'test-skill.md');

    (fs.existsSync as jest.Mock).mockImplementation((p) => {
      return [extensionsDir, extDir, skillsDir, skillFile].includes(p);
    });

    (fs.readdirSync as jest.Mock).mockImplementation((p) => {
      if (p === extensionsDir) return ['test-ext'];
      if (p === skillsDir) return ['test-skill.md'];
      return [];
    });

    (fs.statSync as jest.Mock).mockImplementation((p) => ({
      isDirectory: () => ![skillFile].includes(p)
    }));

    rlMock.question.mockImplementation((query: string, cb: (ans: string) => void) => {
      cb('y');
    });

    await runMigration();

    const brewRoot = path.join(home, '.agentbrew');
    const migratedSkillsDir = path.join(brewRoot, 'packages', 'migrated-skills');
    expect(fs.mkdirSync).toHaveBeenCalledWith(migratedSkillsDir, { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith(path.join(migratedSkillsDir, 'agentbrew.toml'), expect.any(String), 'utf-8');
    expect(fs.copyFileSync).toHaveBeenCalledWith(skillFile, path.join(migratedSkillsDir, 'test-skill.md'));
    expect(Logger.info).toHaveBeenCalledWith(expect.stringContaining('Successfully migrated skill: test-skill'));
  });
});
