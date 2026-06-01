import fs from 'fs';
import os from 'os';
import path from 'path';
import packageJson from '../package.json';
import { Logger } from './logger';

const AGENTBREW_EXTENSION_NAME = 'agentbrew';

export interface AgentSkillConfig {
  /** Key in SyncedState */
  key: 'claude' | 'gemini' | 'windsurf' | 'antigravity' | 'kiro';
  /** Human-readable label for CLI output */
  label: string;
  /** Absolute path to the skills directory where symlinks are placed */
  skillsDir: () => string;
  /**
   * If set, only proceed when this root directory exists (agent is installed).
   */
  agentRootDir?: () => string;
  /**
   * Called after skills are successfully symlinked.
   * Used for agents needing extra setup (e.g. Gemini extension manifest).
   */
  onAfterSync?: () => void;
  /**
   * Called after skills are unlinked.
   * Used for agents needing cleanup (e.g. Gemini extension teardown).
   */
  onAfterUnsync?: () => void;
}

function enableGeminiExtension(geminiDir: string): void {
  const enablementPath = path.join(geminiDir, 'extensions', 'extension-enablement.json');
  let data: Record<string, any> = {};
  try { data = JSON.parse(fs.readFileSync(enablementPath, 'utf-8')); } catch (e: any) {
    if (e.code !== 'ENOENT') Logger.warn(`Could not read/update extension-enablement.json: ${e.message}`);
  }
  if (!data[AGENTBREW_EXTENSION_NAME]) {
    data[AGENTBREW_EXTENSION_NAME] = { overrides: [`${os.homedir()}/*`] };
    fs.writeFileSync(enablementPath, JSON.stringify(data, null, 2), 'utf-8');
  }
}

function disableGeminiExtension(geminiDir: string): void {
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
  } catch (e: any) {
    if (e.code !== 'ENOENT') Logger.warn(`Could not read/update extension-enablement.json: ${e.message}`);
  }
}

export const AGENT_SKILL_REGISTRY: AgentSkillConfig[] = [
  {
    key: 'claude',
    label: 'Claude Code',
    skillsDir: () => path.join(os.homedir(), '.claude', 'skills'),
    agentRootDir: () => path.join(os.homedir(), '.claude'),
  },
  {
    key: 'gemini',
    label: 'Gemini CLI',
    skillsDir: () => path.join(os.homedir(), '.gemini', 'extensions', AGENTBREW_EXTENSION_NAME, 'skills'),
    agentRootDir: () => path.join(os.homedir(), '.gemini'),
    onAfterSync: () => {
      const extensionDir = path.join(os.homedir(), '.gemini', 'extensions', AGENTBREW_EXTENSION_NAME);
      fs.writeFileSync(
        path.join(extensionDir, 'gemini-extension.json'),
        JSON.stringify({ name: AGENTBREW_EXTENSION_NAME, version: packageJson.version }, null, 2),
        'utf-8'
      );
      enableGeminiExtension(path.join(os.homedir(), '.gemini'));
    },
    onAfterUnsync: () => {
      const geminiDir = path.join(os.homedir(), '.gemini');
      const extensionDir = path.join(geminiDir, 'extensions', AGENTBREW_EXTENSION_NAME);
      try { fs.rmSync(path.join(extensionDir, 'gemini-extension.json'), { force: true }); } catch {}
      try { fs.rmdirSync(path.join(extensionDir, 'skills')); } catch {}
      try { fs.rmdirSync(extensionDir); } catch {}
      disableGeminiExtension(geminiDir);
    },
  },
  {
    key: 'windsurf',
    label: 'Windsurf',
    skillsDir: () => path.join(os.homedir(), '.codeium', 'windsurf', 'skills'),
    agentRootDir: () => path.join(os.homedir(), '.codeium', 'windsurf'),
  },
  {
    key: 'antigravity',
    label: 'Antigravity CLI',
    skillsDir: () => path.join(os.homedir(), '.gemini', 'antigravity-cli', 'skills'),
    agentRootDir: () => path.join(os.homedir(), '.gemini', 'antigravity-cli'),
  },
  {
    key: 'kiro',
    label: 'Kiro',
    skillsDir: () => path.join(os.homedir(), '.kiro', 'skills'),
    agentRootDir: () => path.join(os.homedir(), '.kiro'),
  },
];
