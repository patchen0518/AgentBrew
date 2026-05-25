import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { createLinkPackage } from '../src/installer';

jest.mock('fs', () => {
    const actualFs = jest.requireActual('fs');
    return {
        ...actualFs,
        existsSync: jest.fn(),
        promises: {
            ...actualFs.promises,
            writeFile: jest.fn().mockResolvedValue(undefined),
            mkdir: jest.fn().mockResolvedValue(undefined),
        }
    };
});

describe('createLinkPackage', () => {
  const BREW_ROOT = process.env.AGENTBREW_ROOT || path.join(os.homedir(), '.agentbrew');
  const PACKAGES_DIR = path.join(BREW_ROOT, 'packages');

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
  });

  test('creates a link package with correct structure and TOML content', async () => {
    const name = 'test-server';
    const command = '/usr/local/bin/node';
    const args = ['index.js'];
    const env = { KEY: 'VALUE' };

    const urlHash = crypto.createHash('sha256').update(command + args.join('')).digest('hex').substring(0, 8);
    const expectedDirName = `linked-${name}-${urlHash}`;
    const expectedPath = path.join(PACKAGES_DIR, expectedDirName);

    const resultPath = await createLinkPackage(name, command, args, env);

    expect(resultPath).toBe(expectedPath);
    expect(fs.promises.mkdir).toHaveBeenCalledWith(PACKAGES_DIR, { recursive: true });
    expect(fs.promises.mkdir).toHaveBeenCalledWith(expectedPath, { recursive: true });
    
    const expectedToml = `name = "linked-${name}"
version = "1.0.0"
description = "Linked server migrated to AgentBrew"

[[servers]]
name = "${name}"
command = "${command}"
args = ["${args[0]}"]
description = "Linked server: ${name}"

[servers.env]
KEY = "VALUE"
`;

    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      path.join(expectedPath, 'agentbrew.toml'),
      expect.stringContaining(`name = "${name}"`),
      'utf-8'
    );
    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      path.join(expectedPath, 'agentbrew.toml'),
      expect.stringContaining(`command = "${command}"`),
      'utf-8'
    );
  });

  test('handles optional env', async () => {
    const name = 'no-env-server';
    const command = 'python';
    const args = ['main.py'];

    const urlHash = crypto.createHash('sha256').update(command + args.join('')).digest('hex').substring(0, 8);
    const expectedDirName = `linked-${name}-${urlHash}`;
    const expectedPath = path.join(PACKAGES_DIR, expectedDirName);

    await createLinkPackage(name, command, args);

    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      path.join(expectedPath, 'agentbrew.toml'),
      expect.not.stringContaining('[servers.env]'),
      'utf-8'
    );
  });

  test('throws error if link package already exists', async () => {
    const name = 'existing-server';
    const command = 'node';
    const args = ['app.js'];

    (fs.existsSync as jest.Mock).mockReturnValue(true);

    await expect(createLinkPackage(name, command, args))
      .rejects.toThrow(/already installed/);
  });
});
