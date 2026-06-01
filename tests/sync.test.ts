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
  extractSkillEntries,
  syncSkillsToClaudeCode,
  unsyncSkillsFromClaudeCode,
  syncSkillsToGeminiCLI,
  unsyncSkillsFromGeminiCLI,
  syncSkillsToWindsurf,
  unsyncSkillsFromWindsurf,
  syncSkillsToAntigravityCLI,
  unsyncSkillsFromAntigravityCLI,
  syncSkillsToCursor,
  unsyncSkillsFromCursor,
  syncMcpServerToCodex,
  unsyncMcpServerFromCodex,
  cleanOrphanSkills,
  SkillEntry,
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

// ─── syncSkillsToClaudeCode ──────────────────────────────────────────────────

describe('syncSkillsToClaudeCode', () => {
  let claudeDir: string;
  let skillsDir: string;
  let skillSourceDir: string;

  beforeEach(() => {
    claudeDir = path.join(tmpDir, '.claude');
    skillsDir = path.join(claudeDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });

    skillSourceDir = path.join(tmpDir, 'pkg', 'skills', 'my-skill');
    fs.mkdirSync(skillSourceDir, { recursive: true });
    fs.writeFileSync(path.join(skillSourceDir, 'SKILL.md'), '# My Skill\nDo something.', 'utf-8');
  });

  const origHomedir = os.homedir;
  beforeEach(() => { jest.spyOn(os, 'homedir').mockReturnValue(tmpDir); });
  afterEach(() => { jest.restoreAllMocks(); });

  it('creates a symlink in ~/.claude/skills for a valid skill entry', () => {
    const skills: SkillEntry[] = [{
      packageName: 'mypkg',
      skillName: 'my-skill',
      skillDir: skillSourceDir
    }];
    const results = syncSkillsToClaudeCode(skills, brewRoot);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('linked');
    const entryPath = path.join(skillsDir, 'mypkg-my-skill');
    expect(fs.lstatSync(entryPath).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(entryPath)).toBe(skillSourceDir);
  });

  it('reports already_exists for a pre-existing entry', () => {
    const entryPath = path.join(skillsDir, 'mypkg-my-skill');
    fs.symlinkSync(skillSourceDir, entryPath);
    const skills: SkillEntry[] = [{
      packageName: 'mypkg',
      skillName: 'my-skill',
      skillDir: skillSourceDir
    }];
    const results = syncSkillsToClaudeCode(skills, brewRoot);
    expect(results[0].status).toBe('already_exists');
  });

  it('skips entries whose source directory does not exist', () => {
    const skills: SkillEntry[] = [{
      packageName: 'mypkg',
      skillName: 'ghost',
      skillDir: path.join(tmpDir, 'nonexistent')
    }];
    const results = syncSkillsToClaudeCode(skills, brewRoot);
    expect(results[0].status).toBe('skipped');
    expect(fs.existsSync(path.join(skillsDir, 'mypkg-ghost'))).toBe(false);
  });

  it('returns empty array when Claude Code is not installed', () => {
    fs.rmSync(claudeDir, { recursive: true, force: true });
    const skills: SkillEntry[] = [{
      packageName: 'mypkg',
      skillName: 'my-skill',
      skillDir: skillSourceDir
    }];
    const results = syncSkillsToClaudeCode(skills, brewRoot);
    expect(results).toHaveLength(0);
  });

  it('persists synced entry names to tracking file under claude key', () => {
    const skills: SkillEntry[] = [{
      packageName: 'mypkg',
      skillName: 'my-skill',
      skillDir: skillSourceDir
    }];
    syncSkillsToClaudeCode(skills, brewRoot);
    const tracked = JSON.parse(fs.readFileSync(path.join(brewRoot, 'synced-skills.json'), 'utf-8'));
    expect(tracked.claude).toContain('mypkg-my-skill');
  });

  it('skips a path that exists but is not a symlink', () => {
    const entryPath = path.join(skillsDir, 'mypkg-my-skill');
    fs.mkdirSync(entryPath, { recursive: true }); // real directory, not a symlink
    const skills: SkillEntry[] = [{
      packageName: 'mypkg',
      skillName: 'my-skill',
      skillDir: skillSourceDir
    }];
    const results = syncSkillsToClaudeCode(skills, brewRoot);
    expect(results[0].status).toBe('skipped');
    expect(results[0].note).toContain('not a symlink');
    // real directory must not be touched
    expect(fs.lstatSync(entryPath).isSymbolicLink()).toBe(false);
    // must NOT be added to tracking
    const tracked = JSON.parse(fs.readFileSync(path.join(brewRoot, 'synced-skills.json'), 'utf-8'));
    expect(tracked.claude).not.toContain('mypkg-my-skill');
  });

  it('re-creates a stale symlink pointing to a different target', () => {
    const otherDir = path.join(tmpDir, 'other-source');
    fs.mkdirSync(otherDir, { recursive: true });
    const entryPath = path.join(skillsDir, 'mypkg-my-skill');
    fs.symlinkSync(otherDir, entryPath); // points to wrong target
    const skills: SkillEntry[] = [{
      packageName: 'mypkg',
      skillName: 'my-skill',
      skillDir: skillSourceDir
    }];
    const results = syncSkillsToClaudeCode(skills, brewRoot);
    expect(results[0].status).toBe('linked');
    expect(fs.readlinkSync(entryPath)).toBe(skillSourceDir);
  });

  it('migrates old flat skills format to claude key on next sync', () => {
    // Write old-format tracking file
    fs.writeFileSync(
      path.join(brewRoot, 'synced-skills.json'),
      JSON.stringify({ skills: ['mypkg-old-skill'] }),
      'utf-8'
    );
    const skills: SkillEntry[] = [{
      packageName: 'mypkg',
      skillName: 'my-skill',
      skillDir: skillSourceDir
    }];
    syncSkillsToClaudeCode(skills, brewRoot);
    const tracked = JSON.parse(fs.readFileSync(path.join(brewRoot, 'synced-skills.json'), 'utf-8'));
    expect(tracked.claude).toContain('mypkg-old-skill');
    expect(tracked.claude).toContain('mypkg-my-skill');
    expect(tracked.skills).toBeUndefined();
  });
});

