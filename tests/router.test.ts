// tests/router.test.ts
import { ManagedClient, ClientStatus, startRouter } from '../src/router';
import { Logger } from '../src/logger';
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

jest.mock("@modelcontextprotocol/sdk/client/stdio.js");
jest.mock("@modelcontextprotocol/sdk/client/index.js");
jest.mock("@modelcontextprotocol/sdk/server/stdio.js");

describe('Router and ManagedClient', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger, 'info').mockImplementation(() => {});
    errorSpy = jest.spyOn(Logger, 'error').mockImplementation(() => {});
    jest.clearAllMocks();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('router initializes and can be stopped', async () => {
    const router = await startRouter();
    expect(router).toBeDefined();
    await router.stop();
  });

  describe('ManagedClient Fault Tolerance', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('ManagedClient retries on crash', async () => {
      const mockTransport = {
        onclose: null as any,
      };
      (StdioClientTransport as jest.Mock).mockImplementation(() => mockTransport);

      const mockClient = {
        connect: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
      };
      (Client as jest.Mock).mockImplementation(() => mockClient);

      const managed = new ManagedClient('test', '/tmp', { command: 'node', args: [] });
      
      // First connection
      await managed.getClient();
      expect(managed.isConnected()).toBe(true);
      expect(mockTransport.onclose).toBeDefined();

      // Simulate crash
      mockTransport.onclose();
      
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Server test crashed. Retrying 1/3 in 2s...'));

      // Advance timers
      jest.advanceTimersByTime(2000);

      // Wait for the retry to trigger
      await Promise.resolve();

      expect(StdioClientTransport).toHaveBeenCalledTimes(2);
    });

    test('ManagedClient fails after max retries', async () => {
      const mockTransport = {
        onclose: null as any,
      };
      (StdioClientTransport as jest.Mock).mockImplementation(() => mockTransport);

      const mockClient = {
        connect: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
      };
      (Client as jest.Mock).mockImplementation(() => mockClient);

      const managed = new ManagedClient('test', '/tmp', { command: 'node', args: [] });
      
      await managed.getClient();
      
      // Retry 1
      mockTransport.onclose();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();

      // Retry 2
      mockTransport.onclose();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();

      // Retry 3
      mockTransport.onclose();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();

      // Crash 4 -> Should fail permanently
      mockTransport.onclose();
      await Promise.resolve();

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Server test failed permanently after 3 attempts.'));
      
      await expect(managed.getClient()).rejects.toThrow(/failed after 3 attempts/);
    });
  });
});
