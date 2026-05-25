# AgentBrew 🍺
*the name is inspired by homebrew*

**The Universal USB Hub for AI Agents.**

AgentBrew is a centralized Model Context Protocol (MCP) multiplexer that acts like a **physical USB Hub** for your AI agents. 

### 💡 The "USB Hub" Vision
If you use multiple AI agents (like **Claude Code**, **Gemini CLI**, and **Cursor**), you usually have to configure your tools and skills for each one separately. 

**With AgentBrew, you "plug in" your tools once, and they follow you everywhere.**

1.  **Plug In:** Use `agentbrew install` to add MCP servers or skills to your Hub.
2.  **Connect:** Point any AI agent to AgentBrew.
3.  **Portable Capabilities:** Switch from Gemini CLI to Claude Code, and all your tools, prompts, and resources are immediately available without any extra setup.

## 🚀 Key Features
- **Zero-Process Startup (Lazy Loading):** AgentBrew doesn't start your tools until your agent actually tries to use them.
- **True Portability:** Your capabilities live in AgentBrew, not in a specific agent's config file.
- **Smart Discovery:** Automatically detects MCP servers in Node.js, Python, and Markdown projects.
- **Strict Uniqueness:** Prevents tool collisions by enforcing a single version of any logical package.

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

### "Plugging In" a Package (Install)
Install any compatible tool or skill directly from a Git URL:
```bash
agentbrew install https://github.com/organization/my-awesome-tool
```

### Migrating from other Agents
If you already have MCP servers or skills configured in Gemini CLI, Claude Code, or Cursor, you can import them automatically:
```bash
agentbrew migrate
```

### Managing your Hub
```bash
# List all connected tools and their status
agentbrew list

# Refresh the capability cache (use after manual git pulls)
agentbrew refresh

# Disable a specific tool
agentbrew disable my-awesome-tool

# "Unplug" a package completely
agentbrew uninstall my-awesome-tool
```

## 🛠 Best Practices & Naming
- **Avoid Reserved Delimiters:** Package, server, and skill names must **not** contain the sequence `__`. This sequence is used by AgentBrew to route requests.
- **Skill Organization:** To prevent documentation clutter, AgentBrew only auto-loads `.md` files as prompts if they are located inside `skills/` or `prompts/` directories.
- **Instruction Files:** `GEMINI.md` and `CLAUDE.md` files are automatically registered as MCP Resources. AgentBrew provides a special prompt called `agentbrew__instruction_index` that lists all available instruction resources. You can instruct your agent to read this index to discover how to use your tools.
- **Manual Updates:** If you manually modify a package directory (e.g., by running `git pull`), you must run `agentbrew refresh` to update the capability cache.

## 🤖 Connecting your AI Agents
Configure your AI agent to launch `agentbrew` as its MCP server.

### For Gemini CLI
Add this to your configuration (usually in `~/.gemini/settings.json`):
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
- **Lazy Router:** A high-performance dynamic proxy. It reads a cached `mcp-manifest.json` at startup and only spawns child processes on-demand.
- **Smart Registry:** Automatically detects MCP entry points by analyzing dependencies and project structure.
- **Unique Installer:** Enforces strict logical naming to prevent tool collisions and simplify management.

## 📄 License
MIT
