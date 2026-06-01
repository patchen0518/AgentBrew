import fs from 'fs';
import os from 'os';
import path from 'path';
import * as toml from 'smol-toml';
import { getBrewRoot } from './config';
import { Logger } from './logger';
import type { PackageInfo } from './registry';
import packageJson from '../package.json';

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

const SYNCED_SKILLS_FILE = 'synced-skills.json';
const AGENTBREW_EXTENSION_NAME = 'agentbrew';
const CURSOR_SKILLS_INDEX_FILE = 'agentbrew-skills-index.md';

interface SyncedState {
  claude: string[];
  gemini: string[];
  windsurf: string[];
  cursor: boolean;
  cursorMcp: boolean;
  antigravity: string[];
  codexMcp: boolean;
  kiro: string[];
  kiroMcp: boolean;
}

function getSyncedSkillsPath(brewRoot?: string): string {
  return path.join(brewRoot ?? getBrewRoot(), SYNCED_SKILLS_FILE);
}

function loadSyncedState(brewRoot?: string): SyncedState {
  try {
    const raw = JSON.parse(fs.readFileSync(getSyncedSkillsPath(brewRoot), 'utf-8'));
    // Migrate old flat format: { skills: [...] } → { claude: [...] }
    if (raw.skills && !raw.claude) {
      return { claude: raw.skills, gemini: [], windsurf: [], cursor: false, cursorMcp: false, antigravity: [], codexMcp: false, kiro: [], kiroMcp: false };
    }
    return {
      claude: raw.claude ?? [],
      gemini: raw.gemini ?? [],
      windsurf: raw.windsurf ?? [],
      cursor: raw.cursor ?? false,
      cursorMcp: raw.cursorMcp ?? false,
      antigravity: raw.antigravity ?? [],
      codexMcp: raw.codexMcp ?? false,
      kiro: raw.kiro ?? [],
      kiroMcp: raw.kiroMcp ?? false,
    };
  } catch {
    return { claude: [], gemini: [], windsurf: [], cursor: false, cursorMcp: false, antigravity: [], codexMcp: false, kiro: [], kiroMcp: false };
  }
}

function saveSyncedState(state: SyncedState, brewRoot?: string) {
  const p = getSyncedSkillsPath(brewRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf-8');
}

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

// ─── Cursor MCP server registration ─────────────────────────────────────────

const CURSOR_MCP_ENTRY = 'agentbrew';

/**
 * Adds agentbrew to ~/.cursor/mcp.json so Cursor can discover MCP tools directly.
 * Merges into any existing config without disturbing other servers.
 */
export function syncMcpServerToCursor(brewRoot?: string): SkillSyncResult[] {
  const cursorDir = path.join(os.homedir(), '.cursor');
  if (!fs.existsSync(cursorDir)) return [];

  const mcpJsonPath = path.join(cursorDir, 'mcp.json');
  const entryName = 'agentbrew (Cursor MCP)';

  let config: Record<string, any> = {};
  try { config = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8')); } catch {}

  const mcpServers: Record<string, any> = config.mcpServers ?? {};
  const existing = mcpServers[CURSOR_MCP_ENTRY];
  if (existing?.command === 'agentbrew') {
    const state = loadSyncedState(brewRoot);
    state.cursorMcp = true;
    saveSyncedState(state, brewRoot);
    return [{ entryName, status: 'already_exists', path: mcpJsonPath }];
  }

  config.mcpServers = { ...mcpServers, [CURSOR_MCP_ENTRY]: { command: 'agentbrew' } };
  try {
    fs.writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2), 'utf-8');
    const state = loadSyncedState(brewRoot);
    state.cursorMcp = true;
    saveSyncedState(state, brewRoot);
    return [{ entryName, status: 'linked', path: mcpJsonPath }];
  } catch (e: any) {
    return [{ entryName, status: 'error', note: e.message }];
  }
}

/**
 * Removes the agentbrew entry from ~/.cursor/mcp.json.
 * Leaves other servers intact; removes the file only if it becomes empty.
 */
export function unsyncMcpServerFromCursor(brewRoot?: string): SkillSyncResult[] {
  const state = loadSyncedState(brewRoot);
  if (!state.cursorMcp) return [];

  const mcpJsonPath = path.join(os.homedir(), '.cursor', 'mcp.json');
  const entryName = 'agentbrew (Cursor MCP)';

  let config: Record<string, any> = {};
  try { config = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8')); } catch {
    state.cursorMcp = false;
    saveSyncedState(state, brewRoot);
    return [{ entryName, status: 'skipped', note: 'Not found' }];
  }

  if (!config.mcpServers?.[CURSOR_MCP_ENTRY]) {
    state.cursorMcp = false;
    saveSyncedState(state, brewRoot);
    return [{ entryName, status: 'skipped', note: 'Not found' }];
  }

  delete config.mcpServers[CURSOR_MCP_ENTRY];
  if (Object.keys(config.mcpServers).length === 0) delete config.mcpServers;

  try {
    if (Object.keys(config).length === 0) {
      fs.rmSync(mcpJsonPath, { force: true });
    } else {
      fs.writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2), 'utf-8');
    }
    state.cursorMcp = false;
    saveSyncedState(state, brewRoot);
    return [{ entryName, status: 'removed', path: mcpJsonPath }];
  } catch (e: any) {
    return [{ entryName, status: 'error', note: e.message }];
  }
}

