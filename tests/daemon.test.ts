// tests/daemon.test.ts
import { startDaemon } from '../src/daemon';

describe('Daemon', () => {
  test('daemon initializes and returns true', () => {
    expect(startDaemon()).toBe(true);
  });
});
