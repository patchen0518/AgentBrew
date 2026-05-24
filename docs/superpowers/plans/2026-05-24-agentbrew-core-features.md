# agentbrew Core Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transition `agentbrew` to a functional MCP router with dependency management and recursive discovery.

**Architecture:** Post-install dependency resolution in Installer; Recursive discovery in Registry; Dynamic MCP Client Proxying in Daemon.

**Tech Stack:** Node.js, TypeScript, `@modelcontextprotocol/sdk`.

---

### Task 1: Setup and Mock Server for Testing

**Files:**
- Create: `tests/mock-mcp-server.ts`
- Create: `tests/integration.test.ts`

- [ ] **Step 1: Create a mock MCP server for testing**

```typescript
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
```

- [ ] **Step 2: Create a basic integration test file**

```typescript
// tests/integration.test.ts
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('Integration', () => {
    const TEST_HOME = path.join(os.tmpdir(), 'agentbrew-test-' + Date.now());
    
    beforeAll(() => {
        fs.mkdirSync(TEST_HOME, { recursive: true });
        execSync('npm run build');
    });

    afterAll(() => {
        fs.rmSync(TEST_HOME, { recursive: true, force: true });
    });

    test('placeholder for integration', () => {
        expect(true).toBe(true);
    });
});
```

- [ ] **Step 3: Commit**

```bash
git add tests/mock-mcp-server.ts tests/integration.test.ts
git commit -m "test: add mock mcp server and integration test skeleton"
```

---

### Task 2: Installer - Dependency Resolution

**Files:**
- Modify: `src/installer.ts`

- [ ] **Step 1: Add dependency resolution logic to `installPackage`**

```typescript
// src/installer.ts (modify)
import { execSync } from 'child_process';
// ... existing imports

export async function installPackage(url: string) {
  // ... existing clone logic
  
  // New: Post-install dependency resolution
  resolveDependencies(targetPath);
  
  return targetPath;
}

function resolveDependencies(pkgPath: string) {
  console.log(`Resolving dependencies in ${pkgPath}...`);
  if (fs.existsSync(path.join(pkgPath, 'pnpm-lock.yaml'))) {
    execSync('pnpm install', { cwd: pkgPath, stdio: 'inherit' });
  } else if (fs.existsSync(path.join(pkgPath, 'package.json'))) {
    execSync('npm install', { cwd: pkgPath, stdio: 'inherit' });
    const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgPath, 'package.json'), 'utf-8'));
    if (pkgJson.scripts?.build) {
        console.log("Running build script...");
        execSync('npm run build', { cwd: pkgPath, stdio: 'inherit' });
    }
  } else if (fs.existsSync(path.join(pkgPath, 'requirements.txt'))) {
    execSync('pip install -r requirements.txt', { cwd: pkgPath, stdio: 'inherit' });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/installer.ts
git commit -m "feat: add dependency resolution to installer"
```

---

### Task 3: Registry - Recursive Discovery & Improved Auto-detection

**Files:**
- Modify: `src/registry.ts`

- [ ] **Step 1: Update `discoverPackages` to be recursive**

```typescript
// src/registry.ts (modify)
export function discoverPackages(includeDisabled = false): PackageInfo[] {
  if (!fs.existsSync(PACKAGES_DIR)) return [];

  const packages: PackageInfo[] = [];
  const rootDirs = fs.readdirSync(PACKAGES_DIR);

  for (const rootDir of rootDirs) {
    const rootPath = path.join(PACKAGES_DIR, rootDir);
    if (!fs.statSync(rootPath).isDirectory()) continue;

    // Recursive search up to 2 levels
    const manifests = findManifests(rootPath, 2);
    for (const manifestInfo of manifests) {
        const isEnabled = isPackageEnabled(manifestInfo.manifest.name);
        if (isEnabled || includeDisabled) {
            packages.push({ path: manifestInfo.path, manifest: manifestInfo.manifest, isEnabled });
        }
    }
  }

  return packages;
}

function findManifests(currentPath: string, depth: number): { path: string, manifest: PackageManifest }[] {
    const results: { path: string, manifest: PackageManifest }[] = [];
    
    // Check current dir
    const manifestPath = path.join(currentPath, 'agentbrew.toml');
    const packageJsonPath = path.join(currentPath, 'package.json');
    
    if (fs.existsSync(manifestPath)) {
        const content = fs.readFileSync(manifestPath, 'utf-8');
        results.push({ path: currentPath, manifest: toml.parse(content) as any });
    } else if (fs.existsSync(packageJsonPath)) {
        results.push({ path: currentPath, manifest: autoDetectManifest(currentPath) });
    }

    if (depth > 0) {
        const subdirs = fs.readdirSync(currentPath).filter(f => fs.statSync(path.join(currentPath, f)).isDirectory() && f !== 'node_modules' && !f.startsWith('.'));
        for (const subdir of subdirs) {
            results.push(...findManifests(path.join(currentPath, subdir), depth - 1));
        }
    }
    
    return results;
}
```

