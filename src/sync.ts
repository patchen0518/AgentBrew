import fs from 'fs';
import os from 'os';
import path from 'path';
import * as toml from 'smol-toml';
import type { PackageInfo } from './registry';
import { SyncedState, loadSyncedState, saveSyncedState } from './sync-state';
import { AGENT_SKILL_REGISTRY, AgentSkillConfig } from './agent-registry';

export interface SkillEntry {
  packageName: string;
  skillName: string;
  /** Absolute path to the directory containing SKILL.md */
  skillDir: string;
  description?: string;
}

export interface SkillSyncResult {
  entryName: string;
  status: 'linked' | 'already_exists' | 'removed' | 'skipped' | 'error';
  path?: string;
  note?: string;
}

/**
 * Extracts SkillEntry objects from discovered packages by scanning for SKILL.md prompts.
 */
export function extractSkillEntries(packages: PackageInfo[]): SkillEntry[] {
  const skills: SkillEntry[] = [];
  for (const pkg of packages) {
    if (!pkg.manifest.prompts) continue;
    for (const prompt of pkg.manifest.prompts) {
      if (path.basename(prompt.file).toUpperCase() !== 'SKILL.MD') continue;
      skills.push({
        packageName: pkg.packageName,
        skillName: prompt.name,
        skillDir: path.dirname(path.resolve(pkg.path, prompt.file)),
        description: prompt.description,
      });
    }
  }
  return skills;
}

const CURSOR_SKILLS_INDEX_FILE = 'agentbrew-skills-index.md';

function symlinkSkills(
  skills: SkillEntry[],
  targetDir: string,
  state: SyncedState,
  agentKey: 'claude' | 'gemini' | 'windsurf' | 'antigravity' | 'kiro',
  brewRoot?: string
): SkillSyncResult[] {
  const results: SkillSyncResult[] = [];
  const newEntries: string[] = [];

  for (const skill of skills) {
    const entryName = `${skill.packageName}-${skill.skillName}`;
    const entryPath = path.join(targetDir, entryName);

    if (!fs.existsSync(skill.skillDir)) {
      results.push({ entryName, status: 'skipped', note: 'Source directory not found' });
      continue;
    }

    let exists = false;
    try { fs.lstatSync(entryPath); exists = true; } catch {}

    if (exists) {
      let currentTarget: string | null = null;
      try { currentTarget = fs.readlinkSync(entryPath); } catch {}

      if (currentTarget === null) {
        // Not a symlink — not created by AgentBrew, leave it alone
        results.push({ entryName, status: 'skipped', note: 'Path exists and is not a symlink' });
        continue;
      }

      if (currentTarget === skill.skillDir) {
        newEntries.push(entryName);
        results.push({ entryName, status: 'already_exists', path: entryPath });
        continue;
      }

      // Stale symlink pointing at a different target — remove and re-create
      try { fs.rmSync(entryPath, { force: true }); } catch {}
    }

    try {
      fs.symlinkSync(skill.skillDir, entryPath);
      newEntries.push(entryName);
      results.push({ entryName, status: 'linked', path: entryPath });
    } catch (e: any) {
      results.push({ entryName, status: 'error', note: e.message });
    }
  }

  state[agentKey] = [...new Set([...state[agentKey], ...newEntries])];
  saveSyncedState(state, brewRoot);
  return results;
}

function removeTrackedSymlinks(
  tracked: string[],
  skillsDir: string
): SkillSyncResult[] {
  const results: SkillSyncResult[] = [];

  for (const entryName of tracked) {
    const entryPath = path.join(skillsDir, entryName);
    let exists = false;
    try { fs.lstatSync(entryPath); exists = true; } catch {}

    if (!exists) {
      results.push({ entryName, status: 'skipped', note: 'Not found' });
      continue;
    }

    try {
      fs.rmSync(entryPath, { recursive: true, force: true });
      results.push({ entryName, status: 'removed', path: entryPath });
    } catch (e: any) {
      results.push({ entryName, status: 'error', note: e.message });
    }
  }

  return results;
}

/**
 * Generic skill sync for any agent in AGENT_SKILL_REGISTRY.
 */
export function syncSkillsToAgent(
  agent: AgentSkillConfig,
  skills: SkillEntry[],
  brewRoot?: string
): SkillSyncResult[] {
  const rootDir = agent.agentRootDir?.();
  if (rootDir && !fs.existsSync(rootDir)) return [];

  const skillsDir = agent.skillsDir();
  fs.mkdirSync(skillsDir, { recursive: true });

  const state = loadSyncedState(brewRoot);
  const results = symlinkSkills(skills, skillsDir, state, agent.key, brewRoot);

  if (results.some(r => r.status === 'linked' || r.status === 'already_exists')) {
    agent.onAfterSync?.();
  }

  return results;
}

/**
 * Generic skill unsync for any agent in AGENT_SKILL_REGISTRY.
 */
export function unsyncSkillsFromAgent(
  agent: AgentSkillConfig,
  brewRoot?: string
): SkillSyncResult[] {
  const skillsDir = agent.skillsDir();
  const state = loadSyncedState(brewRoot);
  const results = removeTrackedSymlinks(state[agent.key], skillsDir);
  state[agent.key] = [];
  saveSyncedState(state, brewRoot);
  agent.onAfterUnsync?.();
  return results;
}

