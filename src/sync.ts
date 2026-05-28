import fs from 'fs';
import os from 'os';
import path from 'path';
import { getBrewRoot } from './config';

export const MARKER_START = '<!-- agentbrew:shared:start -->';
export const MARKER_END = '<!-- agentbrew:shared:end -->';
export const INSTRUCTIONS_FILE = 'INSTRUCTIONS.md';

const EXAMPLE_INSTRUCTIONS = `# AgentBrew Shared Instructions

These instructions are shared across all your AI agents via AgentBrew.
Edit this file and run \`agentbrew sync\` to push updates to all agent configs.

## Example: API Usage Policy
- Always use Context7 (the \`context7\` MCP tool) to fetch live API documentation
  before writing code that calls an external library. This prevents using stale or
  hallucinated function signatures.

## Notes
- This file is global. For project-specific context, add it directly to the
  project's CLAUDE.md or GEMINI.md — or reference project docs from within this file.
`;

export interface AgentTarget {
  name: string;
  /** Absolute path to the agent's global config file. null = UI-managed; print manual instructions instead. */
  configPath: string | null;
  /** When true, agentbrew owns the entire file (no markers needed; overwrite entirely). */
  isFileOwned: boolean;
  /** Shown in sync output when configPath is null. */
  manualInstructions?: string;
}

export function getDefaultTargets(): AgentTarget[] {
  const home = os.homedir();
  return [
    {
      name: 'Claude Code',
      configPath: path.join(home, '.claude', 'CLAUDE.md'),
      isFileOwned: false,
    },
    {
      name: 'Gemini CLI',
      configPath: path.join(home, '.gemini', 'GEMINI.md'),
      isFileOwned: false,
    },
    {
      name: 'OpenAI Codex CLI',
      // Codex CLI's canonical instruction file is AGENTS.md (instructions.md is a legacy fallback)
      configPath: path.join(home, '.codex', 'AGENTS.md'),
      isFileOwned: false,
    },
    {
      name: 'Cursor',
      // Cursor "User Rules" directory (Cursor 0.47+): each .md file in this dir is a global rule.
      // We own this specific file entirely — no markers needed.
      configPath: path.join(home, '.cursor', 'rules', 'agentbrew-shared.md'),
      isFileOwned: true,
    },
    {
      name: 'Windsurf',
      configPath: path.join(home, '.codeium', 'windsurf', 'memories', 'global_rules.md'),
      isFileOwned: false,
    },
  ];
}

export function getInstructionsPath(brewRoot?: string): string {
  return path.join(brewRoot ?? getBrewRoot(), INSTRUCTIONS_FILE);
}

export function buildInjectedSection(content: string): string {
  const warning = `> ⚠️ Managed by AgentBrew. Edit \`~/.agentbrew/INSTRUCTIONS.md\` and run \`agentbrew sync\` to update.`;
  return `${MARKER_START}\n${warning}\n\n${content.trim()}\n${MARKER_END}`;
}

/**
 * Injects (or updates) the agentbrew section in a file.
 * Creates the file and any parent directories if they don't exist.
 */
export function injectIntoFile(filePath: string, content: string): 'created' | 'updated' | 'unchanged' {
  const section = buildInjectedSection(content);

  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, section + '\n', 'utf-8');
    return 'created';
  }

  const existing = fs.readFileSync(filePath, 'utf-8');
  const startIdx = existing.indexOf(MARKER_START);
  const endIdx = existing.indexOf(MARKER_END);

  if (startIdx !== -1 && endIdx !== -1) {
    const replaced =
      existing.substring(0, startIdx) +
      section +
      existing.substring(endIdx + MARKER_END.length);
    if (replaced === existing) return 'unchanged';
    fs.writeFileSync(filePath, replaced, 'utf-8');
    return 'updated';
  }

  // No markers yet — append to end
  const appended = existing.trimEnd() + '\n\n' + section + '\n';
  fs.writeFileSync(filePath, appended, 'utf-8');
  return 'updated';
}

/**
 * Removes the agentbrew section from a file, leaving surrounding content intact.
 */
