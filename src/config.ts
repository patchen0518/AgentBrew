import path from 'path';
import os from 'os';

/**
 * Returns the resolved AgentBrew root directory path.
 * Respects AGENTBREW_ROOT environment variable, defaulting to ~/.agentbrew
 */
export function getBrewRoot(): string {
  return process.env.AGENTBREW_ROOT || path.join(os.homedir(), '.agentbrew');
}

/**
 * Returns the path to the packages directory under AgentBrew root.
 */
export function getPackagesDir(): string {
  return path.join(getBrewRoot(), 'packages');
}

/**
 * Returns the path to the state JSON file.
 */
export function getStateFile(): string {
  return path.join(getBrewRoot(), 'state.json');
}
