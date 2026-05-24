# AgentBrew 🍺

**Universal Package Manager & MCP Multiplexer for AI Agents.**

AgentBrew solves the fragmentation in the AI agent ecosystem by acting as a single, unified bridge between different AI agents (like Claude Code, Gemini CLI, or Codex) and their tools, MCP servers, and skills.

## 🚀 The Problem
Every AI agent currently has its own way of installing and managing plugins, skills, and tools. This makes it difficult for developers to share their tools across different platforms and for users to manage a coherent set of capabilities for their agents.

## 🍺 The Solution: AgentBrew
AgentBrew acts as a **Universal Translator**. You install your tools and skills into AgentBrew once, and they instantly become available to *all* your connected agents through a single Model Context Protocol (MCP) endpoint.

- **Polyglot Support:** Automatically detects and manages Node.js MCP servers, Python scripts, and Markdown skills.
- **Process Supervision:** AgentBrew runs as a background daemon, monitoring tool health and automatically restarting crashed processes.
- **Centralized Management:** A single CLI to `install`, `uninstall`, and `list` all your agent capabilities.
- **MCP Router:** A unified multiplexer that routes messages from your agent to the correct underlying tool.

## 🛠 Installation

*(Note: Currently in development)*

```bash
# Clone the repository
git clone https://github.com/patchen0518/AgentBrew.git
cd AgentBrew

# Install dependencies
npm install

# Build the project
npm run build
```

## 📖 Usage

### Installing a Package
You can install any compatible tool directly from a Git URL:
```bash
agentbrew install https://github.com/organization/my-awesome-tool
```

### Starting the Daemon
The background daemon manages your tools and exposes the MCP endpoint:
```bash
agentbrew daemon start
```

## 🏗 Architecture
- **CLI:** User-facing tool for package management.
- **Daemon:** Background process that supervises child tools and routes MCP traffic.
- **Registry:** Auto-detection engine that understands how to run polyglot packages with or without an `agentbrew.toml` manifest.

## 📄 License
ISC
