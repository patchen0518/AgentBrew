// src/state.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

const BREW_ROOT = path.join(os.homedir(), '.agentbrew');
const STATE_FILE = path.join(BREW_ROOT, 'state.json');

export interface AgentBrewState {
  disabledPackages: string[];
}

export function loadState(): AgentBrewState {
  if (!fs.existsSync(STATE_FILE)) {
    return { disabledPackages: [] };
  }
  try {
    const data = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(data) as AgentBrewState;
  } catch (err) {
    return { disabledPackages: [] };
  }
}

export function saveState(state: AgentBrewState) {
  if (!fs.existsSync(BREW_ROOT)) {
    fs.mkdirSync(BREW_ROOT, { recursive: true });
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

export function enablePackage(pkgName: string) {
  const state = loadState();
  if (state.disabledPackages.includes(pkgName)) {
    state.disabledPackages = state.disabledPackages.filter(p => p !== pkgName);
    saveState(state);
    return true;
  }
  return false; // already enabled
}

export function disablePackage(pkgName: string) {
  const state = loadState();
  if (!state.disabledPackages.includes(pkgName)) {
    state.disabledPackages.push(pkgName);
    saveState(state);
    return true;
  }
  return false; // already disabled
}

export function isPackageEnabled(pkgName: string): boolean {
  const state = loadState();
  return !state.disabledPackages.includes(pkgName);
}