// ─── unsyncSkillsFromClaudeCode ──────────────────────────────────────────────

describe('unsyncSkillsFromClaudeCode', () => {
  let claudeDir: string;
  let skillsDir: string;
  let skillSourceDir: string;

  beforeEach(() => {
    claudeDir = path.join(tmpDir, '.claude');
    skillsDir = path.join(claudeDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });

    skillSourceDir = path.join(tmpDir, 'pkg', 'skills', 'my-skill');
    fs.mkdirSync(skillSourceDir, { recursive: true });
    fs.writeFileSync(path.join(skillSourceDir, 'SKILL.md'), '# My Skill', 'utf-8');

    jest.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('removes previously synced symlinks and clears tracking', () => {
    const skills: SkillEntry[] = [{
      packageName: 'mypkg',
      skillName: 'my-skill',
      skillDir: skillSourceDir
    }];
    syncSkillsToClaudeCode(skills, brewRoot);
    const entryPath = path.join(skillsDir, 'mypkg-my-skill');
    expect(fs.existsSync(entryPath)).toBe(true);

    const results = unsyncSkillsFromClaudeCode(brewRoot);
    expect(results[0].status).toBe('removed');
    expect(fs.existsSync(entryPath)).toBe(false);

    const tracked = JSON.parse(fs.readFileSync(path.join(brewRoot, 'synced-skills.json'), 'utf-8'));
    expect(tracked.claude).toHaveLength(0);
  });

  it('reports skipped for entries that no longer exist', () => {
    fs.writeFileSync(
      path.join(brewRoot, 'synced-skills.json'),
      JSON.stringify({ claude: ['mypkg-ghost'] }),
      'utf-8'
    );
    const results = unsyncSkillsFromClaudeCode(brewRoot);
    expect(results[0].status).toBe('skipped');
  });

  it('does nothing when no skills are tracked', () => {
    const results = unsyncSkillsFromClaudeCode(brewRoot);
    expect(results).toHaveLength(0);
  });
});

// ─── syncSkillsToGeminiCLI ───────────────────────────────────────────────────

describe('syncSkillsToGeminiCLI', () => {
  let geminiDir: string;
  let extensionSkillsDir: string;
  let skillSourceDir: string;

  beforeEach(() => {
    geminiDir = path.join(tmpDir, '.gemini');
    extensionSkillsDir = path.join(geminiDir, 'extensions', 'agentbrew', 'skills');
    fs.mkdirSync(path.join(geminiDir, 'extensions'), { recursive: true });

    skillSourceDir = path.join(tmpDir, 'pkg', 'skills', 'my-skill');
    fs.mkdirSync(skillSourceDir, { recursive: true });
    fs.writeFileSync(path.join(skillSourceDir, 'SKILL.md'), '# My Skill', 'utf-8');

    jest.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('creates symlink in extension skills dir for a valid skill', () => {
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    const results = syncSkillsToGeminiCLI(skills, brewRoot);
    expect(results[0].status).toBe('linked');
    const entryPath = path.join(extensionSkillsDir, 'mypkg-my-skill');
    expect(fs.lstatSync(entryPath).isSymbolicLink()).toBe(true);
  });

  it('creates gemini-extension.json manifest', () => {
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    syncSkillsToGeminiCLI(skills, brewRoot);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(geminiDir, 'extensions', 'agentbrew', 'gemini-extension.json'), 'utf-8')
    );
    expect(manifest.name).toBe('agentbrew');
  });

  it('adds agentbrew entry to extension-enablement.json', () => {
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    syncSkillsToGeminiCLI(skills, brewRoot);
    const enablement = JSON.parse(
      fs.readFileSync(path.join(geminiDir, 'extensions', 'extension-enablement.json'), 'utf-8')
    );
    expect(enablement.agentbrew).toBeDefined();
    expect(enablement.agentbrew.overrides).toHaveLength(1);
  });

  it('does not overwrite existing entries in extension-enablement.json', () => {
    const enablementPath = path.join(geminiDir, 'extensions', 'extension-enablement.json');
    fs.writeFileSync(enablementPath, JSON.stringify({ 'other-ext': { overrides: ['/some/path/*'] } }), 'utf-8');
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    syncSkillsToGeminiCLI(skills, brewRoot);
    const enablement = JSON.parse(fs.readFileSync(enablementPath, 'utf-8'));
    expect(enablement['other-ext']).toBeDefined();
    expect(enablement.agentbrew).toBeDefined();
  });

  it('reports already_exists for a pre-existing entry', () => {
    fs.mkdirSync(extensionSkillsDir, { recursive: true });
    fs.symlinkSync(skillSourceDir, path.join(extensionSkillsDir, 'mypkg-my-skill'));
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    const results = syncSkillsToGeminiCLI(skills, brewRoot);
    expect(results[0].status).toBe('already_exists');
  });

  it('skips entries whose source directory does not exist', () => {
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'ghost', skillDir: path.join(tmpDir, 'nope') }];
    const results = syncSkillsToGeminiCLI(skills, brewRoot);
    expect(results[0].status).toBe('skipped');
  });

  it('returns empty array when Gemini CLI is not installed', () => {
    fs.rmSync(geminiDir, { recursive: true, force: true });
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    const results = syncSkillsToGeminiCLI(skills, brewRoot);
    expect(results).toHaveLength(0);
  });

  it('persists synced entries to tracking file under gemini key', () => {
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    syncSkillsToGeminiCLI(skills, brewRoot);
    const tracked = JSON.parse(fs.readFileSync(path.join(brewRoot, 'synced-skills.json'), 'utf-8'));
    expect(tracked.gemini).toContain('mypkg-my-skill');
  });
});