// ─── Codex MCP server registration ──────────────────────────────────────────

function _removeTomlSection(content: string, sectionHeader: string): string {
  const lines = content.split('\n');
  const headerLine = `[${sectionHeader}]`;
  const subHeaderPrefix = `[${sectionHeader}.`;
  const startIdx = lines.findIndex(l => l.trim() === headerLine);
  if (startIdx === -1) return content;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Stop at sibling or parent sections, but continue through subsections of this section
    if (trimmed.startsWith('[') && !trimmed.startsWith(subHeaderPrefix)) { endIdx = i; break; }
  }

  // Also absorb a preceding blank line
  let removeFrom = startIdx;
  if (removeFrom > 0 && lines[removeFrom - 1].trim() === '') removeFrom--;

  return [...lines.slice(0, removeFrom), ...lines.slice(endIdx)].join('\n');
}

/**
 * Adds agentbrew to ~/.codex/config.toml so Codex CLI can discover MCP tools directly.
 * Appends the [mcp_servers.agentbrew] section without disturbing existing content.
 */
export function syncMcpServerToCodex(brewRoot?: string): SkillSyncResult[] {
  const codexDir = path.join(os.homedir(), '.codex');
  if (!fs.existsSync(codexDir)) return [];

  const configPath = path.join(codexDir, 'config.toml');
  const entryName = 'agentbrew (Codex MCP)';

  let raw = '';
  try { raw = fs.readFileSync(configPath, 'utf-8'); } catch {}

  // Check if already registered with the right command
  try {
    const parsed = toml.parse(raw) as any;
    if (parsed?.mcp_servers?.agentbrew?.command === 'agentbrew') {
      const state = loadSyncedState(brewRoot);
      state.codexMcp = true;
      saveSyncedState(state, brewRoot);
      return [{ entryName, status: 'already_exists', path: configPath }];
    }
  } catch (e: any) {
    Logger.warn(`config.toml at ${configPath} has invalid TOML syntax: ${e.message}. Attempting text-based repair.`);
  }

  // Remove any stale entry (e.g. wrong command) before re-adding to avoid duplicate TOML table headers
  const cleaned = _removeTomlSection(raw, 'mcp_servers.agentbrew');
  const sep = cleaned.length > 0 && !cleaned.endsWith('\n') ? '\n' : '';
  const newContent = cleaned + sep + '\n[mcp_servers.agentbrew]\ncommand = "agentbrew"\n';

  try {
    fs.writeFileSync(configPath, newContent, 'utf-8');
    const state = loadSyncedState(brewRoot);
    state.codexMcp = true;
    saveSyncedState(state, brewRoot);
    return [{ entryName, status: 'linked', path: configPath }];
  } catch (e: any) {
    return [{ entryName, status: 'error', note: e.message }];
  }
}

/**
 * Removes the agentbrew entry from ~/.codex/config.toml.
 * Leaves the file in place; other sections are untouched.
 */
export function unsyncMcpServerFromCodex(brewRoot?: string): SkillSyncResult[] {
  const state = loadSyncedState(brewRoot);
  if (!state.codexMcp) return [];

  const configPath = path.join(os.homedir(), '.codex', 'config.toml');
  const entryName = 'agentbrew (Codex MCP)';

  let raw: string;
  try { raw = fs.readFileSync(configPath, 'utf-8'); } catch {
    state.codexMcp = false;
    saveSyncedState(state, brewRoot);
    return [{ entryName, status: 'skipped', note: 'Not found' }];
  }

  const cleaned = _removeTomlSection(raw, 'mcp_servers.agentbrew');
  if (cleaned === raw) {
    state.codexMcp = false;
    saveSyncedState(state, brewRoot);
    return [{ entryName, status: 'skipped', note: 'Not found' }];
  }

  try {
    const trimmed = cleaned.trimEnd();
    fs.writeFileSync(configPath, trimmed ? trimmed + '\n' : '', 'utf-8');
    state.codexMcp = false;
    saveSyncedState(state, brewRoot);
    return [{ entryName, status: 'removed', path: configPath }];
  } catch (e: any) {
    return [{ entryName, status: 'error', note: e.message }];
  }
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

// ─── Kiro MCP server registration ────────────────────────────────────────────

const KIRO_MCP_ENTRY = 'agentbrew';

/**
 * Adds agentbrew to ~/.kiro/settings/mcp.json so Kiro can discover MCP tools directly.
 * Merges into any existing config without disturbing other servers.
 */
export function syncMcpServerToKiro(brewRoot?: string): SkillSyncResult[] {
  const kiroDir = path.join(os.homedir(), '.kiro');
  if (!fs.existsSync(kiroDir)) return [];

  const settingsDir = path.join(kiroDir, 'settings');
  fs.mkdirSync(settingsDir, { recursive: true });

  const mcpJsonPath = path.join(settingsDir, 'mcp.json');
  const entryName = 'agentbrew (Kiro MCP)';

  let config: Record<string, any> = {};
  try { config = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8')); } catch {}

  const mcpServers: Record<string, any> = config.mcpServers ?? {};
  const existing = mcpServers[KIRO_MCP_ENTRY];
  if (existing?.command === 'agentbrew') {
    const state = loadSyncedState(brewRoot);
    state.kiroMcp = true;
    saveSyncedState(state, brewRoot);
    return [{ entryName, status: 'already_exists', path: mcpJsonPath }];
  }

  config.mcpServers = { ...mcpServers, [KIRO_MCP_ENTRY]: { command: 'agentbrew' } };
  try {
    fs.writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2), 'utf-8');
    const state = loadSyncedState(brewRoot);
    state.kiroMcp = true;
    saveSyncedState(state, brewRoot);
    return [{ entryName, status: 'linked', path: mcpJsonPath }];
  } catch (e: any) {
    return [{ entryName, status: 'error', note: e.message }];
  }
}

