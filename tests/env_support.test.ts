import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Router } from '../src/router';

jest.mock("@modelcontextprotocol/sdk/client/stdio.js");
jest.mock("@modelcontextprotocol/sdk/client/index.js");
jest.mock("@modelcontextprotocol/sdk/server/index.js");

describe('ManagedClient Environment Support', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('passes env to StdioClientTransport', async () => {
    const router = new Router();
    const pkgPath = '/tmp/pkg';
    const serverConfig = {
      name: 'srv',
      command: 'node',
      args: ['index.js'],
      env: { TEST_KEY: 'TEST_VALUE' }
    };

    // Access private managedClients to inject our test client
    // @ts-ignore
    router.registerPackage({
      packageName: 'test-pkg',
      subPath: '',
      path: pkgPath,
      manifest: {
        name: 'test-pkg',
        version: '1.0.0',
        servers: [serverConfig]
      },
      isEnabled: true
    });

    const prefix = 'test-pkg_srv';
    // @ts-ignore
    const managedClient = router.managedClients.get(prefix);
    
    expect(managedClient).toBeDefined();

    // Mock Client connect
    (Client as jest.Mock).prototype.connect = jest.fn().mockResolvedValue(undefined);

    if (managedClient) {
      await managedClient.getClient();
    }

    expect(StdioClientTransport).toHaveBeenCalledWith(expect.objectContaining({
      command: 'node',
      args: ['index.js'],
      cwd: pkgPath
    }));

    const spawnedEnv = (StdioClientTransport as jest.Mock).mock.calls[0][0].env;
    // Server-defined vars must be present
    expect(spawnedEnv).toMatchObject({ TEST_KEY: 'TEST_VALUE', GIT_TERMINAL_PROMPT: '0' });
    // Interactive/display vars that sandboxes block must be stripped
    expect(spawnedEnv).not.toHaveProperty('EDITOR');
    expect(spawnedEnv).not.toHaveProperty('GIT_EDITOR');
    expect(spawnedEnv).not.toHaveProperty('VISUAL');
    expect(spawnedEnv).not.toHaveProperty('PAGER');
    expect(spawnedEnv).not.toHaveProperty('GIT_PAGER');
  });

  test('passes custom cwd to StdioClientTransport', async () => {
    const router = new Router();
    const pkgPath = '/tmp/pkg';
    const customCwd = '/custom/cwd/path';
    const serverConfig = {
      name: 'srv',
      command: 'node',
      args: ['index.js'],
      cwd: customCwd
    };

    // @ts-ignore
    router.registerPackage({
      packageName: 'test-pkg-cwd',
      subPath: '',
      path: pkgPath,
      manifest: {
        name: 'test-pkg-cwd',
        version: '1.0.0',
        servers: [serverConfig]
      },
      isEnabled: true
    });

    const prefix = 'test-pkg-cwd_srv';
    // @ts-ignore
    const managedClient = router.managedClients.get(prefix);
    
    expect(managedClient).toBeDefined();

    // Mock Client connect
    (Client as jest.Mock).prototype.connect = jest.fn().mockResolvedValue(undefined);

    if (managedClient) {
      await managedClient.getClient();
    }

    expect(StdioClientTransport).toHaveBeenCalledWith(expect.objectContaining({
      command: 'node',
      args: ['index.js'],
      cwd: customCwd
    }));
  });
});
