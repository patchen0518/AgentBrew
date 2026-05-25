import { Router } from '../src/router';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

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
