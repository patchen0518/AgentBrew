// tests/state.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { enablePackage, disablePackage, isPackageEnabled, loadState, getSkillsAsMcpTools, saveState } from '../src/state';
import { getStateFile } from '../src/config';

describe('State Manager', () => {
  beforeEach(() => {
    const stateFile = getStateFile();
    if (fs.existsSync(stateFile)) {
      try {
        fs.unlinkSync(stateFile);
      } catch (e) {}
    }
  });

  test('can disable and enable a package', () => {
    const pkgName = 'test-package';
    
    disablePackage(pkgName);
    expect(isPackageEnabled(pkgName)).toBe(false);
    
    enablePackage(pkgName);
    expect(isPackageEnabled(pkgName)).toBe(true);
  });

  test('can check capability-level enablement', () => {
    const pkgName = 'multi-capability-package';
    const capName = 'capability-1';
    
    // Disable only the capability
    disablePackage(`${pkgName}:${capName}`);
    
    expect(isPackageEnabled(pkgName)).toBe(true);
    expect(isPackageEnabled(pkgName, capName)).toBe(false);
    expect(isPackageEnabled(pkgName, 'other-cap')).toBe(true);
    
    // Disable the whole package
    disablePackage(pkgName);
    expect(isPackageEnabled(pkgName)).toBe(false);
    expect(isPackageEnabled(pkgName, capName)).toBe(false);
    expect(isPackageEnabled(pkgName, 'other-cap')).toBe(false);
  });

  test('persistence works', () => {
    const pkgName = 'persistent-package';
    disablePackage(pkgName);

    const state = loadState();
    expect(state.disabledPackages).toContain(pkgName);
  });

  test('enablePackage returns changed when package was disabled', () => {
    const pkgName = 'return-test-package';
    disablePackage(pkgName);
    expect(enablePackage(pkgName)).toBe('changed');
  });

  test('enablePackage returns already_enabled when package was not disabled', () => {
    expect(enablePackage('never-disabled-package')).toBe('already_enabled');
  });

  test('disablePackage returns changed when package was enabled', () => {
    expect(disablePackage('new-package')).toBe('changed');
  });

  test('disablePackage returns already_disabled when package was already disabled', () => {
    const pkgName = 'double-disable-package';
    disablePackage(pkgName);
    expect(disablePackage(pkgName)).toBe('already_disabled');
  });
});

describe('getSkillsAsMcpTools', () => {
  let tempDir: string;
  const origBrewRoot = process.env.AGENTBREW_ROOT;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbrew-state-test-'));
    process.env.AGENTBREW_ROOT = tempDir;
  });

  afterAll(() => {
    if (origBrewRoot === undefined) {
      delete process.env.AGENTBREW_ROOT;
    } else {
      process.env.AGENTBREW_ROOT = origBrewRoot;
    }
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  beforeEach(() => {
    const stateFile = path.join(tempDir, 'state.json');
    try { fs.unlinkSync(stateFile); } catch {}
  });

  test('returns true by default when state file is absent', () => {
    expect(getSkillsAsMcpTools()).toBe(true);
  });

  test('returns true when skillsAsMcpTools is not set in state', () => {
    saveState({ disabledPackages: [] });
    expect(getSkillsAsMcpTools()).toBe(true);
  });

  test('returns false when skillsAsMcpTools is explicitly false', () => {
    saveState({ disabledPackages: [], skillsAsMcpTools: false });
    expect(getSkillsAsMcpTools()).toBe(false);
  });

  test('returns true when skillsAsMcpTools is explicitly true', () => {
    saveState({ disabledPackages: [], skillsAsMcpTools: true });
    expect(getSkillsAsMcpTools()).toBe(true);
  });
});
