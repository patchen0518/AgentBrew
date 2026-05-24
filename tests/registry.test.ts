// tests/registry.test.ts
import { discoverPackages } from '../src/registry';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Registry', () => {
  test('discoverPackages returns an array', () => {
    const packages = discoverPackages();
    expect(Array.isArray(packages)).toBe(true);
  });
});
