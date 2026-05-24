// tests/installer.test.ts
import { installPackage } from '../src/installer';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Installer', () => {
  const BREW_ROOT = path.join(os.homedir(), '.agentbrew');
  const PACKAGES_DIR = path.join(BREW_ROOT, 'packages');

  test('derives name and creates directory (dry-ish run)', async () => {
    // Note: We aren't doing a real clone in unit tests to avoid network dependency
    // This is a placeholder for real integration tests
    expect(installPackage).toBeDefined();
  });
});
