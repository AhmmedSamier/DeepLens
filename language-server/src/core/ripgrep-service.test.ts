import { describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { RipgrepService } from './ripgrep-service';

describe('RipgrepService', () => {
    test('should only call chmodSync once during initialization', async () => {
        // Spy on chmodSync
        const chmodSpy = spyOn(fs, 'chmodSync');

        const rootDir = path.resolve(__dirname, '../../..');

        // Create a dummy file to search
        const dummyFile = path.join(rootDir, 'test-dummy.txt');
        fs.writeFileSync(dummyFile, 'content');

        try {
            const service = new RipgrepService(rootDir);

            if (!service.isAvailable()) {
                console.warn('Ripgrep binary not found! Skipping test assertions relying on execution.');
                return;
            }

            // Should be called once in constructor (on non-Windows)
            const initialCalls = chmodSpy.mock.calls.length;
            if (process.platform !== 'win32') {
                expect(initialCalls).toBeGreaterThanOrEqual(1);
            }

            // Perform searches
            for (let i = 0; i < 10; i++) {
                await service.search('content', [dummyFile]);
            }

            // Calls should not increase
            expect(chmodSpy.mock.calls.length).toBe(initialCalls);
        } finally {
            if (fs.existsSync(dummyFile)) {
                fs.unlinkSync(dummyFile);
            }
            chmodSpy.mockRestore();
        }
    });
});
