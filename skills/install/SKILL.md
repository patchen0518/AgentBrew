---
description: "Install new MCP tools and packages from Git URLs or migrate from other platforms."
---

# AgentBrew Install Skill

Use this skill to expand your capabilities by installing new tools or migrating existing configurations into AgentBrew.

## Usage Guidelines

- **Installing from URL:** When a user provides a GitHub or Git URL for an MCP server, use `agentbrew install <url>`.
- **Migration:** If the user wants to bring in tools from Gemini CLI, Claude Code, or Cursor, use `agentbrew migrate`. 
- **Dry Run:** You can use `agentbrew migrate --dry-run` to see what would be migrated without making changes.

## Commands

```bash
agentbrew install <url>
agentbrew migrate [--dry-run]
```
