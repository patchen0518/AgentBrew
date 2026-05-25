import { program } from '../src/cli';
import { discoverPackages } from '../src/registry';
import { isPackageEnabled } from '../src/state';
import { Logger } from '../src/logger';

// Mock registry and state
jest.mock('../src/registry', () => ({
    discoverPackages: jest.fn(),
}));

jest.mock('../src/state', () => ({
    isPackageEnabled: jest.fn(),
    enablePackage: jest.fn(),
    disablePackage: jest.fn(),
}));

// Mock logger to avoid polluting test output and to capture calls
jest.mock('../src/logger', () => ({
    Logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
    }
}));

describe('Grouped List CLI Command', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        program.exitOverride();
    });

    it('should list all packages grouped by packageName', async () => {
        const mockPackages = [
            {
                packageName: 'hallmark',
                path: '/path/to/hallmark',
                isEnabled: true,
                manifest: {
                    name: 'hallmark',
                    version: '1.0.0',
                    servers: [
                        { name: 'skill-A', command: 'node', args: [], description: 'Server A' }
                    ],
                    prompts: [
                        { name: 'prompt-A', file: 'promptA.md', description: 'Prompt A' }
                    ]
                }
            },
            {
                packageName: 'extra-pkg',
                path: '/path/to/extra-pkg',
                isEnabled: false,
                manifest: {
                    name: 'extra-pkg',
                    version: '2.0.0',
                    servers: [
                        { name: 'skill-B', command: 'python', args: [], description: 'Server B' }
                    ]
                }
            }
        ];

        (discoverPackages as jest.Mock).mockReturnValue(mockPackages);
        
        // Mock enablement checks:
        (isPackageEnabled as jest.Mock).mockImplementation((pkgName: string, capName?: string) => {
            if (pkgName === 'hallmark') {
                if (capName) return true; // skill-A and prompt-A are enabled
                return true;
            }
            if (pkgName === 'extra-pkg') {
                if (capName) return false;
                return false;
            }
            return true;
        });

        // Run the command
        await program.parseAsync(['node', 'agentbrew', 'list']);

        // Verify Logger.info calls
        expect(Logger.info).toHaveBeenCalledWith("Installed Packages:");
        expect(Logger.info).toHaveBeenCalledWith("====================");

        // Verify grouping and enablement statuses are logged
        expect(Logger.info).toHaveBeenCalledWith("\n[ENABLED] hallmark");
        expect(Logger.info).toHaveBeenCalledWith("  ├── [MCP] skill-A [ENABLED] - Server A");
        expect(Logger.info).toHaveBeenCalledWith("  ├── [SKILL] prompt-A [ENABLED] - Prompt A");

        expect(Logger.info).toHaveBeenCalledWith("\n[DISABLED] extra-pkg");
        expect(Logger.info).toHaveBeenCalledWith("  ├── [MCP] skill-B [DISABLED] - Server B");
    });

    it('should filter list output by package name', async () => {
        const mockPackages = [
            {
                packageName: 'hallmark',
                path: '/path/to/hallmark',
                isEnabled: true,
                manifest: {
                    name: 'hallmark',
                    version: '1.0.0',
                    servers: [{ name: 'skill-A', command: 'node', args: [], description: 'Server A' }]
                }
            },
            {
                packageName: 'extra-pkg',
                path: '/path/to/extra-pkg',
                isEnabled: false,
                manifest: {
                    name: 'extra-pkg',
                    version: '2.0.0',
                    servers: [{ name: 'skill-B', command: 'python', args: [] }]
                }
            }
        ];

        (discoverPackages as jest.Mock).mockReturnValue(mockPackages);
        (isPackageEnabled as jest.Mock).mockReturnValue(true);

        // Run list command with package name filter
        await program.parseAsync(['node', 'agentbrew', 'list', 'hallmark']);

        expect(Logger.info).toHaveBeenCalledWith("\n[ENABLED] hallmark");
        expect(Logger.info).not.toHaveBeenCalledWith("\n[ENABLED] extra-pkg");
    });

    it('should print informative message when no packages match the filter', async () => {
        (discoverPackages as jest.Mock).mockReturnValue([]);
        await program.parseAsync(['node', 'agentbrew', 'list', 'nonexistent']);
        expect(Logger.info).toHaveBeenCalledWith("Package 'nonexistent' not found.");
    });
});
