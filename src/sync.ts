import fs from 'fs';
import os from 'os';
import path from 'path';
import * as toml from 'smol-toml';
import { Logger } from './logger';
import type { PackageInfo } from './registry';
import packageJson from '../package.json';
import { SyncedState, loadSyncedState, saveSyncedState } from './sync-state';

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

const AGENTBREW_EXTENSION_NAME = 'agentbrew';
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

// ─── Claude Code ────────────────────────────────────────────────────────────

/**
 * Symlinks each skill directory into ~/.claude/skills/<pkgName>-<skillName>
 * so Claude Code can discover them as invocable skills.
 */
export function syncSkillsToClaudeCode(skills: SkillEntry[], brewRoot?: string): SkillSyncResult[] {
  const claudeDir = path.join(os.homedir(), '.claude');
  if (!fs.existsSync(claudeDir)) return [];

  const skillsDir = path.join(claudeDir, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const state = loadSyncedState(brewRoot);
  return symlinkSkills(skills, skillsDir, state, 'claude', brewRoot);
}

/**
 * Removes all skill symlinks previously created by syncSkillsToClaudeCode.
 */
export function unsyncSkillsFromClaudeCode(brewRoot?: string): SkillSyncResult[] {
  const skillsDir = path.join(os.homedir(), '.claude', 'skills');
  const state = loadSyncedState(brewRoot);
  const results = removeTrackedSymlinks(state.claude, skillsDir);
  state.claude = [];
  saveSyncedState(state, brewRoot);
  return results;
}

// ─── Gemini CLI ──────────────────────────────────────────────────────────────

/**
 * Registers skills with Gemini CLI by creating an agentbrew extension at
 * ~/.gemini/extensions/agentbrew/ and symlinking each skill's directory into
 * ~/.gemini/extensions/agentbrew/skills/<pkgName>-<skillName>.
 */
export function syncSkillsToGeminiCLI(skills: SkillEntry[], brewRoot?: string): SkillSyncResult[] {
  const geminiDir = path.join(os.homedir(), '.gemini');
  if (!fs.existsSync(geminiDir)) return [];

  const extensionDir = path.join(geminiDir, 'extensions', AGENTBREW_EXTENSION_NAME);
  const skillsDir = path.join(extensionDir, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  // Write extension manifest (we own this file)
  const manifestPath = path.join(extensionDir, 'gemini-extension.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ name: AGENTBREW_EXTENSION_NAME, version: packageJson.version }, null, 2),
    'utf-8'
  );

  // Enable extension in extension-enablement.json
  _enableGeminiExtension(geminiDir);

  const state = loadSyncedState(brewRoot);
  return symlinkSkills(skills, skillsDir, state, 'gemini', brewRoot);
}

/**
 * Removes Gemini CLI skill symlinks, the extension manifest, and the
 * agentbrew extension entry from extension-enablement.json.
 */
export function unsyncSkillsFromGeminiCLI(brewRoot?: string): SkillSyncResult[] {
  const geminiDir = path.join(os.homedir(), '.gemini');
  const extensionDir = path.join(geminiDir, 'extensions', AGENTBREW_EXTENSION_NAME);
  const skillsDir = path.join(extensionDir, 'skills');

  const state = loadSyncedState(brewRoot);
  const results = removeTrackedSymlinks(state.gemini, skillsDir);

  // Clean up extension dir (best-effort; ignores non-empty)
  try { fs.rmSync(path.join(extensionDir, 'gemini-extension.json'), { force: true }); } catch {}
  try { fs.rmdirSync(skillsDir); } catch {}
  try { fs.rmdirSync(extensionDir); } catch {}

  _disableGeminiExtension(geminiDir);

  state.gemini = [];
  saveSyncedState(state, brewRoot);
  return results;
}

function _enableGeminiExtension(geminiDir: string) {
  const enablementPath = path.join(geminiDir, 'extensions', 'extension-enablement.json');
  let data: Record<string, any> = {};
  try { data = JSON.parse(fs.readFileSync(enablementPath, 'utf-8')); } catch {}
  if (!data[AGENTBREW_EXTENSION_NAME]) {
    data[AGENTBREW_EXTENSION_NAME] = { overrides: [`${os.homedir()}/*`] };
    fs.writeFileSync(enablementPath, JSON.stringify(data, null, 2), 'utf-8');
  }
}

function _disableGeminiExtension(geminiDir: string) {
  const enablementPath = path.join(geminiDir, 'extensions', 'extension-enablement.json');
  try {
    const data = JSON.parse(fs.readFileSync(enablementPath, 'utf-8'));
    if (AGENTBREW_EXTENSION_NAME in data) {
      delete data[AGENTBREW_EXTENSION_NAME];
      if (Object.keys(data).length === 0) {
        fs.rmSync(enablementPath, { force: true });
      } else {
        fs.writeFileSync(enablementPath, JSON.stringify(data, null, 2), 'utf-8');
      }
    }
  } catch {}
}

// ─── Windsurf ────────────────────────────────────────────────────────────────

/**
 * Symlinks each skill directory into ~/.codeium/windsurf/skills/<pkgName>-<skillName>
 * so Windsurf can discover them.
 */
export function syncSkillsToWindsurf(skills: SkillEntry[], brewRoot?: string): SkillSyncResult[] {
  const windsurfDir = path.join(os.homedir(), '.codeium', 'windsurf');
  if (!fs.existsSync(windsurfDir)) return [];

  const skillsDir = path.join(windsurfDir, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const state = loadSyncedState(brewRoot);
  return symlinkSkills(skills, skillsDir, state, 'windsurf', brewRoot);
}

/**
 * Removes all Windsurf skill symlinks previously created by syncSkillsToWindsurf.
 */
export function unsyncSkillsFromWindsurf(brewRoot?: string): SkillSyncResult[] {
  const skillsDir = path.join(os.homedir(), '.codeium', 'windsurf', 'skills');
  const state = loadSyncedState(brewRoot);
  const results = removeTrackedSymlinks(state.windsurf, skillsDir);
  state.windsurf = [];
  saveSyncedState(state, brewRoot);
  return results;
}

// ─── Antigravity CLI ─────────────────────────────────────────────────────────

/**
 * Symlinks each skill directory into ~/.gemini/antigravity-cli/skills/<pkgName>-<skillName>
 * so Antigravity CLI can auto-discover them.
 */
export function syncSkillsToAntigravityCLI(skills: SkillEntry[], brewRoot?: string): SkillSyncResult[] {
  const antigravityDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
  if (!fs.existsSync(antigravityDir)) return [];

  const skillsDir = path.join(antigravityDir, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const state = loadSyncedState(brewRoot);
  return symlinkSkills(skills, skillsDir, state, 'antigravity', brewRoot);
}

/**
 * Removes all Antigravity CLI skill symlinks previously created by syncSkillsToAntigravityCLI.
 */
export function unsyncSkillsFromAntigravityCLI(brewRoot?: string): SkillSyncResult[] {
  const skillsDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'skills');
  const state = loadSyncedState(brewRoot);
  const results = removeTrackedSymlinks(state.antigravity, skillsDir);
  state.antigravity = [];
  saveSyncedState(state, brewRoot);
  return results;
}

// ─── Orphan cleanup ──────────────────────────────────────────────────────────

/**
 * Removes symlinks whose targets no longer exist (e.g. after a package is uninstalled).
 * Call after `agentbrew uninstall` to prevent stale entries.
 */
export function cleanOrphanSkills(brewRoot?: string): SkillSyncResult[] {
  const state = loadSyncedState(brewRoot);
  const results: SkillSyncResult[] = [];

  const agentDirs: Array<{ key: 'claude' | 'gemini' | 'windsurf' | 'antigravity' | 'kiro'; dir: string }> = [
    { key: 'claude',      dir: path.join(os.homedir(), '.claude', 'skills') },
    { key: 'gemini',      dir: path.join(os.homedir(), '.gemini', 'extensions', AGENTBREW_EXTENSION_NAME, 'skills') },
    { key: 'windsurf',    dir: path.join(os.homedir(), '.codeium', 'windsurf', 'skills') },
    { key: 'antigravity', dir: path.join(os.homedir(), '.gemini', 'antigravity-cli', 'skills') },
    { key: 'kiro',        dir: path.join(os.homedir(), '.kiro', 'skills') },
  ];

  for (const { key, dir } of agentDirs) {
    const remaining: string[] = [];
    for (const entryName of state[key]) {
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
    state[key] = remaining;
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

// ─── Kiro ────────────────────────────────────────────────────────────────────

/**
 * Symlinks each skill directory into ~/.kiro/skills/<pkgName>-<skillName>
 * so Kiro can discover them as invocable skills.
 */
export function syncSkillsToKiro(skills: SkillEntry[], brewRoot?: string): SkillSyncResult[] {
  const kiroDir = path.join(os.homedir(), '.kiro');
  if (!fs.existsSync(kiroDir)) return [];

  const skillsDir = path.join(kiroDir, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const state = loadSyncedState(brewRoot);
  return symlinkSkills(skills, skillsDir, state, 'kiro', brewRoot);
}

/**
 * Removes all Kiro skill symlinks previously created by syncSkillsToKiro.
 */
export function unsyncSkillsFromKiro(brewRoot?: string): SkillSyncResult[] {
  const skillsDir = path.join(os.homedir(), '.kiro', 'skills');
  const state = loadSyncedState(brewRoot);
  const results = removeTrackedSymlinks(state.kiro, skillsDir);
  state.kiro = [];
  saveSyncedState(state, brewRoot);
  return results;
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
