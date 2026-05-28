import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  injectIntoFile,
  removeFromFile,
  syncInstructions,
  unsyncInstructions,
  getInstructionsPath,
  MARKER_START,
  MARKER_END,
  buildInjectedSection,
} from '../src/sync';

jest.mock('../src/config', () => ({
  getBrewRoot: () => brewRoot,
}));

let tmpDir: string;
let brewRoot: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbrew-sync-test-'));
  brewRoot = path.join(tmpDir, '.agentbrew');
  fs.mkdirSync(brewRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── injectIntoFile ──────────────────────────────────────────────────────────

describe('injectIntoFile', () => {
  it('creates the file when it does not exist', () => {
    const filePath = path.join(tmpDir, 'subdir', 'NEW.md');
    const result = injectIntoFile(filePath, 'hello world');
    expect(result).toBe('created');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain(MARKER_START);
    expect(content).toContain('hello world');
    expect(content).toContain(MARKER_END);
  });

  it('appends section when file exists without markers', () => {
    const filePath = path.join(tmpDir, 'AGENT.md');
    fs.writeFileSync(filePath, '# My Agent\n\nExisting content.\n', 'utf-8');
    const result = injectIntoFile(filePath, 'shared instructions');
    expect(result).toBe('updated');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('# My Agent');
    expect(content).toContain('Existing content.');
    expect(content).toContain(MARKER_START);
    expect(content).toContain('shared instructions');
    expect(content).toContain(MARKER_END);
    // Markers must appear after existing content
    expect(content.indexOf('Existing content.')).toBeLessThan(content.indexOf(MARKER_START));
  });

  it('replaces the existing section when markers are present', () => {
    const old = `# My Agent\n\n${MARKER_START}\nold content\n${MARKER_END}\n\nOther stuff.\n`;
    const filePath = path.join(tmpDir, 'AGENT.md');
    fs.writeFileSync(filePath, old, 'utf-8');
    const result = injectIntoFile(filePath, 'new content');
    expect(result).toBe('updated');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).not.toContain('old content');
    expect(content).toContain('new content');
    expect(content).toContain('Other stuff.');
    // Only one pair of markers
    expect(content.split(MARKER_START).length).toBe(2);
    expect(content.split(MARKER_END).length).toBe(2);
  });

  it('returns unchanged when content is identical', () => {
    const filePath = path.join(tmpDir, 'AGENT.md');
    injectIntoFile(filePath, 'same content');
    const result = injectIntoFile(filePath, 'same content');
    expect(result).toBe('unchanged');
  });
});

// ─── removeFromFile ──────────────────────────────────────────────────────────

describe('removeFromFile', () => {
  it('returns not_found when file does not exist', () => {
    const result = removeFromFile(path.join(tmpDir, 'nonexistent.md'));
    expect(result).toBe('not_found');
  });

  it('returns no_section when file has no markers', () => {
    const filePath = path.join(tmpDir, 'AGENT.md');
    fs.writeFileSync(filePath, '# My Agent\n', 'utf-8');
    const result = removeFromFile(filePath);
    expect(result).toBe('no_section');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('# My Agent\n');
  });

  it('removes the marked section and leaves surrounding content intact', () => {
    const filePath = path.join(tmpDir, 'AGENT.md');
    const original = `# My Agent\n\nTop content.\n\n${MARKER_START}\nshared stuff\n${MARKER_END}\n\nBottom content.\n`;
    fs.writeFileSync(filePath, original, 'utf-8');
    const result = removeFromFile(filePath);
    expect(result).toBe('removed');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('Top content.');
    expect(content).toContain('Bottom content.');
    expect(content).not.toContain(MARKER_START);
    expect(content).not.toContain(MARKER_END);
    expect(content).not.toContain('shared stuff');
  });
});

// ─── syncInstructions ────────────────────────────────────────────────────────

