import { program } from '../src/cli';
import { runMigration, discoverExternalConfigs } from '../src/migration';
import { Logger } from '../src/logger';

jest.mock('../src/migration');
jest.mock('../src/logger');

describe('CLI Migrate Hints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('displays Gemini hints when Gemini source is found', async () => {
    (runMigration as jest.Mock).mockResolvedValue({
      servers: [{ source: 'Gemini' }],
      skills: []
    });

    // We need to trigger the action. program.parse will trigger it.
    // We mock process.exit because commander might call it.
    const exitMock = jest.spyOn(process, 'exit').mockImplementation(() => { return undefined as never; });
    
    await program.parseAsync(['node', 'agentbrew', 'migrate']);

    expect(Logger.info).toHaveBeenCalledWith(expect.stringContaining('For Gemini CLI:'));
    expect(Logger.info).toHaveBeenCalledWith(expect.stringContaining('gemini mcp add agentbrew agentbrew'));
    
    exitMock.mockRestore();
  });

  test('displays Claude hints when Claude source is found', async () => {
    (runMigration as jest.Mock).mockResolvedValue({
      servers: [],
      skills: [{ source: 'Claude' }]
    });

    const exitMock = jest.spyOn(process, 'exit').mockImplementation(() => { return undefined as never; });
    
    await program.parseAsync(['node', 'agentbrew', 'migrate']);

    expect(Logger.info).toHaveBeenCalledWith(expect.stringContaining('For Claude Code:'));
    expect(Logger.info).toHaveBeenCalledWith(expect.stringContaining('/plugin add agentbrew agentbrew'));
    
    exitMock.mockRestore();
  });

  test('displays Cursor hints when Cursor source is found', async () => {
    (runMigration as jest.Mock).mockResolvedValue({
      servers: [{ source: 'Cursor' }],
      skills: []
    });

    const exitMock = jest.spyOn(process, 'exit').mockImplementation(() => { return undefined as never; });
    
    await program.parseAsync(['node', 'agentbrew', 'migrate']);

    expect(Logger.info).toHaveBeenCalledWith(expect.stringContaining('For Cursor:'));
    expect(Logger.info).toHaveBeenCalledWith(expect.stringContaining('Open Cursor Settings > MCP'));
    
    exitMock.mockRestore();
  });

  test('displays all hints when multiple sources are found', async () => {
    (runMigration as jest.Mock).mockResolvedValue({
      servers: [{ source: 'Gemini' }, { source: 'Cursor' }],
      skills: [{ source: 'Claude' }]
    });

    const exitMock = jest.spyOn(process, 'exit').mockImplementation(() => { return undefined as never; });
    
    await program.parseAsync(['node', 'agentbrew', 'migrate']);

    expect(Logger.info).toHaveBeenCalledWith(expect.stringContaining('For Gemini CLI:'));
    expect(Logger.info).toHaveBeenCalledWith(expect.stringContaining('For Claude Code:'));
    expect(Logger.info).toHaveBeenCalledWith(expect.stringContaining('For Cursor:'));
    
    exitMock.mockRestore();
  });
});
