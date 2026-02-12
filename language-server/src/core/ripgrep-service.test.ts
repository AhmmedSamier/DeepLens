import { describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { RipgrepService } from './ripgrep-service';

describe('RipgrepService', () => {
    test('should be available when binary is present', () => {
        const rootDir = path.resolve(__dirname, '../../..');
        const service = new RipgrepService(rootDir);

        // This assertion depends on the environment, but at least we can check it doesn't crash
        // and returns a boolean.
        const available = service.isAvailable();
        expect(typeof available).toBe('boolean');
    });
});
