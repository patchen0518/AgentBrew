# AgentBrew 🍺
**The Universal Hub for AI Agents.**

AgentBrew is a centralized Model Context Protocol (MCP) multiplexer. It allows you to configure your tools once and use them across all your AI agents (Claude Code, Gemini CLI, Cursor, etc.).

## 💡 The Core Idea
AI developers today face a fragmentation problem: every agent (Claude Code, Gemini CLI, Cursor, etc.) has its own way of managing MCP servers, tools, and skills. Setting up your favorite tools in one agent doesn't mean you have them in another.

**AgentBrew** solves this by acting as a **Universal "USB Hub"** for MCP. You install your tools once in AgentBrew, and all your agents can instantly access that same consistent set of capabilities. If you switch agents, your entire "brew" of tools and skills comes with you.

### Data Flow

```
AI Agent (Claude, Gemini, Cursor)
    │  stdio
    ▼
Router (src/router.ts)          ← MCP server exposed to agents
    │
    ├── CapabilityDispatch (src/dispatcher.ts)
    │       Prefixes all names/URIs: "pkgName_serverName__toolName"
    │       Serves local prompts (Markdown files) and resources (CLAUDE.md / GEMINI.md)
    │
    └── ManagedClient[] (one per child server)
            Lazy-spawned child process via stdio
            Auto-retries on crash (3 attempts, exponential backoff)
```

## 🚀 Key Features
- **Lazy Loading:** Servers only start when a tool is actually called.
- **Auto-Discovery:** Automatically detects MCP servers in Node.js, Python, and Markdown projects.
- **Universal Migration:** Import your existing configurations from Gemini, Claude Code, Cursor, Codex, and Windsurf.
- **Instruction Index:** Automatically exposes per-agent instruction files (`CLAUDE.md`, `GEMINI.md`, `AGENTS.md`, `.cursorrules`, etc.) shipped inside packages as MCP resources.
- **Shared Instructions:** Write agent instructions once in `~/.agentbrew/INSTRUCTIONS.md` and sync them to every agent's global config with a single command.
- **Skill Sync:** Registers `SKILL.md`-based slash commands from installed packages directly into Claude Code, Gemini CLI, Windsurf, and Antigravity. For Cursor, automatically wires agentbrew as an MCP server so all skills are available as native tools.

## 🛠 Installation

### 📦 Via npm Registry (Recommended)

You can install AgentBrew globally with a single command:

```bash
npm install -g @patchen0518/agentbrew
```

### 🔨 Manual Development Setup

If you are developing or contributing to AgentBrew, you can clone and build the repository locally:

```bash
# Clone and enter the repo
git clone https://github.com/patchen0518/AgentBrew.git
cd AgentBrew

# Install dependencies and build
npm install
npm run build

# Link the local build globally
npm link
```


## 📖 Usage

### Plugging In Tools
```bash
# Install a tool from a Git URL
agentbrew install <github-url>
```

```bash
# Migrate from Gemini, Claude, or Cursor
agentbrew migrate

# Manually link a local command
# (Internal use or custom scripts)
```

### 🔑 Dedicated Credentials
For servers requiring custom or dedicated credentials, you can configure them directly in the package's `agentbrew.toml` manifest file inside the package folder:

```toml
# ~/.agentbrew/packages/linked-custom-server/agentbrew.toml
[[servers]]
name = "custom-server"
command = "node"
args = ["index.js"]
[servers.env]
API_TOKEN = "your-secret-token-here"
```


### 📝 Shared Instructions & Skill Sync

`agentbrew sync` does two things in a single command:

1. **Injects shared instructions** from `~/.agentbrew/INSTRUCTIONS.md` into every agent's global config file.
2. **Registers skills** from installed packages as native slash commands (or MCP tools for Cursor).

**Workflow:**

```bash
# 1. First run creates an example INSTRUCTIONS.md and exits — nothing is written yet
agentbrew sync

# 2. Edit the file with your shared rules
#    (e.g. "always use Context7 before calling external APIs")
open ~/.agentbrew/INSTRUCTIONS.md

# 3. Push instructions and skills to all detected agents
agentbrew sync
```

After syncing:
- A clearly-marked `AgentBrew Shared` section is injected into each agent's global config (`~/.claude/CLAUDE.md`, `~/.gemini/GEMINI.md`, `~/.codex/AGENTS.md`, etc.).
- `SKILL.md`-based skills from installed packages are registered as slash commands in **Claude Code** (`~/.claude/skills/`), **Gemini CLI**, **Windsurf**, and **Antigravity**.
- For **Cursor**, agentbrew is automatically registered as an MCP server in `~/.cursor/mcp.json` so all skills and tools appear natively — no manual configuration needed.

The injected instruction section is managed by AgentBrew and will never touch content outside its markers. Skill entries are tracked in `~/.agentbrew/synced-skills.json` so `agentbrew unsync` can clean them up precisely.

```bash
# Remove all injected instructions and skill registrations
agentbrew unsync
```

> [!NOTE]
> `agentbrew sync` only writes to config files whose parent directory already exists (i.e. the agent is installed). It skips agents that aren't detected on your machine.

### Managing the Hub
```bash
# List all tools, prompts, and resources
agentbrew list

# List with tool/prompt/resource counts from the capability cache
agentbrew list --verbose

# Enable/Disable a package or a specific capability
agentbrew enable <package-name>
agentbrew enable <package-name> <capability>
agentbrew disable <package-name>
agentbrew disable <package-name> <capability>

# Uninstall a package or a specific capability (cache is auto-refreshed)
agentbrew uninstall <package-name>
agentbrew uninstall <package-name> <capability>

# Update a specific package or all packages
agentbrew update <package-name>
agentbrew update --all

# Refresh capability cache (required after manual file changes)
agentbrew refresh

# Refresh and re-run dependency installation (use after a manual git clone)
agentbrew refresh --install
```

## 🤖 Connecting Agents
Point your AI agent to launch `agentbrew` as its MCP server.

- **Gemini CLI:** `gemini mcp add agentbrew agentbrew`
- **Claude Code:** `/plugin add agentbrew agentbrew`
- **Codex:** `codex mcp add agentbrew agentbrew`
- **Cursor:** Run `agentbrew sync` — agentbrew is automatically registered in `~/.cursor/mcp.json`. No manual steps required.
- **Windsurf / Antigravity:** Run `agentbrew sync` to register skills as slash commands.

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

> [!TIP]
> **Path Resolution Fallback:**
> If your agent cannot resolve the global `agentbrew` command (e.g., throwing a "command not found" or "executable not found" error during startup), you can configure the server to run via `node` directly using the absolute path to your compiled `cli.js` file:
>
> ```json
> {
>   "mcpServers": {
>     "agentbrew": {
>       "command": "node",
>       "args": ["/absolute/path/to/AgentBrew/dist/cli.js"]
>     }
>   }
> }
> ```

## 🏗 Architecture
AgentBrew uses an `mcp-manifest.json` cache in each package directory to enable instant startup. The **Router** acts as a dynamic proxy, spawning child MCP processes on-demand and routing requests using a scoped naming convention: `{packageName}_{serverName}__{toolName}`. The `__` (double-underscore) is the reserved routing delimiter — package and server names must never contain it.

## 📄 License
MIT
