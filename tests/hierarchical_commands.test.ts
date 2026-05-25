import { program } from '../src/cli';
import { discoverPackages } from '../src/registry';
import { enablePackage, disablePackage } from '../src/state';
import { Logger } from '../src/logger';
import fs from 'fs';
import path from 'path';

// Mock registry, state, and fs
jest.mock('../src/registry', () => ({
    discoverPackages: jest.fn(),
}));

jest.mock('../src/state', () => ({
    isPackageEnabled: jest.fn(),
    enablePackage: jest.fn(),
    disablePackage: jest.fn(),
}));

jest.mock('fs', () => {
    const actualFs = jest.requireActual('fs');
    return {
        ...actualFs,
        existsSync: jest.fn(),
        readFileSync: jest.fn(),
        writeFileSync: jest.fn(),
        rmSync: jest.fn(),
    };
});

// Mock logger to capture output
jest.mock('../src/logger', () => ({
    Logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
    }
}));

describe('Hierarchical CLI Commands', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        program.exitOverride();
    });

    describe('Enable/Disable Commands', () => {
        it('should enable/disable package without capability', async () => {
            (enablePackage as jest.Mock).mockReturnValue(true);
            await program.parseAsync(['node', 'agentbrew', 'enable', 'my-pkg']);
            expect(enablePackage).toHaveBeenCalledWith('my-pkg');
            expect(Logger.info).toHaveBeenCalledWith("Enabled package 'my-pkg'");

            (disablePackage as jest.Mock).mockReturnValue(true);
            await program.parseAsync(['node', 'agentbrew', 'disable', 'my-pkg']);
            expect(disablePackage).toHaveBeenCalledWith('my-pkg');
            expect(Logger.info).toHaveBeenCalledWith("Disabled package 'my-pkg'");
        });

        it('should enable/disable capability with format package:capability', async () => {
            (enablePackage as jest.Mock).mockReturnValue(true);
            await program.parseAsync(['node', 'agentbrew', 'enable', 'my-pkg', 'my-cap']);
            expect(enablePackage).toHaveBeenCalledWith('my-pkg:my-cap');
            expect(Logger.info).toHaveBeenCalledWith("Enabled capability 'my-cap' in package 'my-pkg'");

            (disablePackage as jest.Mock).mockReturnValue(true);
            await program.parseAsync(['node', 'agentbrew', 'disable', 'my-pkg', 'my-cap']);
            expect(disablePackage).toHaveBeenCalledWith('my-pkg:my-cap');
            expect(Logger.info).toHaveBeenCalledWith("Disabled capability 'my-cap' in package 'my-pkg'");
        });
    });

    describe('Uninstall Command', () => {
        it('should uninstall whole package when capability is not specified', async () => {
            const mockPackages = [{
                packageName: 'pkg1',
                path: '/path/to/pkg1',
                manifest: { name: 'pkg1', version: '1.0.0' },
                isEnabled: true
            }];
            (discoverPackages as jest.Mock).mockReturnValue(mockPackages);

            await program.parseAsync(['node', 'agentbrew', 'uninstall', 'pkg1']);

            expect(fs.rmSync).toHaveBeenCalledWith('/path/to/pkg1', { recursive: true, force: true });
            expect(Logger.info).toHaveBeenCalledWith("Successfully uninstalled package 'pkg1'");
        });

        it('should uninstall specific skill capability from manifest and delete file', async () => {
            const mockPackages = [{
                packageName: 'pkg1',
                path: '/path/to/pkg1',
                manifest: {
                    name: 'pkg1',
                    version: '1.0.0',
                    prompts: [
                        { name: 'skill1', file: 'skill1.md', description: 'Skill 1' },
                        { name: 'skill2', file: 'skill2.md', description: 'Skill 2' }
                    ]
                },
                isEnabled: true
            }];
            (discoverPackages as jest.Mock).mockReturnValue(mockPackages);
            (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
                if (p.endsWith('agentbrew.toml') || p.endsWith('skill1.md')) return true;
                return false;
            });
            (fs.readFileSync as jest.Mock).mockReturnValue(`
name = "pkg1"
version = "1.0.0"
[[prompts]]
name = "skill1"
file = "skill1.md"
description = "Skill 1"
[[prompts]]
name = "skill2"
file = "skill2.md"
description = "Skill 2"
`);

            await program.parseAsync(['node', 'agentbrew', 'uninstall', 'pkg1', 'skill1']);

            // Should rewrite agentbrew.toml without skill1
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                path.join('/path/to/pkg1', 'agentbrew.toml'),
                expect.not.stringContaining('skill1'),
                'utf-8'
            );
            // Should delete the prompt file
            expect(fs.rmSync).toHaveBeenCalledWith(path.join('/path/to/pkg1', 'skill1.md'), { force: true });
            expect(Logger.info).toHaveBeenCalledWith("Successfully uninstalled capability 'skill1' from package 'pkg1'");
        });
    });
});