export function removeFromFile(filePath: string): 'removed' | 'not_found' | 'no_section' {
  if (!fs.existsSync(filePath)) return 'not_found';

  const existing = fs.readFileSync(filePath, 'utf-8');
  const startIdx = existing.indexOf(MARKER_START);
  const endIdx = existing.indexOf(MARKER_END);

  if (startIdx === -1 || endIdx === -1) return 'no_section';

  const before = existing.substring(0, startIdx).trimEnd();
  const after = existing.substring(endIdx + MARKER_END.length).trimStart();

  let result = before;
  if (after) result += '\n\n' + after;
  result = result.trimEnd() + '\n';

  fs.writeFileSync(filePath, result, 'utf-8');
  return 'removed';
}

export interface SyncResult {
  agent: string;
  status: 'created' | 'updated' | 'unchanged' | 'skipped' | 'manual' | 'removed' | 'not_found' | 'no_section';
  path?: string;
  note?: string;
}

/**
 * Syncs ~/.agentbrew/INSTRUCTIONS.md into each target agent's global config file.
 * Accepts an optional `targets` override (used in tests).
 */
export function syncInstructions(targets?: AgentTarget[], brewRoot?: string): SyncResult[] {
  const instructionsPath = getInstructionsPath(brewRoot);

  if (!fs.existsSync(instructionsPath)) {
    fs.mkdirSync(path.dirname(instructionsPath), { recursive: true });
    fs.writeFileSync(instructionsPath, EXAMPLE_INSTRUCTIONS, 'utf-8');
    return [];
  }

  const content = fs.readFileSync(instructionsPath, 'utf-8');
  const resolvedTargets = targets ?? getDefaultTargets();
  const results: SyncResult[] = [];

  for (const target of resolvedTargets) {
    if (target.configPath === null) {
      results.push({ agent: target.name, status: 'manual', note: target.manualInstructions });
      continue;
    }

    if (target.isFileOwned) {
      // We own this file entirely — write raw content, no markers needed.
      // unsync deletes the file; there is no surrounding user content to delimit around.
      const header = `> ⚠️ Managed by AgentBrew. Edit \`~/.agentbrew/INSTRUCTIONS.md\` and run \`agentbrew sync\` to update.\n`;
      const fileContent = header + '\n' + content.trim() + '\n';
      fs.mkdirSync(path.dirname(target.configPath), { recursive: true });
      const existing = fs.existsSync(target.configPath)
        ? fs.readFileSync(target.configPath, 'utf-8')
        : null;
      if (existing === fileContent) {
        results.push({ agent: target.name, status: 'unchanged', path: target.configPath });
      } else {
        fs.writeFileSync(target.configPath, fileContent, 'utf-8');
        results.push({ agent: target.name, status: existing !== null ? 'updated' : 'created', path: target.configPath });
      }
      continue;
    }

    // Skip agents that aren't installed (config parent dir absent)
    if (!fs.existsSync(path.dirname(target.configPath))) {
      results.push({ agent: target.name, status: 'skipped', note: 'Agent not installed (config directory not found)' });
      continue;
    }

    const status = injectIntoFile(target.configPath, content);
    results.push({ agent: target.name, status, path: target.configPath });
  }

  return results;
}

/**
 * Removes the agentbrew section from all target agent config files.
 */
export function unsyncInstructions(targets?: AgentTarget[]): SyncResult[] {
  const resolvedTargets = targets ?? getDefaultTargets();
  const results: SyncResult[] = [];

  for (const target of resolvedTargets) {
    if (target.configPath === null) {
      results.push({ agent: target.name, status: 'manual', note: 'Remove manually from your agent UI settings.' });
      continue;
    }

    if (target.isFileOwned) {
      if (fs.existsSync(target.configPath)) {
        fs.rmSync(target.configPath);
        results.push({ agent: target.name, status: 'removed', path: target.configPath });
      } else {
        results.push({ agent: target.name, status: 'not_found', path: target.configPath });
      }
      continue;
    }

    const status = removeFromFile(target.configPath);
    results.push({ agent: target.name, status, path: target.configPath });
  }

  return results;
}
