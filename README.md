# AgentBrew 🍺

**Universal Package Manager & MCP Multiplexer for AI Agents.**

AgentBrew solves the fragmentation in the AI agent ecosystem by acting as a single, unified bridge between different AI agents (like Claude Code, Gemini CLI, or Codex) and their tools, MCP servers, and skills.

## 🚀 The Problem
Every AI agent currently has its own way of installing and managing plugins, skills, and tools. This makes it difficult for developers to share their tools across different platforms and for users to manage a coherent set of capabilities for their agents.

## 🍺 The Solution: AgentBrew
AgentBrew acts as a **Universal Translator**. You install your tools and skills into AgentBrew once, and they instantly become available to *all* your connected agents through a single Model Context Protocol (MCP) endpoint.

- **Zero Configuration:** AgentBrew is designed to be spawned automatically by your AI agent. No background daemons to manage.
- **Automatic Dependency Management:** Clones repos and automatically runs `npm install`, `pnpm install`, or `pip install` (into a local virtual environment).
- **Monorepo & Recursive Support:** Automatically discovers MCP servers nested deep within repositories (e.g., in `packages/` or `src/mcp-servers/`).
- **Dynamic MCP Proxying:** Proxies all calls to sub-servers in real-time, handling tool name collisions and providing a unified interface.
- **Polyglot Support:** Detects Node.js servers, Python projects (with isolated venvs), and Markdown skills.
- **Enable/Disable:** Easily toggle specific tools or skills without uninstalling them.
- **Centralized Management:** A single CLI to `install`, `uninstall`, `list`, `enable`, and `disable` all your agent capabilities.

## 🛠 Installation

```bash
# Clone the repository
git clone https://github.com/patchen0518/AgentBrew.git
cd AgentBrew

# Install dependencies
npm install

# Build the project
npm run build

# Link the command globally
npm link
```

## 📖 Usage

### Installing a Package
Install any compatible tool or skill directly from a Git URL:
```bash
agentbrew install https://github.com/organization/my-awesome-tool
```

### Managing Packages
```bash
# List all installed packages and their status
agentbrew list

# Disable a specific tool
agentbrew disable my-awesome-tool

# Re-enable a tool
agentbrew enable my-awesome-tool

# Completely remove a package
agentbrew uninstall my-awesome-tool
```

## 🤖 Connecting your AI Agents
AgentBrew uses a JIT (Just-In-Time) execution model. You don't need to start it manually. Instead, configure your AI agent to launch `agentbrew` as its MCP server.

### For Gemini CLI
Add this to your configuration:
```json
"mcpServers": {
  "agentbrew": {
    "command": "agentbrew"
  }
}
```

### For Claude Code
Run the following command:
```bash
/plugin add agentbrew agentbrew
```

## 🏗 Architecture
- **CLI:** A single entry point for both human management and machine communication.
- **Installer:** Handles cloning and isolated dependency resolution (`npm`, `pnpm`, `pip` + `venv`).
- **Registry:** Recursively discovers `agentbrew.toml` or `package.json` files up to 2 levels deep to support monorepos.
- **State Manager:** Remembers your enabled/disabled preferences in `~/.agentbrew/state.json`.
- **MCP Multiplexer:** A dynamic proxy that connects to multiple child MCP servers via Stdio and aggregates their tools into a single, unified interface.

## 📄 License
ISC