describe('syncInstructions', () => {
  it('creates an example INSTRUCTIONS.md and returns empty results when none exists', () => {
    const results = syncInstructions([], brewRoot);
    expect(results).toHaveLength(0);
    const instructionsPath = path.join(brewRoot, 'INSTRUCTIONS.md');
    expect(fs.existsSync(instructionsPath)).toBe(true);
    const content = fs.readFileSync(instructionsPath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('skips agents whose config directory does not exist', () => {
    const instructionsPath = path.join(brewRoot, 'INSTRUCTIONS.md');
    fs.writeFileSync(instructionsPath, 'use context7', 'utf-8');
    const targets = [
      { name: 'Ghost Agent', configPath: path.join(tmpDir, 'ghost', 'GHOST.md'), isFileOwned: false },
    ];
    const results = syncInstructions(targets, brewRoot);
    expect(results[0].status).toBe('skipped');
  });

  it('creates a new config file for an installed agent that has no config yet', () => {
    const instructionsPath = path.join(brewRoot, 'INSTRUCTIONS.md');
    fs.writeFileSync(instructionsPath, 'use context7', 'utf-8');
    const agentDir = path.join(tmpDir, 'myagent');
    fs.mkdirSync(agentDir);
    const targets = [
      { name: 'My Agent', configPath: path.join(agentDir, 'MY.md'), isFileOwned: false },
    ];
    const results = syncInstructions(targets, brewRoot);
    expect(results[0].status).toBe('created');
    expect(fs.existsSync(results[0].path!)).toBe(true);
  });

  it('updates an existing config file for an installed agent', () => {
    const instructionsPath = path.join(brewRoot, 'INSTRUCTIONS.md');
    fs.writeFileSync(instructionsPath, 'use context7', 'utf-8');
    const agentDir = path.join(tmpDir, 'myagent');
    fs.mkdirSync(agentDir);
    const configPath = path.join(agentDir, 'MY.md');
    fs.writeFileSync(configPath, '# Existing\n', 'utf-8');
    const targets = [
      { name: 'My Agent', configPath, isFileOwned: false },
    ];
    const results = syncInstructions(targets, brewRoot);
    expect(results[0].status).toBe('updated');
    expect(fs.readFileSync(configPath, 'utf-8')).toContain('use context7');
  });

  it('writes owned files without markers', () => {
    const instructionsPath = path.join(brewRoot, 'INSTRUCTIONS.md');
    fs.writeFileSync(instructionsPath, 'use context7', 'utf-8');
    const agentDir = path.join(tmpDir, 'cursor', 'rules');
    fs.mkdirSync(agentDir, { recursive: true });
    const configPath = path.join(agentDir, 'agentbrew-shared.md');
    const targets = [{ name: 'Cursor', configPath, isFileOwned: true }];
    const results = syncInstructions(targets, brewRoot);
    expect(results[0].status).toBe('created');
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toContain('use context7');
    expect(content).not.toContain(MARKER_START);
    expect(content).not.toContain(MARKER_END);
  });

  it('marks manual agents without touching any file', () => {
    const instructionsPath = path.join(brewRoot, 'INSTRUCTIONS.md');
    fs.writeFileSync(instructionsPath, 'use context7', 'utf-8');
    const targets = [
      { name: 'Manual Agent', configPath: null, isFileOwned: false, manualInstructions: 'Do it yourself.' },
    ];
    const results = syncInstructions(targets, brewRoot);
    expect(results[0].status).toBe('manual');
    expect(results[0].note).toBe('Do it yourself.');
  });
});

// ─── unsyncInstructions ──────────────────────────────────────────────────────

describe('unsyncInstructions', () => {
  it('removes the injected section from a synced config file', () => {
    const agentDir = path.join(tmpDir, 'myagent');
    fs.mkdirSync(agentDir);
    const configPath = path.join(agentDir, 'MY.md');
    const content = `# Existing\n\n${MARKER_START}\nshared stuff\n${MARKER_END}\n`;
    fs.writeFileSync(configPath, content, 'utf-8');
    const targets = [{ name: 'My Agent', configPath, isFileOwned: false }];
    const results = unsyncInstructions(targets);
    expect(results[0].status).toBe('removed');
    expect(fs.readFileSync(configPath, 'utf-8')).not.toContain(MARKER_START);
  });

  it('deletes file-owned config files', () => {
    const agentDir = path.join(tmpDir, 'cursor', 'rules');
    fs.mkdirSync(agentDir, { recursive: true });
    const configPath = path.join(agentDir, 'agentbrew-shared.md');
    fs.writeFileSync(configPath, 'something', 'utf-8');
    const targets = [{ name: 'Cursor', configPath, isFileOwned: true }];
    const results = unsyncInstructions(targets);
    expect(results[0].status).toBe('removed');
    expect(fs.existsSync(configPath)).toBe(false);
  });
});

// ─── buildInjectedSection ────────────────────────────────────────────────────

describe('buildInjectedSection', () => {
  it('wraps content with start and end markers', () => {
    const section = buildInjectedSection('my rules');
    expect(section.startsWith(MARKER_START)).toBe(true);
    expect(section.endsWith(MARKER_END)).toBe(true);
    expect(section).toContain('my rules');
  });

  it('includes the agentbrew warning line', () => {
    const section = buildInjectedSection('x');
    expect(section).toContain('AgentBrew');
    expect(section).toContain('agentbrew sync');
  });
});
