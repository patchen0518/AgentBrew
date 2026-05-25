// tests/config.test.ts
import { getBrewRoot, getPackagesDir, getStateFile } from '../src/config';
import path from 'path';
import os from 'os';

describe('Centralized Configuration', () => {
  const originalEnv = process.env.AGENTBREW_ROOT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AGENTBREW_ROOT;
    } else {
      process.env.AGENTBREW_ROOT = originalEnv;
    }
  });

  test('should fallback to default ~/.agentbrew path when AGENTBREW_ROOT is not set', () => {
    delete process.env.AGENTBREW_ROOT;
    const expectedRoot = path.join(os.homedir(), '.agentbrew');
    expect(getBrewRoot()).toBe(expectedRoot);
    expect(getPackagesDir()).toBe(path.join(expectedRoot, 'packages'));
    expect(getStateFile()).toBe(path.join(expectedRoot, 'state.json'));
  });

  test('should resolve to custom path when AGENTBREW_ROOT is set', () => {
    const customPath = '/tmp/custom-agentbrew-root';
    process.env.AGENTBREW_ROOT = customPath;
    expect(getBrewRoot()).toBe(customPath);
    expect(getPackagesDir()).toBe(path.join(customPath, 'packages'));
    expect(getStateFile()).toBe(path.join(customPath, 'state.json'));
  });

  test('should dynamically evaluate the environment variable on each call', () => {
    delete process.env.AGENTBREW_ROOT;
    const defaultRoot = path.join(os.homedir(), '.agentbrew');
    expect(getBrewRoot()).toBe(defaultRoot);

    const customPath = '/tmp/dynamic-agentbrew-root';
    process.env.AGENTBREW_ROOT = customPath;
    expect(getBrewRoot()).toBe(customPath);
  });
});
