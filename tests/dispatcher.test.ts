import { CapabilityDispatch } from '../src/dispatcher';
import fs from 'fs';
import path from 'path';

jest.mock('fs');

describe('CapabilityDispatch Unit Tests', () => {
  let dispatcher: CapabilityDispatch;
  let mockManagedClients: Map<string, any>;
  let mockLocalPrompts: Map<string, any>;

  beforeEach(() => {
    mockManagedClients = new Map();
    mockLocalPrompts = new Map();
    
    // Setup typical mocks
    mockManagedClients.set('test-prefix', {
      prefix: 'test-prefix',
      getClient: jest.fn().mockResolvedValue({ 
        name: 'mock-client',
        readResource: jest.fn().mockResolvedValue({ contents: [{ text: 'remote content' }] }),
        getPrompt: jest.fn().mockResolvedValue({ messages: [{ role: 'user', content: { type: 'text', text: 'remote prompt' } }] })
      })
    });
    
    mockLocalPrompts.set('test-prefix__local-prompt', {
      name: 'local-prompt',
      description: 'Local test prompt',
      pkgPath: '/tmp/pkg',
      file: 'prompt.md'
    });

    dispatcher = new CapabilityDispatch(mockManagedClients as any, mockLocalPrompts);
    jest.clearAllMocks();
  });

  describe('Name Scoping & Parsing', () => {
    test('scopeName correctly formats prefix__name', () => {
      expect(dispatcher.scopeName('my-pkg', 'my-tool')).toBe('my-pkg__my-tool');
    });

    test('parseName correctly parses scoped names', () => {
      const parsed = dispatcher.parseName('test-prefix__local-prompt');
      expect(parsed.prefix).toBe('test-prefix');
      expect(parsed.name).toBe('local-prompt');
    });

    test('parseName throws error on missing delimiter', () => {
      expect(() => {
        dispatcher.parseName('invalid-name-without-delimiter');
      }).toThrow('Invalid name format');
    });

    test('parseName throws error on unknown prefix', () => {
      expect(() => {
        dispatcher.parseName('unknown-prefix__some-tool');
      }).toThrow('Unknown prefix');
    });
  });

  describe('URI Scoping & Unscoping', () => {
    test('scopeUri correctly formats standard URIs', () => {
      const scoped = dispatcher.scopeUri('test-prefix', 'file:///path/to/resource.md');
      expect(scoped).toBe('mcp://test-prefix/file//path/to/resource.md');
    });

    test('scopeUri falls back to raw scoping for non-standard URIs', () => {
      const scoped = dispatcher.scopeUri('test-prefix', 'raw-value');
      expect(scoped).toBe('mcp://test-prefix/raw/raw-value');
    });

    test('unscopeUri parses scoped standard URIs correctly', () => {
      const unscoped = dispatcher.unscopeUri('mcp://test-prefix/file//path/to/resource.md');
      expect(unscoped).not.toBeNull();
      expect(unscoped?.prefix).toBe('test-prefix');
      expect(unscoped?.originalUri).toBe('file:///path/to/resource.md');
    });

    test('unscopeUri parses raw scoped values correctly', () => {
      const unscoped = dispatcher.unscopeUri('mcp://test-prefix/raw/raw-value');
      expect(unscoped).not.toBeNull();
      expect(unscoped?.prefix).toBe('test-prefix');
      expect(unscoped?.originalUri).toBe('raw-value');
    });

    test('unscopeUri returns null for invalid formats', () => {
      expect(dispatcher.unscopeUri('http://external.com')).toBeNull();
    });
  });

  describe('Aggregation & Dispatch', () => {
    test('listAllTools aggregates and scopes tools', () => {
      const cached = new Map([['pkg1', [{ name: 'tool1', description: 'd1' }]]]);
      const tools = dispatcher.listAllTools(cached as any);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('pkg1__tool1');
    });

    test('listAllPrompts aggregates local and remote prompts', () => {
      const cached = new Map([['pkg1', [{ name: 'prompt1' }]]]);
      const prompts = dispatcher.listAllPrompts(cached as any);
      // local-prompt (1) + pkg1__prompt1 (1) = 2
      expect(prompts.length).toBeGreaterThanOrEqual(2);
      expect(prompts.some(p => p.name === 'test-prefix__local-prompt')).toBe(true);
      expect(prompts.some(p => p.name === 'pkg1__prompt1')).toBe(true);
    });

    test('getPrompt dispatches to local prompt', async () => {
      (fs.readFileSync as jest.Mock).mockReturnValue('local content');
      const result = await dispatcher.getPrompt('test-prefix__local-prompt');
      expect(result.messages[0].content.text).toBe('local content');
      expect(fs.readFileSync).toHaveBeenCalled();
    });

    test('getPrompt dispatches to remote server', async () => {
      const result = await dispatcher.getPrompt('test-prefix__remote-prompt');
      expect(result.messages[0].content.text).toBe('remote prompt');
    });

    test('listAllResources aggregates local and remote resources', () => {
      dispatcher.addLocalResource('mcp://agentbrew/instructions/pkg1/GEMINI.md', { pkgPath: '/tmp', file: 'GEMINI.md' });
      const cached = new Map([['pkg1', [{ uri: 'file:///r1', name: 'res1' }]]]);
      const resources = dispatcher.listAllResources(cached as any);
      expect(resources.length).toBeGreaterThanOrEqual(2);
      expect(resources.some(r => r.uri.includes('GEMINI.md'))).toBe(true);
      expect(resources.some(r => r.uri === 'mcp://pkg1/file//r1')).toBe(true);
    });

    test('readResource dispatches to local resource', async () => {
      const uri = 'mcp://agentbrew/instructions/pkg1/GEMINI.md';
      dispatcher.addLocalResource(uri, { pkgPath: '/tmp', file: 'GEMINI.md' });
      (fs.readFileSync as jest.Mock).mockReturnValue('markdown content');
      
      const result = await dispatcher.readResource(uri);
      expect(result.contents[0].text).toBe('markdown content');
    });

    test('readResource dispatches to remote resource via mapping', async () => {
      const scopedUri = 'mcp://test-prefix/file//r1';
      dispatcher.addResourceMapping(scopedUri, 'test-prefix', 'file:///r1');
      
      const result = await dispatcher.readResource(scopedUri);
      expect(result.contents[0].text).toBe('remote content');
    });
  });

  describe('Client Retrieval', () => {
    test('getClient retrieves and spawns client successfully', async () => {
      const client = await dispatcher.getClient('test-prefix');
      expect(client).toBeDefined();
      expect(mockManagedClients.get('test-prefix').getClient).toHaveBeenCalled();
    });

    test('getClient throws on unknown prefix', async () => {
      await expect(dispatcher.getClient('unknown-prefix')).rejects.toThrow('No client found');
    });
  });
});
