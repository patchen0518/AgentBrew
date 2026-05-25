// tests/router.test.ts
import { startRouter } from '../src/router';
import { Logger } from '../src/logger';

describe('Router', () => {
  test('router initializes and can be stopped', async () => {
    // We silence Logger during this test to keep output clean
    const logSpy = jest.spyOn(Logger, 'info').mockImplementation(() => {});
    const errSpy = jest.spyOn(Logger, 'error').mockImplementation(() => {});

    const router = await startRouter();
    expect(router).toBeDefined();
    
    await router.stop();
    
    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});
