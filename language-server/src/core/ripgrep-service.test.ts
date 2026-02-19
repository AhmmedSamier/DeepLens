import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RipgrepService } from './ripgrep-service';

let originalPlatform = process.platform;

const setPlatform = (value: NodeJS.Platform) => {
    Object.defineProperty(process, 'platform', {
        value,
        configurable: true,
    });
};

afterEach(() => {
    setPlatform(originalPlatform);
});

describe('RipgrepService', () => {
    test('should be available when binary is present', () => {
        const rootDir = path.resolve(__dirname, '../../..');
        const service = new RipgrepService(rootDir);

        const available = service.isAvailable();
        expect(typeof available).toBe('boolean');
    });

    test('should detect darwin arm64 binary when present', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deeplens-rg-'));
        const binDir = path.join(tempRoot, 'dist', 'bin');
        fs.mkdirSync(binDir, { recursive: true });
        fs.writeFileSync(path.join(binDir, 'rg-darwin-arm64'), '');

        setPlatform('darwin');

        const service = new RipgrepService(tempRoot);
        expect(service.isAvailable()).toBe(true);

        fs.rmSync(tempRoot, { recursive: true, force: true });
    });
});
