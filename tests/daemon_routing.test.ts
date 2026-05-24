import { Daemon } from '../src/daemon';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

jest.mock("@modelcontextprotocol/sdk/server/index.js");
jest.mock("@modelcontextprotocol/sdk/client/index.js");

describe('Daemon Tool Routing', () => {
  let daemon: Daemon;
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

    daemon = new Daemon();
  });

  test('routes tool call to correct client', async () => {
    // 1. Get the CallTool handler
    const setRequestHandlerCalls = mockServerInstance.setRequestHandler.mock.calls;
    const callToolHandler = setRequestHandlerCalls.find(
      (call: any) => call[0] === CallToolRequestSchema
    )?.[1];

    expect(callToolHandler).toBeDefined();

    // 2. Setup mock clients (populating private clients map via initialization)
    const mockClient = {
      callTool: jest.fn().mockResolvedValue({
        content: [{ type: "text", text: "Success" }]
      }),
      connect: jest.fn(),
      close: jest.fn(),
    };
    
    // Inject the mock client into the private clients map
    // @ts-ignore
    daemon.clients.set('test-pkg_server1', mockClient);

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

    await expect(callToolHandler(request)).rejects.toThrow("Invalid tool name format or unknown prefix");
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

    await expect(callToolHandler(request)).rejects.toThrow("Invalid tool name format or unknown prefix");
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
    
    // Prefix is 'pkg_srv'
    // @ts-ignore
    daemon.clients.set('pkg_srv', mockClient);

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
