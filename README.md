# AgentBrew 🍺
**The Universal Hub for AI Agents.**

AgentBrew is a centralized Model Context Protocol (MCP) multiplexer. It allows you to configure your tools once and use them across all your AI agents (Claude Code, Gemini CLI, Cursor, etc.).

## 💡 The Core Idea
AI developers today face a fragmentation problem: every agent (Claude Code, Gemini CLI, Cursor, etc.) has its own way of managing MCP servers, tools, and skills. Setting up your favorite tools in one agent doesn't mean you have them in another.

**AgentBrew** solves this by acting as a **Universal "USB Hub"** for MCP. You install your tools once in AgentBrew, and all your agents can instantly access that same consistent set of capabilities. If you switch agents, your entire "brew" of tools and skills comes with you.

## 🚀 Key Features
- **Lazy Loading:** Servers only start when a tool is actually called.
- **Auto-Discovery:** Automatically detects MCP servers in Node.js, Python, and Markdown projects.
- **Universal Migration:** Import your existing configurations from Gemini, Claude Code, and Cursor.
- **Instruction Index:** Automatically exposes `GEMINI.md` and `CLAUDE.md` files as resources for your agents.

## 🛠 Installation

```bash
# Clone and enter the repo
git clone https://github.com/patchen0518/AgentBrew.git
cd AgentBrew

# Install and build
npm install
npm run build

# Link globally
npm link
```

## 📖 Usage

### Plugging In Tools
```bash
# Install a tool from a Git URL
agentbrew install <github-url>

# Migrate from Gemini, Claude, or Cursor
agentbrew migrate

# Manually link a local command
# (Internal use or custom scripts)
```

### Managing the Hub
```bash
# List all tools, prompts, and resources
agentbrew list

# Enable/Disable a package
agentbrew enable <package-name>
agentbrew disable <package-name>

# Uninstall a package
agentbrew uninstall <package-name>

# Update a specific package or all packages
agentbrew update <package-name>
agentbrew update --all

# Refresh capability cache (required after manual file changes)
agentbrew refresh
```

## 🤖 Connecting Agents
Point your AI agent to launch `agentbrew` as its MCP server.

- **Gemini CLI:** `gemini mcp add agentbrew agentbrew`
- **Claude Code:** `/plugin add agentbrew agentbrew`
- **Cursor:** Add a new "command" type MCP server in settings with command `agentbrew`.

### Manual JSON Configuration
For agents that use a configuration file (like **Claude Desktop** or other MCP clients), add AgentBrew to your config JSON:

**File Paths:**
- **Claude Desktop (macOS):** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop (Windows):** `%APPDATA%\Claude\claude_desktop_config.json`

**Configuration:**
```json
{
  "mcpServers": {
    "agentbrew": {
      "command": "agentbrew"
    }
  }
}
```

## 🏗 Architecture
AgentBrew uses an `mcp-manifest.json` cache in each package directory to enable instant startup. The **Router** acts as a dynamic proxy, spawning child MCP processes on-demand and routing requests using a `prefix__name` convention.

## 📄 License
MIT
