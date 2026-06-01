import fs from 'fs';
import path from 'path';
import { getBrewRoot } from './config';

export const SYNCED_SKILLS_FILE = 'synced-skills.json';

export interface SyncedState {
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

export function getSyncedSkillsPath(brewRoot?: string): string {
  return path.join(brewRoot ?? getBrewRoot(), SYNCED_SKILLS_FILE);
}

export function loadSyncedState(brewRoot?: string): SyncedState {
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

export function saveSyncedState(state: SyncedState, brewRoot?: string) {
  const p = getSyncedSkillsPath(brewRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf-8');
}