- [ ] **Step 2: Improve `autoDetectManifest` for `bin` entries**

```typescript
// src/registry.ts (modify autoDetectManifest)
function autoDetectManifest(pkgPath: string): PackageManifest {
  // ... existing logic
  if (fs.existsSync(packageJsonPath)) {
    // ... 
    if (pkgJson.bin) {
        const binName = typeof pkgJson.bin === 'string' ? pkgJson.name : Object.keys(pkgJson.bin)[0];
        const binPath = typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin[binName];
        manifest.servers = [{
            name: binName,
            command: 'node',
            args: [binPath]
        }];
    } else if (pkgJson.scripts?.start) {
      // ...
    }
  }
  // ...
  return manifest;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/registry.ts
git commit -m "feat: recursive package discovery and improved auto-detection"
```

---

### Task 4: Daemon - Dynamic MCP Client Proxying (Startup & Discovery)

**Files:**
- Modify: `src/daemon.ts`

- [ ] **Step 1: Add MCP Client management to `Daemon` class**

```typescript
// src/daemon.ts (modify)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export class Daemon {
  private clients: Map<string, Client> = new Map();
  // ...

  private async initializePackage(pkg: PackageInfo) {
    if (pkg.manifest.servers) {
      for (const server of pkg.manifest.servers) {
        const transport = new StdioClientTransport({
          command: server.command,
          args: server.args,
          stderr: 'inherit',
          cwd: pkg.path
        });
        const client = new Client({ name: "agentbrew-client", version: "1.0.0" }, { capabilities: {} });
        await client.connect(transport);
        this.clients.set(`${pkg.manifest.name}_${server.name}`, client);
      }
    }
  }
}
```

- [ ] **Step 2: Implement dynamic `tools/list` handler**

```typescript
// src/daemon.ts (modify setupMcpHandlers)
    this.mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
      const allTools = [];
      for (const [prefix, client] of this.clients) {
        const response = await client.listTools();
        for (const tool of response.tools) {
            allTools.push({
                ...tool,
                name: `${prefix}_${tool.name}`
            });
        }
      }
      return { tools: allTools };
    });
```

- [ ] **Step 3: Commit**

```bash
git add src/daemon.ts
git commit -m "feat: dynamic mcp client proxying for tool discovery"
```

---

### Task 5: Daemon - Tool Routing (Call Tool)

**Files:**
- Modify: `src/daemon.ts`

- [ ] **Step 1: Implement dynamic `tools/call` handler**

```typescript
// src/daemon.ts (modify setupMcpHandlers)
    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const fullName = request.params.name;
      const separatorIndex = fullName.lastIndexOf('_');
      if (separatorIndex === -1) throw new Error("Invalid tool name format");
      
      const prefix = fullName.substring(0, separatorIndex);
      const toolName = fullName.substring(separatorIndex + 1);
      
      const client = this.clients.get(prefix);
      if (!client) throw new Error(`No client found for prefix: ${prefix}`);
      
      return await client.callTool({
          name: toolName,
          arguments: request.params.arguments
      });
    });
```

- [ ] **Step 2: Commit**

```bash
git add src/daemon.ts
git commit -m "feat: dynamic mcp tool call routing"
```

---

### Task 6: Final Integration Test & Cleanup

**Files:**
- Modify: `tests/integration.test.ts`

- [ ] **Step 1: Implement full integration test**

```typescript
// tests/integration.test.ts (modify)
// ... test logic to install mock server, start daemon in background, and call tools/list/call
```

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration.test.ts
git commit -m "test: complete integration test"
```
