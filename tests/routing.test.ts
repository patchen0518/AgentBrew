import { Router } from '../src/router';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { disablePackage, enablePackage } from '../src/state';
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

jest.mock("@modelcontextprotocol/sdk/server/index.js");
jest.mock("@modelcontextprotocol/sdk/client/index.js");

describe('Router Tool Routing', () => {
  let router: Router;
  let mockServerInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Capture the server instance and its handlers
    mockServerInstance = {
      setRequestHandler: jest.fn(),
      connect: jest.fn(),
      close: jest.fn(),
    };
    (Server as jest.Mock).mockReturnValue(mockServerInstance);

    router = new Router();
  });

  test('routes tool call to correct client', async () => {
    // 1. Get the CallTool handler
    const setRequestHandlerCalls = mockServerInstance.setRequestHandler.mock.calls;
    const callToolHandler = setRequestHandlerCalls.find(
      (call: any) => call[0] === CallToolRequestSchema
    )?.[1];

    expect(callToolHandler).toBeDefined();

    // 2. Setup mock managed client
    const mockClient = {
      callTool: jest.fn().mockResolvedValue({
        content: [{ type: "text", text: "Success" }]
      }),
      connect: jest.fn(),
      close: jest.fn(),
    };
    
    const mockManagedClient = {
        prefix: 'test-pkg_server1',
        getClient: jest.fn().mockResolvedValue(mockClient),
        stop: jest.fn()
    };
    
    // Inject the mock managed client into the private managedClients map
    // @ts-ignore
    router.managedClients.set('test-pkg_server1', mockManagedClient);

    // 3. Simulate a tool call
    const request = {
      params: {
        name: 'test-pkg_server1__my-tool',
        arguments: { arg1: 'val1' }
      }
    };

    const result = await callToolHandler(request);

    // 4. Verify routing
    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: 'my-tool',
      arguments: { arg1: 'val1' }
    });
    expect(result).toEqual({
      content: [{ type: "text", text: "Success" }]
    });
  });

  test('throws error for invalid tool name format', async () => {
    const callToolHandler = mockServerInstance.setRequestHandler.mock.calls.find(
      (call: any) => call[0] === CallToolRequestSchema
    )?.[1];

    const request = {
      params: {
        name: 'invalidtoolname', // No underscore
      }
    };

    await expect(callToolHandler(request)).rejects.toThrow("Invalid name format: invalidtoolname");
  });

  test('throws error for missing client', async () => {
    const callToolHandler = mockServerInstance.setRequestHandler.mock.calls.find(
      (call: any) => call[0] === CallToolRequestSchema
    )?.[1];

    const request = {
      params: {
        name: 'unknown-pkg_server__tool',
      }
    };

    await expect(callToolHandler(request)).rejects.toThrow("Unknown prefix: unknown-pkg_server");
  });

  test('successfully routes tool names containing underscores', async () => {
    const callToolHandler = mockServerInstance.setRequestHandler.mock.calls.find(
      (call: any) => call[0] === CallToolRequestSchema
    )?.[1];

    const mockClient = {
      callTool: jest.fn().mockResolvedValue({ content: [] }),
      connect: jest.fn(),
      close: jest.fn(),
    };
    
    const mockManagedClient = {
        prefix: 'pkg_srv',
        getClient: jest.fn().mockResolvedValue(mockClient),
        stop: jest.fn()
    };
    
    // @ts-ignore
    router.managedClients.set('pkg_srv', mockManagedClient);

    const request = {
      params: {
        name: 'pkg_srv__tool_with_underscores',
      }
    };

    await callToolHandler(request);

    expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'tool_with_underscores',
        arguments: undefined
    });
  });
});

