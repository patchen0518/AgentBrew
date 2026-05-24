// tests/daemon.test.ts
import { startDaemon } from '../src/daemon';

describe('Daemon', () => {
  test('daemon initializes and can be stopped', async () => {
    // We silence console during this test to keep output clean
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const daemon = await startDaemon();
    expect(daemon).toBeDefined();
    
    await daemon.stop();
    
    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});
