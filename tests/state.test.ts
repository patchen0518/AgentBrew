// tests/state.test.ts
import { enablePackage, disablePackage, isPackageEnabled, loadState } from '../src/state';
import { getStateFile } from '../src/config';
import fs from 'fs';

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
});
