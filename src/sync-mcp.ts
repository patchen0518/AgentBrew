import fs from 'fs';
import os from 'os';
import path from 'path';
import * as toml from 'smol-toml';
import { Logger } from './logger';
import { loadSyncedState, saveSyncedState } from './sync-state';
import type { SkillSyncResult } from './sync';

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
