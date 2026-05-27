import { generateMcpManifest } from '../src/registry';
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Logger } from '../src/logger';
import fs from 'fs';

jest.mock("@modelcontextprotocol/sdk/client/stdio.js");
jest.mock("@modelcontextprotocol/sdk/client/index.js");
jest.mock("fs", () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    writeFileSync: jest.fn(),
  };
});

describe('generateMcpManifest Timeout', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger, 'info').mockImplementation(() => {});
    errorSpy = jest.spyOn(Logger, 'error').mockImplementation(() => {});
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    jest.useRealTimers();
  });

  test('generateMcpManifest fails gracefully when client connection times out', async () => {
    const mockTransport = {
      close: jest.fn().mockResolvedValue(undefined),
    };
    (StdioClientTransport as jest.Mock).mockImplementation(() => mockTransport);

    // Mock connect to hang indefinitely (returning a promise that never resolves)
    const mockClient = {
      connect: jest.fn().mockReturnValue(new Promise(() => {})),
      close: jest.fn().mockResolvedValue(undefined),
    };
    (Client as jest.Mock).mockImplementation(() => mockClient);

    const manifest = {
      name: 'test-pkg',
      version: '1.0.0',
      servers: [
        {
          name: 'test-server',
          command: 'node',
          args: [],
        }
      ]
    };

    const promise = generateMcpManifest('/tmp/pkg', manifest);

    // Fast-forward timers by 10s to trigger connection timeout
    jest.advanceTimersByTime(10000);

    // Wait for promise resolution
    await promise;

    // Verify it fails gracefully by logging error
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to connect or discover capabilities for test-server: Connection timeout of 10s exceeded'));
    
    // Verify it closed the transport to prevent leakage
    expect(mockTransport.close).toHaveBeenCalled();

    // Verify it still writes manifest to cache
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  test('generateMcpManifest discovers and caches resource templates successfully', async () => {
    const mockTransport = {
      close: jest.fn().mockResolvedValue(undefined),
    };
    (StdioClientTransport as jest.Mock).mockImplementation(() => mockTransport);

    const mockClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      listTools: jest.fn().mockResolvedValue({ tools: [] }),
      listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
      listResources: jest.fn().mockResolvedValue({ resources: [] }),
      listResourceTemplates: jest.fn().mockResolvedValue({
        resourceTemplates: [
          {
            uriTemplate: 'myscheme://{path}',
            name: 'Test Template',
            description: 'A test template'
          }
        ]
      }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    (Client as jest.Mock).mockImplementation(() => mockClient);

    const manifest = {
      name: 'test-pkg',
      version: '1.0.0',
      servers: [
        {
          name: 'test-server',
          command: 'node',
          args: [],
        }
      ]
    };

    const cache = await generateMcpManifest('/tmp/pkg', manifest);

    expect(mockClient.listResourceTemplates).toHaveBeenCalled();
    expect(cache.discovered).toBeDefined();
    expect(cache.discovered?.resourceTemplates).toBeDefined();
    expect(cache.discovered?.resourceTemplates?.['test-server']).toHaveLength(1);
    expect(cache.discovered?.resourceTemplates?.['test-server'][0].uriTemplate).toBe('myscheme://{path}');
  });
});

