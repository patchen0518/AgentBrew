// tests/state.test.ts
import { enablePackage, disablePackage, isPackageEnabled, loadState } from '../src/state';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('State Manager', () => {
  const BREW_ROOT = path.join(os.homedir(), '.agentbrew');
  const STATE_FILE = path.join(BREW_ROOT, 'state.json');

  test('can disable and enable a package', () => {
    const pkgName = 'test-package';
    
    disablePackage(pkgName);
    expect(isPackageEnabled(pkgName)).toBe(false);
    
    enablePackage(pkgName);
    expect(isPackageEnabled(pkgName)).toBe(true);
  });

  test('persistence works', () => {
    const pkgName = 'persistent-package';
    disablePackage(pkgName);
    
    const state = loadState();
    expect(state.disabledPackages).toContain(pkgName);
  });
});