// ─── Claude Code ────────────────────────────────────────────────────────────
export function syncSkillsToClaudeCode(skills: SkillEntry[], brewRoot?: string): SkillSyncResult[] {
  return syncSkillsToAgent(AGENT_SKILL_REGISTRY.find(a => a.key === 'claude')!, skills, brewRoot);
}
export function unsyncSkillsFromClaudeCode(brewRoot?: string): SkillSyncResult[] {
  return unsyncSkillsFromAgent(AGENT_SKILL_REGISTRY.find(a => a.key === 'claude')!, brewRoot);
}

// ─── Gemini CLI ───────────────────────────────────────────────────────────────
export function syncSkillsToGeminiCLI(skills: SkillEntry[], brewRoot?: string): SkillSyncResult[] {
  return syncSkillsToAgent(AGENT_SKILL_REGISTRY.find(a => a.key === 'gemini')!, skills, brewRoot);
}
export function unsyncSkillsFromGeminiCLI(brewRoot?: string): SkillSyncResult[] {
  return unsyncSkillsFromAgent(AGENT_SKILL_REGISTRY.find(a => a.key === 'gemini')!, brewRoot);
}

// ─── Windsurf ─────────────────────────────────────────────────────────────────
export function syncSkillsToWindsurf(skills: SkillEntry[], brewRoot?: string): SkillSyncResult[] {
  return syncSkillsToAgent(AGENT_SKILL_REGISTRY.find(a => a.key === 'windsurf')!, skills, brewRoot);
}
export function unsyncSkillsFromWindsurf(brewRoot?: string): SkillSyncResult[] {
  return unsyncSkillsFromAgent(AGENT_SKILL_REGISTRY.find(a => a.key === 'windsurf')!, brewRoot);
}

// ─── Antigravity CLI ──────────────────────────────────────────────────────────
export function syncSkillsToAntigravityCLI(skills: SkillEntry[], brewRoot?: string): SkillSyncResult[] {
  return syncSkillsToAgent(AGENT_SKILL_REGISTRY.find(a => a.key === 'antigravity')!, skills, brewRoot);
}
export function unsyncSkillsFromAntigravityCLI(brewRoot?: string): SkillSyncResult[] {
  return unsyncSkillsFromAgent(AGENT_SKILL_REGISTRY.find(a => a.key === 'antigravity')!, brewRoot);
}

// ─── Kiro ─────────────────────────────────────────────────────────────────────
export function syncSkillsToKiro(skills: SkillEntry[], brewRoot?: string): SkillSyncResult[] {
  return syncSkillsToAgent(AGENT_SKILL_REGISTRY.find(a => a.key === 'kiro')!, skills, brewRoot);
}
export function unsyncSkillsFromKiro(brewRoot?: string): SkillSyncResult[] {
  return unsyncSkillsFromAgent(AGENT_SKILL_REGISTRY.find(a => a.key === 'kiro')!, brewRoot);
}

// ─── Orphan cleanup ──────────────────────────────────────────────────────────

/**
 * Removes symlinks whose targets no longer exist (e.g. after a package is uninstalled).
 * Call after `agentbrew uninstall` to prevent stale entries.
 */
