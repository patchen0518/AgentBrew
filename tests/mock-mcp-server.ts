// tests/mock-mcp-server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "mock-server", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "echo", description: "Echoes input", inputSchema: { type: "object", properties: { msg: { type: "string" } } } }]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "echo") {
      return { content: [{ type: "text", text: (request.params.arguments?.msg as string) || "hello" }] };
  }
  throw new Error("Tool not found");
});

const transport = new StdioServerTransport();
server.connect(transport);