// ─── unsyncSkillsFromGeminiCLI ───────────────────────────────────────────────

describe('unsyncSkillsFromGeminiCLI', () => {
  let geminiDir: string;
  let extensionSkillsDir: string;
  let skillSourceDir: string;

  beforeEach(() => {
    geminiDir = path.join(tmpDir, '.gemini');
    extensionSkillsDir = path.join(geminiDir, 'extensions', 'agentbrew', 'skills');
    fs.mkdirSync(path.join(geminiDir, 'extensions'), { recursive: true });

    skillSourceDir = path.join(tmpDir, 'pkg', 'skills', 'my-skill');
    fs.mkdirSync(skillSourceDir, { recursive: true });
    fs.writeFileSync(path.join(skillSourceDir, 'SKILL.md'), '# My Skill', 'utf-8');

    jest.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('removes previously synced symlinks and clears gemini tracking', () => {
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    syncSkillsToGeminiCLI(skills, brewRoot);
    const entryPath = path.join(extensionSkillsDir, 'mypkg-my-skill');
    expect(fs.existsSync(entryPath)).toBe(true);

    const results = unsyncSkillsFromGeminiCLI(brewRoot);
    expect(results[0].status).toBe('removed');
    expect(fs.existsSync(entryPath)).toBe(false);

    const tracked = JSON.parse(fs.readFileSync(path.join(brewRoot, 'synced-skills.json'), 'utf-8'));
    expect(tracked.gemini).toHaveLength(0);
  });

  it('removes extension-enablement.json when agentbrew was the only extension', () => {
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    syncSkillsToGeminiCLI(skills, brewRoot);
    unsyncSkillsFromGeminiCLI(brewRoot);
    const enablementPath = path.join(geminiDir, 'extensions', 'extension-enablement.json');
    expect(fs.existsSync(enablementPath)).toBe(false);
  });

  it('leaves other extension entries untouched in extension-enablement.json', () => {
    const enablementPath = path.join(geminiDir, 'extensions', 'extension-enablement.json');
    fs.writeFileSync(enablementPath, JSON.stringify({ 'other-ext': { overrides: ['/p/*'] } }), 'utf-8');
    fs.writeFileSync(path.join(brewRoot, 'synced-skills.json'), JSON.stringify({ claude: [], gemini: [], windsurf: [], cursor: false }), 'utf-8');
    unsyncSkillsFromGeminiCLI(brewRoot);
    const enablement = JSON.parse(fs.readFileSync(enablementPath, 'utf-8'));
    expect(enablement['other-ext']).toBeDefined();
  });

  it('reports skipped for entries that no longer exist', () => {
    fs.writeFileSync(
      path.join(brewRoot, 'synced-skills.json'),
      JSON.stringify({ claude: [], gemini: ['mypkg-ghost'], windsurf: [], cursor: false }),
      'utf-8'
    );
    const results = unsyncSkillsFromGeminiCLI(brewRoot);
    expect(results[0].status).toBe('skipped');
  });

  it('does nothing when no gemini skills are tracked', () => {
    const results = unsyncSkillsFromGeminiCLI(brewRoot);
    expect(results).toHaveLength(0);
  });
});

// ─── syncSkillsToWindsurf ────────────────────────────────────────────────────

describe('syncSkillsToWindsurf', () => {
  let windsurfDir: string;
  let skillsDir: string;
  let skillSourceDir: string;

  beforeEach(() => {
    windsurfDir = path.join(tmpDir, '.codeium', 'windsurf');
    skillsDir = path.join(windsurfDir, 'skills');
    fs.mkdirSync(windsurfDir, { recursive: true });

    skillSourceDir = path.join(tmpDir, 'pkg', 'skills', 'my-skill');
    fs.mkdirSync(skillSourceDir, { recursive: true });
    fs.writeFileSync(path.join(skillSourceDir, 'SKILL.md'), '# My Skill', 'utf-8');

    jest.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('creates a symlink in ~/.codeium/windsurf/skills for a valid skill', () => {
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    const results = syncSkillsToWindsurf(skills, brewRoot);
    expect(results[0].status).toBe('linked');
    const entryPath = path.join(skillsDir, 'mypkg-my-skill');
    expect(fs.lstatSync(entryPath).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(entryPath)).toBe(skillSourceDir);
  });

  it('reports already_exists for a pre-existing entry', () => {
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.symlinkSync(skillSourceDir, path.join(skillsDir, 'mypkg-my-skill'));
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    const results = syncSkillsToWindsurf(skills, brewRoot);
    expect(results[0].status).toBe('already_exists');
  });

  it('skips entries whose source directory does not exist', () => {
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'ghost', skillDir: path.join(tmpDir, 'nope') }];
    const results = syncSkillsToWindsurf(skills, brewRoot);
    expect(results[0].status).toBe('skipped');
  });

  it('returns empty array when Windsurf is not installed', () => {
    fs.rmSync(windsurfDir, { recursive: true, force: true });
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    const results = syncSkillsToWindsurf(skills, brewRoot);
    expect(results).toHaveLength(0);
  });

  it('persists synced entries to tracking file under windsurf key', () => {
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    syncSkillsToWindsurf(skills, brewRoot);
    const tracked = JSON.parse(fs.readFileSync(path.join(brewRoot, 'synced-skills.json'), 'utf-8'));
    expect(tracked.windsurf).toContain('mypkg-my-skill');
  });
});

// ─── unsyncSkillsFromWindsurf ────────────────────────────────────────────────

describe('unsyncSkillsFromWindsurf', () => {
  let windsurfDir: string;
  let skillsDir: string;
  let skillSourceDir: string;

  beforeEach(() => {
    windsurfDir = path.join(tmpDir, '.codeium', 'windsurf');
    skillsDir = path.join(windsurfDir, 'skills');
    fs.mkdirSync(windsurfDir, { recursive: true });

    skillSourceDir = path.join(tmpDir, 'pkg', 'skills', 'my-skill');
    fs.mkdirSync(skillSourceDir, { recursive: true });
    fs.writeFileSync(path.join(skillSourceDir, 'SKILL.md'), '# My Skill', 'utf-8');

    jest.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('removes previously synced symlinks and clears windsurf tracking', () => {
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    syncSkillsToWindsurf(skills, brewRoot);
    const entryPath = path.join(skillsDir, 'mypkg-my-skill');
    expect(fs.existsSync(entryPath)).toBe(true);

    const results = unsyncSkillsFromWindsurf(brewRoot);
    expect(results[0].status).toBe('removed');
    expect(fs.existsSync(entryPath)).toBe(false);

    const tracked = JSON.parse(fs.readFileSync(path.join(brewRoot, 'synced-skills.json'), 'utf-8'));
    expect(tracked.windsurf).toHaveLength(0);
  });

  it('reports skipped for entries that no longer exist', () => {
    fs.writeFileSync(
      path.join(brewRoot, 'synced-skills.json'),
      JSON.stringify({ claude: [], gemini: [], windsurf: ['mypkg-ghost'], cursor: false }),
      'utf-8'
    );
    const results = unsyncSkillsFromWindsurf(brewRoot);
    expect(results[0].status).toBe('skipped');
  });

  it('does nothing when no windsurf skills are tracked', () => {
    const results = unsyncSkillsFromWindsurf(brewRoot);
    expect(results).toHaveLength(0);
  });
});

// ─── syncSkillsToCursor ──────────────────────────────────────────────────────

describe('syncSkillsToCursor', () => {
  let cursorDir: string;
  let rulesDir: string;
  let skillSourceDir: string;

  beforeEach(() => {
    cursorDir = path.join(tmpDir, '.cursor');
    rulesDir = path.join(cursorDir, 'rules');
    fs.mkdirSync(cursorDir, { recursive: true });

    skillSourceDir = path.join(tmpDir, 'pkg', 'skills', 'my-skill');
    fs.mkdirSync(skillSourceDir, { recursive: true });
    fs.writeFileSync(path.join(skillSourceDir, 'SKILL.md'), '# My Skill', 'utf-8');

    jest.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('writes skills index file to ~/.cursor/rules/', () => {
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    const results = syncSkillsToCursor(skills, brewRoot);
    expect(results[0].status).toBe('linked');
    const indexPath = path.join(rulesDir, 'agentbrew-skills-index.md');
    expect(fs.existsSync(indexPath)).toBe(true);
    const content = fs.readFileSync(indexPath, 'utf-8');
    expect(content).toContain('mypkg/my-skill');
    expect(content).toContain('SKILL.md');
  });

  it('includes skill description when provided', () => {
    const skills: SkillEntry[] = [{
      packageName: 'mypkg',
      skillName: 'my-skill',
      skillDir: skillSourceDir,
      description: 'Does something useful'
    }];
    syncSkillsToCursor(skills, brewRoot);
    const content = fs.readFileSync(path.join(rulesDir, 'agentbrew-skills-index.md'), 'utf-8');
    expect(content).toContain('Does something useful');
  });

  it('returns empty array when Cursor is not installed', () => {
    fs.rmSync(cursorDir, { recursive: true, force: true });
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    const results = syncSkillsToCursor(skills, brewRoot);
    expect(results).toHaveLength(0);
  });

  it('returns empty array when there are no skills', () => {
    const results = syncSkillsToCursor([], brewRoot);
    expect(results).toHaveLength(0);
  });

  it('sets cursor: true in tracking file', () => {
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    syncSkillsToCursor(skills, brewRoot);
    const tracked = JSON.parse(fs.readFileSync(path.join(brewRoot, 'synced-skills.json'), 'utf-8'));
    expect(tracked.cursor).toBe(true);
  });
});

// ─── unsyncSkillsFromCursor ──────────────────────────────────────────────────

describe('unsyncSkillsFromCursor', () => {
  let cursorDir: string;
  let rulesDir: string;
  let skillSourceDir: string;

  beforeEach(() => {
    cursorDir = path.join(tmpDir, '.cursor');
    rulesDir = path.join(cursorDir, 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });

    skillSourceDir = path.join(tmpDir, 'pkg', 'skills', 'my-skill');
    fs.mkdirSync(skillSourceDir, { recursive: true });

    jest.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('removes the skills index file and sets cursor: false', () => {
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    fs.writeFileSync(path.join(skillSourceDir, 'SKILL.md'), '# My Skill', 'utf-8');
    syncSkillsToCursor(skills, brewRoot);
    const indexPath = path.join(rulesDir, 'agentbrew-skills-index.md');
    expect(fs.existsSync(indexPath)).toBe(true);

    const results = unsyncSkillsFromCursor(brewRoot);
    expect(results[0].status).toBe('removed');
    expect(fs.existsSync(indexPath)).toBe(false);

    const tracked = JSON.parse(fs.readFileSync(path.join(brewRoot, 'synced-skills.json'), 'utf-8'));
    expect(tracked.cursor).toBe(false);
  });

  it('reports skipped when index file does not exist but cursor was tracked', () => {
    fs.writeFileSync(
      path.join(brewRoot, 'synced-skills.json'),
      JSON.stringify({ claude: [], gemini: [], windsurf: [], cursor: true }),
      'utf-8'
    );
    const results = unsyncSkillsFromCursor(brewRoot);
    expect(results[0].status).toBe('skipped');
  });

  it('does nothing when cursor was not tracked', () => {
    const results = unsyncSkillsFromCursor(brewRoot);
    expect(results).toHaveLength(0);
  });
});

// ─── syncSkillsToAntigravityCLI ──────────────────────────────────────────────

describe('syncSkillsToAntigravityCLI', () => {
  let antigravityDir: string;
  let skillsDir: string;
  let skillSourceDir: string;

  beforeEach(() => {
    antigravityDir = path.join(tmpDir, '.gemini', 'antigravity-cli');
    skillsDir = path.join(antigravityDir, 'skills');
    fs.mkdirSync(antigravityDir, { recursive: true });

    skillSourceDir = path.join(tmpDir, 'pkg', 'skills', 'my-skill');
    fs.mkdirSync(skillSourceDir, { recursive: true });
    fs.writeFileSync(path.join(skillSourceDir, 'SKILL.md'), '# My Skill', 'utf-8');

    jest.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('creates a symlink in ~/.gemini/antigravity-cli/skills for a valid skill', () => {
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    const results = syncSkillsToAntigravityCLI(skills, brewRoot);
    expect(results[0].status).toBe('linked');
    const entryPath = path.join(skillsDir, 'mypkg-my-skill');
    expect(fs.lstatSync(entryPath).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(entryPath)).toBe(skillSourceDir);
  });

  it('reports already_exists for a pre-existing correct symlink', () => {
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.symlinkSync(skillSourceDir, path.join(skillsDir, 'mypkg-my-skill'));
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    const results = syncSkillsToAntigravityCLI(skills, brewRoot);
    expect(results[0].status).toBe('already_exists');
  });

  it('re-creates a stale symlink pointing to a different target', () => {
    const otherDir = path.join(tmpDir, 'other-source');
    fs.mkdirSync(otherDir, { recursive: true });
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.symlinkSync(otherDir, path.join(skillsDir, 'mypkg-my-skill'));
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    const results = syncSkillsToAntigravityCLI(skills, brewRoot);
    expect(results[0].status).toBe('linked');
    expect(fs.readlinkSync(path.join(skillsDir, 'mypkg-my-skill'))).toBe(skillSourceDir);
  });

  it('skips entries whose source directory does not exist', () => {
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'ghost', skillDir: path.join(tmpDir, 'nope') }];
    const results = syncSkillsToAntigravityCLI(skills, brewRoot);
    expect(results[0].status).toBe('skipped');
  });

  it('returns empty array when Antigravity CLI is not installed', () => {
    fs.rmSync(antigravityDir, { recursive: true, force: true });
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    const results = syncSkillsToAntigravityCLI(skills, brewRoot);
    expect(results).toHaveLength(0);
  });

  it('persists synced entries to tracking file under antigravity key', () => {
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    syncSkillsToAntigravityCLI(skills, brewRoot);
    const tracked = JSON.parse(fs.readFileSync(path.join(brewRoot, 'synced-skills.json'), 'utf-8'));
    expect(tracked.antigravity).toContain('mypkg-my-skill');
  });
});

// ─── unsyncSkillsFromAntigravityCLI ──────────────────────────────────────────

describe('unsyncSkillsFromAntigravityCLI', () => {
  let antigravityDir: string;
  let skillsDir: string;
  let skillSourceDir: string;

  beforeEach(() => {
    antigravityDir = path.join(tmpDir, '.gemini', 'antigravity-cli');
    skillsDir = path.join(antigravityDir, 'skills');
    fs.mkdirSync(antigravityDir, { recursive: true });

    skillSourceDir = path.join(tmpDir, 'pkg', 'skills', 'my-skill');
    fs.mkdirSync(skillSourceDir, { recursive: true });
    fs.writeFileSync(path.join(skillSourceDir, 'SKILL.md'), '# My Skill', 'utf-8');

    jest.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('removes previously synced symlinks and clears antigravity tracking', () => {
    const skills: SkillEntry[] = [{ packageName: 'mypkg', skillName: 'my-skill', skillDir: skillSourceDir }];
    syncSkillsToAntigravityCLI(skills, brewRoot);
    const entryPath = path.join(skillsDir, 'mypkg-my-skill');
    expect(fs.existsSync(entryPath)).toBe(true);

    const results = unsyncSkillsFromAntigravityCLI(brewRoot);
    expect(results[0].status).toBe('removed');
    expect(fs.existsSync(entryPath)).toBe(false);

    const tracked = JSON.parse(fs.readFileSync(path.join(brewRoot, 'synced-skills.json'), 'utf-8'));
    expect(tracked.antigravity).toHaveLength(0);
  });

  it('reports skipped for entries that no longer exist', () => {
    fs.writeFileSync(
      path.join(brewRoot, 'synced-skills.json'),
      JSON.stringify({ claude: [], gemini: [], windsurf: [], cursor: false, antigravity: ['mypkg-ghost'] }),
      'utf-8'
    );
    const results = unsyncSkillsFromAntigravityCLI(brewRoot);
    expect(results[0].status).toBe('skipped');
  });

  it('does nothing when no antigravity skills are tracked', () => {
    const results = unsyncSkillsFromAntigravityCLI(brewRoot);
    expect(results).toHaveLength(0);
  });
});

// ─── cleanOrphanSkills ───────────────────────────────────────────────────────

describe('cleanOrphanSkills', () => {
  let skillSourceDir: string;
  let claudeSkillsDir: string;

  beforeEach(() => {
    claudeSkillsDir = path.join(tmpDir, '.claude', 'skills');
    fs.mkdirSync(claudeSkillsDir, { recursive: true });

    skillSourceDir = path.join(tmpDir, 'pkg', 'skills', 'my-skill');
    fs.mkdirSync(skillSourceDir, { recursive: true });
    fs.writeFileSync(path.join(skillSourceDir, 'SKILL.md'), '# My Skill', 'utf-8');

    jest.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('removes symlinks whose targets no longer exist', () => {
    const entryPath = path.join(claudeSkillsDir, 'mypkg-my-skill');
    fs.symlinkSync(skillSourceDir, entryPath);
    fs.writeFileSync(
      path.join(brewRoot, 'synced-skills.json'),
      JSON.stringify({ claude: ['mypkg-my-skill'], gemini: [], windsurf: [], cursor: false, antigravity: [] }),
      'utf-8'
    );

    // Simulate package removal
    fs.rmSync(skillSourceDir, { recursive: true, force: true });

    const results = cleanOrphanSkills(brewRoot);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('removed');
    expect(results[0].entryName).toBe('mypkg-my-skill');
    expect(fs.existsSync(entryPath)).toBe(false);

    const tracked = JSON.parse(fs.readFileSync(path.join(brewRoot, 'synced-skills.json'), 'utf-8'));
    expect(tracked.claude).toHaveLength(0);
  });

  it('keeps symlinks whose targets still exist', () => {
    const entryPath = path.join(claudeSkillsDir, 'mypkg-my-skill');
    fs.symlinkSync(skillSourceDir, entryPath);
    fs.writeFileSync(
      path.join(brewRoot, 'synced-skills.json'),
      JSON.stringify({ claude: ['mypkg-my-skill'], gemini: [], windsurf: [], cursor: false, antigravity: [] }),
      'utf-8'
    );

    const results = cleanOrphanSkills(brewRoot);
    expect(results).toHaveLength(0);
    expect(fs.existsSync(entryPath)).toBe(true);

    const tracked = JSON.parse(fs.readFileSync(path.join(brewRoot, 'synced-skills.json'), 'utf-8'));
    expect(tracked.claude).toContain('mypkg-my-skill');
  });

  it('returns empty results when nothing is tracked', () => {
    const results = cleanOrphanSkills(brewRoot);
    expect(results).toHaveLength(0);
  });

  it('removes cursor index when referenced SKILL.md paths no longer exist', () => {
    const cursorRulesDir = path.join(tmpDir, '.cursor', 'rules');
    fs.mkdirSync(cursorRulesDir, { recursive: true });

    const indexPath = path.join(cursorRulesDir, 'agentbrew-skills-index.md');
    const skillMdPath = path.join(skillSourceDir, 'SKILL.md');
    fs.writeFileSync(indexPath, `# AgentBrew Skills\n- **mypkg/my-skill**: \`${skillMdPath}\`\n`, 'utf-8');
    fs.writeFileSync(
      path.join(brewRoot, 'synced-skills.json'),
      JSON.stringify({ claude: [], gemini: [], windsurf: [], cursor: true, antigravity: [] }),
      'utf-8'
    );

    // Simulate package removal
    fs.rmSync(skillSourceDir, { recursive: true, force: true });

    const results = cleanOrphanSkills(brewRoot);
    expect(results.some(r => r.entryName === 'agentbrew-skills-index.md' && r.status === 'removed')).toBe(true);
    expect(fs.existsSync(indexPath)).toBe(false);
    const tracked = JSON.parse(fs.readFileSync(path.join(brewRoot, 'synced-skills.json'), 'utf-8'));
    expect(tracked.cursor).toBe(false);
  });

  it('keeps cursor index when all referenced SKILL.md paths still exist', () => {
    const cursorRulesDir = path.join(tmpDir, '.cursor', 'rules');
    fs.mkdirSync(cursorRulesDir, { recursive: true });

    const indexPath = path.join(cursorRulesDir, 'agentbrew-skills-index.md');
    const skillMdPath = path.join(skillSourceDir, 'SKILL.md');
    fs.writeFileSync(indexPath, `# AgentBrew Skills\n- **mypkg/my-skill**: \`${skillMdPath}\`\n`, 'utf-8');
    fs.writeFileSync(
      path.join(brewRoot, 'synced-skills.json'),
      JSON.stringify({ claude: [], gemini: [], windsurf: [], cursor: true, antigravity: [] }),
      'utf-8'
    );

    const results = cleanOrphanSkills(brewRoot);
    expect(results.some(r => r.entryName === 'agentbrew-skills-index.md')).toBe(false);
    expect(fs.existsSync(indexPath)).toBe(true);
    const tracked = JSON.parse(fs.readFileSync(path.join(brewRoot, 'synced-skills.json'), 'utf-8'));
    expect(tracked.cursor).toBe(true);
  });
});

// ─── syncMcpServerToCodex ────────────────────────────────────────────────────

describe('syncMcpServerToCodex', () => {
  let codexDir: string;

  beforeEach(() => {
    codexDir = path.join(tmpDir, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    jest.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('creates config.toml with agentbrew section when file does not exist', () => {
    const results = syncMcpServerToCodex(brewRoot);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('linked');
    const configPath = path.join(codexDir, 'config.toml');
    expect(fs.existsSync(configPath)).toBe(true);
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toContain('[mcp_servers.agentbrew]');
    expect(content).toContain('command = "agentbrew"');
  });

  it('appends agentbrew section to existing config.toml without disturbing other content', () => {
    const configPath = path.join(codexDir, 'config.toml');
    fs.writeFileSync(configPath, '[model]\nname = "gpt-4o"\n', 'utf-8');
    const results = syncMcpServerToCodex(brewRoot);
    expect(results[0].status).toBe('linked');
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toContain('[model]');
    expect(content).toContain('[mcp_servers.agentbrew]');
    expect(content).toContain('command = "agentbrew"');
  });

  it('reports already_exists when agentbrew is already registered', () => {
    const configPath = path.join(codexDir, 'config.toml');
    fs.writeFileSync(configPath, '[mcp_servers.agentbrew]\ncommand = "agentbrew"\n', 'utf-8');
    const results = syncMcpServerToCodex(brewRoot);
    expect(results[0].status).toBe('already_exists');
    // File should not be modified
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content.split('[mcp_servers.agentbrew]').length).toBe(2);
  });

  it('returns empty array when Codex CLI is not installed', () => {
    fs.rmSync(codexDir, { recursive: true, force: true });
    const results = syncMcpServerToCodex(brewRoot);
    expect(results).toHaveLength(0);
  });

  it('sets codexMcp: true in tracking file', () => {
    syncMcpServerToCodex(brewRoot);
    const tracked = JSON.parse(fs.readFileSync(path.join(brewRoot, 'synced-skills.json'), 'utf-8'));
    expect(tracked.codexMcp).toBe(true);
  });
});

// ─── unsyncMcpServerFromCodex ─────────────────────────────────────────────────

describe('unsyncMcpServerFromCodex', () => {
  let codexDir: string;

  beforeEach(() => {
    codexDir = path.join(tmpDir, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    jest.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('removes the agentbrew section from config.toml and sets codexMcp: false', () => {
    const configPath = path.join(codexDir, 'config.toml');
    fs.writeFileSync(configPath, '[mcp_servers.agentbrew]\ncommand = "agentbrew"\n', 'utf-8');
    fs.writeFileSync(path.join(brewRoot, 'synced-skills.json'), JSON.stringify({ codexMcp: true }), 'utf-8');

    const results = unsyncMcpServerFromCodex(brewRoot);
    expect(results[0].status).toBe('removed');
    expect(fs.existsSync(configPath)).toBe(true); // file is kept
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).not.toContain('[mcp_servers.agentbrew]');

    const tracked = JSON.parse(fs.readFileSync(path.join(brewRoot, 'synced-skills.json'), 'utf-8'));
    expect(tracked.codexMcp).toBe(false);
  });

  it('leaves other sections intact when removing agentbrew', () => {
    const configPath = path.join(codexDir, 'config.toml');
    fs.writeFileSync(
      configPath,
      '[model]\nname = "gpt-4o"\n\n[mcp_servers.agentbrew]\ncommand = "agentbrew"\n\n[mcp_servers.other]\ncommand = "other"\n',
      'utf-8'
    );
    fs.writeFileSync(path.join(brewRoot, 'synced-skills.json'), JSON.stringify({ codexMcp: true }), 'utf-8');

    unsyncMcpServerFromCodex(brewRoot);
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toContain('[model]');
    expect(content).toContain('[mcp_servers.other]');
    expect(content).not.toContain('[mcp_servers.agentbrew]');
  });

  it('does nothing when codexMcp is not tracked', () => {
    const results = unsyncMcpServerFromCodex(brewRoot);
    expect(results).toHaveLength(0);
  });

  it('reports skipped when config.toml does not exist', () => {
    fs.writeFileSync(path.join(brewRoot, 'synced-skills.json'), JSON.stringify({ codexMcp: true }), 'utf-8');
    const results = unsyncMcpServerFromCodex(brewRoot);
    expect(results[0].status).toBe('skipped');
  });

  it('reports skipped when agentbrew section is not found in existing config', () => {
    const configPath = path.join(codexDir, 'config.toml');
    fs.writeFileSync(configPath, '[model]\nname = "gpt-4o"\n', 'utf-8');
    fs.writeFileSync(path.join(brewRoot, 'synced-skills.json'), JSON.stringify({ codexMcp: true }), 'utf-8');
    const results = unsyncMcpServerFromCodex(brewRoot);
    expect(results[0].status).toBe('skipped');
  });
});

// ─── extractSkillEntries ─────────────────────────────────────────────────────

describe('extractSkillEntries', () => {
  let skillSourceDir: string;

  beforeEach(() => {
    skillSourceDir = path.join(tmpDir, 'pkg', 'skills', 'my-skill');
    fs.mkdirSync(skillSourceDir, { recursive: true });
    fs.writeFileSync(path.join(skillSourceDir, 'SKILL.md'), '# My Skill', 'utf-8');
  });

  it('extracts a SkillEntry for each SKILL.md prompt', () => {
    const packages = [{
      packageName: 'mypkg',
      path: path.join(tmpDir, 'pkg'),
      subPath: '',
      isEnabled: true,
      manifest: {
        name: 'mypkg',
        version: '1.0.0',
        prompts: [{ name: 'my-skill', file: 'skills/my-skill/SKILL.md', description: 'Does things' }],
      },
    }];
    const skills = extractSkillEntries(packages as any);
    expect(skills).toHaveLength(1);
    expect(skills[0].packageName).toBe('mypkg');
    expect(skills[0].skillName).toBe('my-skill');
    expect(skills[0].skillDir).toBe(skillSourceDir);
    expect(skills[0].description).toBe('Does things');
  });

  it('ignores prompts whose file is not SKILL.md', () => {
    const packages = [{
      packageName: 'mypkg',
      path: path.join(tmpDir, 'pkg'),
      subPath: '',
      isEnabled: true,
      manifest: {
        name: 'mypkg',
        version: '1.0.0',
        prompts: [
          { name: 'my-skill', file: 'skills/my-skill/SKILL.md', description: '' },
          { name: 'readme',   file: 'README.md', description: '' },
        ],
      },
    }];
    const skills = extractSkillEntries(packages as any);
    expect(skills).toHaveLength(1);
    expect(skills[0].skillName).toBe('my-skill');
  });

  it('returns empty array for packages with no prompts', () => {
    const packages = [{
      packageName: 'mypkg',
      path: path.join(tmpDir, 'pkg'),
      subPath: '',
      isEnabled: true,
      manifest: { name: 'mypkg', version: '1.0.0' },
    }];
    const skills = extractSkillEntries(packages as any);
    expect(skills).toHaveLength(0);
  });

  it('handles SKILL.MD (uppercase) as well as SKILL.md', () => {
    const packages = [{
      packageName: 'mypkg',
      path: path.join(tmpDir, 'pkg'),
      subPath: '',
      isEnabled: true,
      manifest: {
        name: 'mypkg',
        version: '1.0.0',
        prompts: [{ name: 'my-skill', file: 'skills/my-skill/SKILL.MD', description: '' }],
      },
    }];
    const skills = extractSkillEntries(packages as any);
    expect(skills).toHaveLength(1);
  });
});
