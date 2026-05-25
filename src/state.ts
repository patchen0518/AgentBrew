// src/state.ts
import fs from 'fs';
import { getBrewRoot, getStateFile } from './config';

export interface AgentBrewState {
  disabledPackages: string[];
}

export function loadState(): AgentBrewState {
  const stateFile = getStateFile();
  if (!fs.existsSync(stateFile)) {
    return { disabledPackages: [] };
  }
  try {
    const data = fs.readFileSync(stateFile, 'utf-8');
    return JSON.parse(data) as AgentBrewState;
  } catch (err) {
    return { disabledPackages: [] };
  }
}

export function saveState(state: AgentBrewState) {
  const brewRoot = getBrewRoot();
  const stateFile = getStateFile();
  if (!fs.existsSync(brewRoot)) {
    fs.mkdirSync(brewRoot, { recursive: true });
  }
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
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

export function isPackageEnabled(pkgName: string, capabilityName?: string): boolean {
  const state = loadState();
  if (state.disabledPackages.includes(pkgName)) {
    return false;
  }
  if (capabilityName && state.disabledPackages.includes(`${pkgName}:${capabilityName}`)) {
    return false;
  }
  return true;
}
