import { isPackageEnabled, disablePackage, enablePackage } from '../src/state';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Hierarchical State Management', () => {
    beforeEach(() => {
        // Clear state before each test
        const BREW_ROOT = process.env.AGENTBREW_ROOT || path.join(os.homedir(), '.agentbrew');
        const STATE_FILE = path.join(BREW_ROOT, 'state.json');
        if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    });

    it('should return true if both package and capability are enabled', () => {
        expect(isPackageEnabled('pkg1', 'cap1')).toBe(true);
    });

    it('should return false if the parent package is disabled', () => {
        disablePackage('pkg1');
        expect(isPackageEnabled('pkg1', 'cap1')).toBe(false);
    });

    it('should return false if only the specific capability is disabled', () => {
        disablePackage('pkg1:cap1');
        expect(isPackageEnabled('pkg1', 'cap1')).toBe(false);
    });

    it('should allow enabling a capability even if the package is disabled (but still return false)', () => {
        disablePackage('pkg1');
        enablePackage('pkg1:cap1');
        expect(isPackageEnabled('pkg1', 'cap1')).toBe(false);
    });
});