/**
 * Removes the agentbrew entry from ~/.kiro/settings/mcp.json.
 * Leaves other servers intact; removes the file only if it becomes empty.
 */
export function unsyncMcpServerFromKiro(brewRoot?: string): SkillSyncResult[] {
  const state = loadSyncedState(brewRoot);
  if (!state.kiroMcp) return [];

  const mcpJsonPath = path.join(os.homedir(), '.kiro', 'settings', 'mcp.json');
  const entryName = 'agentbrew (Kiro MCP)';

  let config: Record<string, any> = {};
  try { config = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8')); } catch {
    state.kiroMcp = false;
    saveSyncedState(state, brewRoot);
    return [{ entryName, status: 'skipped', note: 'Not found' }];
  }

  if (!config.mcpServers?.[KIRO_MCP_ENTRY]) {
    state.kiroMcp = false;
    saveSyncedState(state, brewRoot);
    return [{ entryName, status: 'skipped', note: 'Not found' }];
  }

  delete config.mcpServers[KIRO_MCP_ENTRY];
  if (Object.keys(config.mcpServers).length === 0) delete config.mcpServers;

  try {
    if (Object.keys(config).length === 0) {
      fs.rmSync(mcpJsonPath, { force: true });
    } else {
      fs.writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2), 'utf-8');
    }
    state.kiroMcp = false;
    saveSyncedState(state, brewRoot);
    return [{ entryName, status: 'removed', path: mcpJsonPath }];
  } catch (e: any) {
    return [{ entryName, status: 'error', note: e.message }];
  }
}

// ─── Instruction sync (unchanged) ───────────────────────────────────────────

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
  /**
   * Optional YAML/text block prepended verbatim at the very start of owned files.
   * Used for agents that require frontmatter before any other content (e.g. Kiro steering files).
   */
  frontmatter?: string;
  /**
   * For isFileOwned targets, the top-level agent directory to check for existence before
   * creating the config file. If the directory doesn't exist, the target is skipped (agent
   * not installed). Without this, agentbrew would create the directory and file unconditionally.
   */
  agentRootDir?: string;
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
      agentRootDir: path.join(home, '.cursor'),
    },
    {
      name: 'Windsurf',
      configPath: path.join(home, '.codeium', 'windsurf', 'memories', 'global_rules.md'),
      isFileOwned: false,
    },
    {
      name: 'Kiro',
      // Steering files in ~/.kiro/steering/ are auto-loaded in every Kiro interaction.
      // We own this file entirely and must place the frontmatter at the very top.
      configPath: path.join(home, '.kiro', 'steering', 'agentbrew-shared.md'),
      isFileOwned: true,
      frontmatter: '---\ninclusion: always\n---',
      agentRootDir: path.join(home, '.kiro'),
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
      // Skip if the agent's root directory doesn't exist (agent not installed).
      // Without this guard, mkdirSync below would create the directory unconditionally.
      if (target.agentRootDir && !fs.existsSync(target.agentRootDir)) {
        results.push({ agent: target.name, status: 'skipped', note: 'Agent not installed (config directory not found)' });
        continue;
      }

      // We own this file entirely — write raw content, no markers needed.
      // unsync deletes the file; there is no surrounding user content to delimit around.
      const header = `> ⚠️ Managed by AgentBrew. Edit \`~/.agentbrew/INSTRUCTIONS.md\` and run \`agentbrew sync\` to update.\n`;
      const prefix = target.frontmatter ? target.frontmatter + '\n' : '';
      const fileContent = prefix + header + '\n' + content.trim() + '\n';
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
