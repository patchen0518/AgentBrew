# AgentBrew 🍺
**The Universal Hub for AI Agents.**

AgentBrew is a centralized Model Context Protocol (MCP) multiplexer. Install your tools and skills once — every AI agent you use picks them up automatically.

## 💡 The Core Idea
AI developers today face a fragmentation problem: every agent (Claude Code, Gemini CLI, Cursor, etc.) has its own way of managing MCP servers, tools, and skills. Setting up your favorite tools in one agent doesn't mean you have them in another.

**AgentBrew** solves this by acting as a **Universal "USB Hub"** for MCP. You install your tools once in AgentBrew, and all your agents can instantly access that same consistent set of capabilities. If you switch agents, your entire "brew" of tools and skills comes with you.

### How Skills Work

AgentBrew exposes skills (packages containing a `SKILL.md` file) as **MCP tools**. This is the primary delivery mechanism — it works in every agent that supports MCP, with no extra setup beyond registering agentbrew as a server.

```
AI Agent (Claude, Gemini, Cursor, Windsurf…)
    │  MCP (stdio)
    ▼
AgentBrew Router
    │
    ├── Skills → MCP tools (universal, works in all agents automatically)
    │       Agent calls the tool → receives SKILL.md instructions → follows them
    │
    ├── MCP Servers → proxied to child processes (lazy-spawned)
    │
    └── Instructions → MCP resources (CLAUDE.md, GEMINI.md, .cursorrules…)
```

Running `agentbrew sync` adds a second layer on top:

| Agent | After MCP registration | After `agentbrew sync` |
|---|---|---|
| **Claude Code** | Skills as MCP tools (AI-initiated) | + `/skill-name` slash commands (user-initiated) |
| **Gemini CLI** | Skills as MCP tools | + Extension slash commands |
| **Cursor** | Skills as MCP tools (auto-registered) | No change — Cursor uses MCP natively |
| **Windsurf** | Skills as MCP tools | + Native skill slash commands |

> **Claude Code note:** After sync, Claude Code has both interfaces simultaneously. They are complementary, not duplicates:
> - `/skill-name` — you or the AI explicitly invokes the skill; SKILL.md is injected as conversation context.
> - `pkg__skill-name` MCP tool — the AI calls this autonomously mid-task without user input.
> Both read the same SKILL.md file on disk (the sync creates symlinks, not copies).

## 🚀 Key Features
- **Universal Skill Delivery:** Skills are immediately available as MCP tools in every connected agent — no sync required.
- **Lazy Loading:** Child MCP servers only start when a tool is actually called.
- **Auto-Discovery:** Automatically detects MCP servers in Node.js, Python, and Markdown projects.
- **Universal Migration:** Import your existing configurations from Gemini, Claude Code, Cursor, Codex, and Windsurf.
- **Instruction Index:** Automatically exposes per-agent instruction files (`CLAUDE.md`, `GEMINI.md`, `AGENTS.md`, `.cursorrules`, etc.) shipped inside packages as MCP resources.
- **Shared Instructions:** Write agent instructions once in `~/.agentbrew/INSTRUCTIONS.md` and push them to every agent's global config with `agentbrew sync`.
- **Native Slash Commands (optional):** `agentbrew sync` also registers skills as native slash commands in Claude Code, Gemini CLI, Windsurf, and Antigravity.

## 🛠 Installation

### 📦 Via npm Registry (Recommended)

```bash
npm install -g @patchen0518/agentbrew
```

### 🔨 Manual Development Setup

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

### First Steps

After installing AgentBrew, the recommended setup is:

```bash
# 1. Install a package
agentbrew install <github-url>

# 2. Connect your agent (see "Connecting Agents" below)
#    Skills and tools are now live in your agent as MCP capabilities.

# 3. Run sync to push shared instructions and enable native slash commands
agentbrew sync
```

Step 3 is optional but recommended — it unlocks slash command discoverability in Claude Code and Gemini CLI and lets you maintain shared instructions across all your agents.