describe('Router Resource Routing', () => {
  let router: Router;
  let mockServerInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockServerInstance = {
      setRequestHandler: jest.fn(),
      connect: jest.fn(),
      close: jest.fn(),
    };
    (Server as jest.Mock).mockReturnValue(mockServerInstance);
    router = new Router();
  });

  test('lists and transforms resource templates lazily from cache', async () => {
    const listTemplatesHandler = mockServerInstance.setRequestHandler.mock.calls.find(
      (call: any) => call[0] === ListResourceTemplatesRequestSchema
    )?.[1];

    const mockManagedClient = {
      prefix: 'test-prefix',
      getClient: jest.fn()
    };

    // @ts-ignore
    router.managedClients.set('test-prefix', mockManagedClient);

    // Set cached resource templates directly to simulate registration from mcp-manifest.json
    // @ts-ignore
    router.cachedResourceTemplates.set('test-prefix', [
      {
        uriTemplate: 'myscheme://{path}',
        name: 'Test Template',
        description: 'A test template'
      }
    ]);

    const result = await listTemplatesHandler();

    expect(result.resourceTemplates).toHaveLength(1);
    expect(result.resourceTemplates[0].uriTemplate).toBe('mcp://test-prefix/myscheme/{path}');
    
    // VERIFY: The client process was NOT spawned (lazy loading is preserved)
    expect(mockManagedClient.getClient).not.toHaveBeenCalled();
  });

  test('proxies readResource for templated URIs', async () => {
    const readResourceHandler = mockServerInstance.setRequestHandler.mock.calls.find(
      (call: any) => call[0] === ReadResourceRequestSchema
    )?.[1];

    const mockClient = {
      readResource: jest.fn().mockResolvedValue({
        contents: [{ uri: 'myscheme://some/path', text: 'Resource content' }]
      }),
    };

    const mockManagedClient = {
      prefix: 'test-prefix',
      getClient: jest.fn().mockResolvedValue(mockClient)
    };

    // @ts-ignore
    router.managedClients.set('test-prefix', mockManagedClient);

    const request = {
      params: {
        uri: 'mcp://test-prefix/myscheme/some/path'
      }
    };

    const result = await readResourceHandler(request);

    expect(mockClient.readResource).toHaveBeenCalledWith({
      uri: 'myscheme://some/path'
    });
    expect(result.contents[0].text).toBe('Resource content');
  });

  test('handles raw scheme in templated URIs', async () => {
    const readResourceHandler = mockServerInstance.setRequestHandler.mock.calls.find(
      (call: any) => call[0] === ReadResourceRequestSchema
    )?.[1];

    const mockClient = {
      readResource: jest.fn().mockResolvedValue({
        contents: [{ uri: 'raw-resource', text: 'Raw content' }]
      }),
    };

    const mockManagedClient = {
      prefix: 'test-prefix',
      getClient: jest.fn().mockResolvedValue(mockClient)
    };

    // @ts-ignore
    router.managedClients.set('test-prefix', mockManagedClient);

    const request = {
      params: {
        uri: 'mcp://test-prefix/raw/raw-resource'
      }
    };

    const result = await readResourceHandler(request);

    expect(mockClient.readResource).toHaveBeenCalledWith({
      uri: 'raw-resource'
    });
    expect(result.contents[0].text).toBe('Raw content');
  });

  test('handles complex URIs with query parameters and fragments', async () => {
    const readResourceHandler = mockServerInstance.setRequestHandler.mock.calls.find(
      (call: any) => call[0] === ReadResourceRequestSchema
    )?.[1];

    const mockClient = {
      readResource: jest.fn().mockResolvedValue({
        contents: [{ uri: 'https://example.com/path?q=1#frag', text: 'Complex content' }]
      }),
    };

    const mockManagedClient = {
      prefix: 'test-prefix',
      getClient: jest.fn().mockResolvedValue(mockClient)
    };

    // @ts-ignore
    router.managedClients.set('test-prefix', mockManagedClient);

    const request = {
      params: {
        uri: 'mcp://test-prefix/https/example.com/path?q=1#frag'
      }
    };

    const result = await readResourceHandler(request);

    expect(mockClient.readResource).toHaveBeenCalledWith({
      uri: 'https://example.com/path?q=1#frag'
    });
    expect(result.contents[0].text).toBe('Complex content');
  });
});

describe('Router Prompt Enablement Alignment', () => {
  beforeEach(() => {
    enablePackage('subpath-package');
  });

  afterEach(() => {
    enablePackage('subpath-package');
  });

  test('does not register prompts for disabled sub-path package', () => {
    const router = new Router();
    
    // Disable the package by its base package name
    disablePackage('subpath-package');

    // Register a package with a subPath
    // @ts-ignore
    router.registerPackage({
      packageName: 'subpath-package',
      subPath: 'sub-dir',
      path: '/tmp/subpath-package/sub-dir',
      manifest: {
        name: 'subpath-package-prompt',
        version: '1.0.0',
        prompts: [
          {
            name: 'my-prompt',
            file: 'prompt.md',
            description: 'My prompt'
          }
        ]
      },
      isEnabled: false
    });

    // Check if the prompt was registered in localPrompts
    // @ts-ignore
    const hasPrompt = router.localPrompts.has('subpath-package/sub-dir__my-prompt');
    expect(hasPrompt).toBe(false);
  });
});