export function cleanOrphanSkills(brewRoot?: string): SkillSyncResult[] {
  const state = loadSyncedState(brewRoot);
  const results: SkillSyncResult[] = [];

  for (const agent of AGENT_SKILL_REGISTRY) {
    const dir = agent.skillsDir();
    const remaining: string[] = [];
    for (const entryName of state[agent.key]) {
      const entryPath = path.join(dir, entryName);
      let symlinkTarget: string | null = null;
      try { symlinkTarget = fs.readlinkSync(entryPath); } catch {}

      if (symlinkTarget !== null && !fs.existsSync(symlinkTarget)) {
        try {
          fs.rmSync(entryPath, { force: true });
          results.push({ entryName, status: 'removed', path: entryPath });
        } catch (e: any) {
          results.push({ entryName, status: 'error', note: e.message });
          remaining.push(entryName);
        }
      } else {
        remaining.push(entryName);
      }
    }
    state[agent.key] = remaining;
  }

  // Handle Cursor index file: parse referenced SKILL.md paths and remove the file if any are stale
  if (state.cursor) {
    const indexPath = path.join(os.homedir(), '.cursor', 'rules', CURSOR_SKILLS_INDEX_FILE);
    let indexContent: string | null = null;
    try { indexContent = fs.readFileSync(indexPath, 'utf-8'); } catch {}

    if (indexContent === null) {
      state.cursor = false;
    } else {
      const pathMatches = [...indexContent.matchAll(/`([^`]+SKILL\.md)`/gi)];
      const hasStalePath = pathMatches.some(m => !fs.existsSync(m[1]));
      if (hasStalePath) {
        try {
          fs.rmSync(indexPath, { force: true });
          state.cursor = false;
          results.push({ entryName: CURSOR_SKILLS_INDEX_FILE, status: 'removed', path: indexPath });
        } catch (e: any) {
          results.push({ entryName: CURSOR_SKILLS_INDEX_FILE, status: 'error', note: e.message });
        }
      }
    }
  }

  if (state.codexMcp) {
    const codexConfig = path.join(os.homedir(), '.codex', 'config.toml');
    let codexEntryPresent = false;
    try {
      const raw = fs.readFileSync(codexConfig, 'utf-8');
      codexEntryPresent = (toml.parse(raw) as any)?.mcp_servers?.agentbrew?.command === 'agentbrew';
    } catch {}
    if (!codexEntryPresent) state.codexMcp = false;
  }

  if (state.kiroMcp) {
    const kiroConfig = path.join(os.homedir(), '.kiro', 'settings', 'mcp.json');
    let kiroEntryPresent = false;
    try {
      kiroEntryPresent = JSON.parse(fs.readFileSync(kiroConfig, 'utf-8'))?.mcpServers?.agentbrew?.command === 'agentbrew';
    } catch {}
    if (!kiroEntryPresent) state.kiroMcp = false;
  }

  saveSyncedState(state, brewRoot);
  return results;
}

// ─── Cursor ──────────────────────────────────────────────────────────────────

function buildCursorSkillsIndex(skills: SkillEntry[]): string {
  const lines = [
    '---',
    'description: AgentBrew skills index — reference when asked about available skills, tools, or capabilities',
    'alwaysApply: false',
    '---',
    '<!-- Managed by AgentBrew. Run `agentbrew sync` to update. Do not edit manually. -->',
    '',
    '# AgentBrew Skills',
    '',
    'Skills installed via AgentBrew. Read a SKILL.md file to learn how to invoke it.',
    '',
  ];
  for (const skill of skills) {
    const desc = skill.description ? ` — ${skill.description}` : '';
    lines.push(`- **${skill.packageName}/${skill.skillName}**${desc}: \`${path.join(skill.skillDir, 'SKILL.md')}\``);
  }
  return lines.join('\n') + '\n';
}

/**
 * Writes a single skills index file to ~/.cursor/rules/agentbrew-skills-index.md
 * listing all AgentBrew skills with paths for on-demand discovery.
 * Does NOT copy individual SKILL.md files — Cursor rules are always-on context.
 */
export function syncSkillsToCursor(skills: SkillEntry[], brewRoot?: string): SkillSyncResult[] {
  const cursorDir = path.join(os.homedir(), '.cursor');
  if (!fs.existsSync(cursorDir)) return [];
  if (skills.length === 0) return unsyncSkillsFromCursor(brewRoot);

  const rulesDir = path.join(cursorDir, 'rules');
  fs.mkdirSync(rulesDir, { recursive: true });

  const indexPath = path.join(rulesDir, CURSOR_SKILLS_INDEX_FILE);
  const content = buildCursorSkillsIndex(skills);
  const state = loadSyncedState(brewRoot);

  try {
    fs.writeFileSync(indexPath, content, 'utf-8');
    state.cursor = true;
    saveSyncedState(state, brewRoot);
    return [{ entryName: CURSOR_SKILLS_INDEX_FILE, status: 'linked', path: indexPath }];
  } catch (e: any) {
    return [{ entryName: CURSOR_SKILLS_INDEX_FILE, status: 'error', note: e.message }];
  }
}

/**
 * Removes the AgentBrew skills index file from ~/.cursor/rules/.
 */
export function unsyncSkillsFromCursor(brewRoot?: string): SkillSyncResult[] {
  const state = loadSyncedState(brewRoot);
  if (!state.cursor) return [];

  const indexPath = path.join(os.homedir(), '.cursor', 'rules', CURSOR_SKILLS_INDEX_FILE);

  let exists = false;
  try { fs.lstatSync(indexPath); exists = true; } catch {}

  if (!exists) {
    state.cursor = false;
    saveSyncedState(state, brewRoot);
    return [{ entryName: CURSOR_SKILLS_INDEX_FILE, status: 'skipped', note: 'Not found' }];
  }

  try {
    fs.rmSync(indexPath, { force: true });
    state.cursor = false;
    saveSyncedState(state, brewRoot);
    return [{ entryName: CURSOR_SKILLS_INDEX_FILE, status: 'removed', path: indexPath }];
  } catch (e: any) {
    return [{ entryName: CURSOR_SKILLS_INDEX_FILE, status: 'error', note: e.message }];
  }
}

// ─── MCP registration ────────────────────────────────────────────────────────
export {
  syncMcpServerToCursor, unsyncMcpServerFromCursor,
  syncMcpServerToCodex, unsyncMcpServerFromCodex,
  syncMcpServerToKiro, unsyncMcpServerFromKiro,
} from './sync-mcp';

// ─── Instruction sync ────────────────────────────────────────────────────────
export {
  MARKER_START, MARKER_END, INSTRUCTIONS_FILE,
  AgentTarget, SyncResult,
  getDefaultTargets, getInstructionsPath, buildInjectedSection,
  injectIntoFile, removeFromFile,
  syncInstructions, unsyncInstructions,
} from './sync-instructions';