### Installing Tools & Skills
```bash
# Install a tool or skill package from a Git URL
agentbrew install <github-url>

# Migrate from Gemini, Claude, or Cursor
agentbrew migrate
```

> **Installation failed?** If `agentbrew install` fails (missing dependencies, build errors, etc.), ask your AI agent directly:
> > *"Install `<github-url>` to agentbrew for me."*
> The agent can run the install command, read any error output, and resolve issues autonomously.

> **API keys:** If a package requires credentials to start its MCP server, discovery may fail silently at install time. AgentBrew will warn you which servers need attention. Set the required environment variables and run `agentbrew refresh` to complete setup.

### 🔑 Dedicated Credentials
For servers requiring custom credentials, configure them in the package's `agentbrew.toml` manifest file:

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

`agentbrew sync` does two things:

1. **Injects shared instructions** from `~/.agentbrew/INSTRUCTIONS.md` into every agent's global config file.
2. **Registers skills as native slash commands** in Claude Code, Gemini CLI, Windsurf, and Antigravity (in addition to the MCP tools that are already active).

**Workflow:**

```bash
# 1. First run creates an example INSTRUCTIONS.md — nothing is written yet
agentbrew sync

# 2. Edit with your shared rules (e.g. "always use Context7 before calling external APIs")
open ~/.agentbrew/INSTRUCTIONS.md

# 3. Push instructions and register slash commands in all detected agents
agentbrew sync
```

After syncing:
- A clearly-marked `AgentBrew Shared` section is injected into each agent's global config (`~/.claude/CLAUDE.md`, `~/.gemini/GEMINI.md`, `~/.codex/AGENTS.md`, etc.).
- Skills are registered as slash commands in **Claude Code** (`~/.claude/skills/`), **Gemini CLI**, **Windsurf**, and **Antigravity** via symlinks — no content is duplicated on disk.
- For **Cursor**, agentbrew is automatically registered as an MCP server in `~/.cursor/mcp.json` — no manual steps required.

```bash
# Remove all injected instructions and skill registrations
agentbrew unsync
```

> [!NOTE]
> `agentbrew sync` only writes to config files whose parent directory already exists (i.e. the agent is installed). It skips agents that aren't detected on your machine.

> **Advanced:** Claude Code users who prefer skills to be accessible only via slash commands (and not as AI-callable MCP tools) can set `"skillsAsMcpTools": false` in `~/.agentbrew/state.json`. The default is `true` — both interfaces are active.

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

# Refresh capability cache (required after manual file changes, or after setting API keys)
agentbrew refresh

# Refresh and re-run dependency installation (use after a manual git clone)
agentbrew refresh --install
```

## 🤖 Connecting Agents
Point your AI agent to launch `agentbrew` as its MCP server. Once connected, all installed tools and skills are immediately available.

- **Gemini CLI:** `gemini mcp add agentbrew agentbrew`
- **Claude Code:** `/plugin add agentbrew agentbrew`
- **Codex:** `codex mcp add agentbrew agentbrew`
- **Cursor:** Run `agentbrew sync` — agentbrew is automatically registered in `~/.cursor/mcp.json`. No manual steps required.
- **Windsurf / Antigravity:** Add agentbrew as an MCP server, then run `agentbrew sync` to also register slash commands.

After connecting, run `agentbrew sync` to enable native slash commands and shared instructions.

### Manual JSON Configuration
For agents that use a configuration file (like **Claude Desktop** or other MCP clients):

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
> If your agent cannot resolve the global `agentbrew` command (e.g., throwing a "command not found" error during startup), run via `node` directly:
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
AgentBrew uses an `mcp-manifest.json` cache in each package directory for instant startup. The **Router** acts as a dynamic proxy, spawning child MCP processes on-demand and routing requests using a scoped naming convention: `{packageName}_{serverName}__{toolName}`. The `__` (double-underscore) is the reserved routing delimiter — package and server names must never contain it.

## 📄 License
MIT
