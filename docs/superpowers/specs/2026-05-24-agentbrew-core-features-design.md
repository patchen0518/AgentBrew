# Design Spec: agentbrew Core Features (Tracer Bullet)

**Date:** 2026-05-24
**Status:** Draft
**Topic:** Implementing dependency management, recursive discovery, and dynamic MCP proxying.

## 1. Overview
The goal is to transition `agentbrew` from a skeletal prototype to a functional "Tracer Bullet" that can install, discover, and route MCP tools from external repositories like `JuliusBrussee/caveman` and `upstash/context7`.

## 2. Architecture & Components

### 2.1. Installer (`src/installer.ts`)
*   **New Feature:** Post-install dependency resolution.
*   **Logic:**
    *   Detect package manager files (`package.json`, `pnpm-lock.yaml`, `requirements.txt`).
    *   Execute corresponding install command (`npm install`, `pnpm install`, `pip install -r requirements.txt`).
    *   Add a `build` step if a build script is detected in `package.json`.

### 2.2. Registry & Discovery (`src/registry.ts`)
*   **New Feature:** Recursive discovery and improved auto-detection.
*   **Logic:**
    *   Search for `agentbrew.toml` or `package.json` up to 2 levels deep within each folder in `~/.agentbrew/packages/`.
    *   Support monorepos by identifying multiple servers within a single cloned repository.
    *   Improve `autoDetectManifest` to handle `bin` entries in `package.json` as potential server entry points.

### 2.3. Daemon & Routing (`src/daemon.ts`)
*   **New Feature:** Dynamic MCP Client Proxying.
*   **Logic:**
    *   **Startup:** For every discovered server, spawn the process and initialize an `@modelcontextprotocol/sdk` `Client` using `StdioClientTransport`.
    *   **Tool Discovery:** When `agentbrew` receive a `tools/list` request, it will:
        1. Query all child MCP clients for their tools.
        2. Aggregate tools into a single list.
        3. Prefix tool names: `pkgName_toolName` (e.g., `caveman_shrink`).
    *   **Tool Execution:** When `tools/call` is received:
        1. Identify the package and tool from the prefixed name.
        2. Forward the call (with the prefix removed) to the corresponding child client.
        3. Return the child's response to the original caller.

## 3. Data Flow
1. **User** runs `agentbrew install <url>`.
2. **Installer** clones, runs `npm install`, then returns.
3. **User** (or agent) runs `agentbrew` (starts daemon).
4. **Daemon** spawns child servers, connects MCP clients.
5. **Agent** calls `tools/list` on `agentbrew`.
6. **Daemon** proxies calls to children, aggregates, and returns.

## 4. Error Handling
*   **Spawn Failures:** Log errors if a child server fails to start or crashes.
*   **Timeout:** Implement a timeout for child MCP requests to prevent the router from hanging.
*   **Missing Dependencies:** Provide clear error messages if required tools (like `pnpm` or `pip`) are missing on the host system.

## 5. Testing Strategy
*   **Integration Tests:** Create a mock MCP server (simple Node script) and verify that `agentbrew` can install it from a local path and route tool calls correctly.
*   **Unit Tests:** Update `registry.test.ts` to verify recursive discovery logic.
