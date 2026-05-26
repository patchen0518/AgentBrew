---
description: "List all installed AgentBrew packages, MCP servers, and skills."
---

# AgentBrew List Skill

Use this skill to understand what tools are currently available in the AgentBrew hub.

## Usage Guidelines

- **General Listing:** Use `agentbrew list` to see all installed packages and their status (Enabled/Disabled).
- **Filtering:** Use `agentbrew list <packageName>` to see details for a specific package.
- **Refresh:** If you have manually edited configuration files and need to update the capability cache, use `agentbrew refresh`.

## Commands

```bash
agentbrew list [packageName]
agentbrew refresh
```
