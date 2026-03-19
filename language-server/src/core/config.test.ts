import { describe, expect, it } from 'bun:test';
import { Config } from './config';

describe('Config', () => {
    it('should include .NET and vendor folders in default exclude patterns', () => {
        const config = new Config();
        const patterns = config.getExcludePatterns();
        expect(patterns).toContain('**/bin/**');
        expect(patterns).toContain('**/obj/**');
        expect(patterns).toContain('**/vendor/**');
    });
});
