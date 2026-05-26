---
description: "Enable, disable, or uninstall AgentBrew packages and capabilities."
---

# AgentBrew Manage Skill

Use this skill to manage the state of your installed tools.

## Usage Guidelines

- **Enabling:** Use `agentbrew enable <packageName> [capability]` to activate a package or a specific tool within it.
- **Disabling:** Use `agentbrew disable <packageName> [capability]` to temporarily deactivate a package or tool.
- **Uninstalling:** Use `agentbrew uninstall <packageName> [capability]` to permanently remove a package or specific capability.

## Commands

```bash
agentbrew enable <packageName> [capability]
agentbrew disable <packageName> [capability]
agentbrew uninstall <packageName> [capability]
```
