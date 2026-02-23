/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as path from 'node:path';
import { Config } from './config';
import { IndexerEnvironment } from './indexer-interfaces';
import { TreeSitterParser } from './tree-sitter-parser';
import { WorkspaceIndexer } from './workspace-indexer';

class TestWorkspaceIndexer extends WorkspaceIndexer {
    public gitResults: Record<string, { stdout?: string; error?: any }> = {};

    protected async execGit(args: string[], cwd: string, input?: string): Promise<string> {
        const fullCommand = args.join(' ');
        for (const key in this.gitResults) {
            if (fullCommand.includes(key)) {
                const res = this.gitResults[key];
                if (res.error) throw res.error;
                return res.stdout || '';
            }
        }
        throw new Error(`Unexpected git command: ${fullCommand}`);
    }

    public async checkIsGitIgnored(filePath: string): Promise<boolean> {
        // @ts-expect-error - testing protected method
        return this.isGitIgnored(filePath);
    }

    public checkShouldExcludeFile(filePath: string): boolean {
        // @ts-expect-error - testing protected method
        return this.shouldExcludeFile(filePath);
    }

    public triggerUpdateExcludeMatchers(): void {
        // @ts-expect-error - testing protected method
        this.updateExcludeMatchers();
    }

    public getGitCheckTimer(): NodeJS.Timeout | null {
        // @ts-expect-error - testing protected property
        return this.gitCheckTimer;
    }

    public getWatcherCooldownTimer(): NodeJS.Timeout | null {
        // @ts-expect-error - testing protected property
        return this.watcherCooldownTimer;
    }

    public setGitCheckTimer(timer: NodeJS.Timeout | null): void {
        // @ts-expect-error - testing protected property
        this.gitCheckTimer = timer;
    }

    public setWatcherCooldownTimer(timer: NodeJS.Timeout | null): void {
        // @ts-expect-error - testing protected property
        this.watcherCooldownTimer = timer;
    }

    public testIntern(str: string): string {
        // @ts-expect-error - testing protected method
        return this.intern(str);
    }

    public getStringCacheSize(): number {
        // @ts-expect-error - testing protected property
        return this.stringCache.size;
    }
}

describe('WorkspaceIndexer', () => {
    // Mock dependencies
    const mockConfig = new Config();
    const mockEnv: IndexerEnvironment = {
        getWorkspaceFolders: () => ['/root'],
        findFiles: async () => [],
        asRelativePath: (p) => p.replace('/root/', ''),
        log: () => {},
    };

    // We can cast mock to any because we won't strictly use all methods
    const mockTreeSitter = {} as unknown as TreeSitterParser;

    it('should return true if git check-ignore succeeds (exit code 0)', async () => {
        const indexer = new TestWorkspaceIndexer(mockConfig, mockTreeSitter, mockEnv, process.cwd());

        // Mock git behavior: success = ignored
        // Format: source \0 line \0 pattern \0 path \0
        // We simulate that 'check-ignore' was called and returned this output
        indexer.gitResults['check-ignore'] = {
            stdout: '.gitignore\0' + '1\0*\0/root/ignored.txt\0',
        };

        const result = await indexer.checkIsGitIgnored('/root/ignored.txt');
        expect(result).toBe(true);
    });

    it('should return false if git check-ignore fails (exit code 1)', async () => {
        const indexer = new TestWorkspaceIndexer(mockConfig, mockTreeSitter, mockEnv, process.cwd());

        // Mock git behavior: failure with code 1 = none ignored
        // This triggers the catch block which resolves false
        indexer.gitResults['check-ignore'] = { error: { code: 1 } };

        const result = await indexer.checkIsGitIgnored('/root/tracked.txt');
        expect(result).toBe(false);
    });

    it('should return false if not in a workspace folder', async () => {
        const indexer = new TestWorkspaceIndexer(mockConfig, mockTreeSitter, mockEnv, process.cwd());

        const result = await indexer.checkIsGitIgnored('/outside/file.txt');
        expect(result).toBe(false);
    });

    it('should return false if config disables gitignore', async () => {
        const customConfig = new Config();
        customConfig.update({ respectGitignore: false });

        const indexer = new TestWorkspaceIndexer(customConfig, mockTreeSitter, mockEnv, process.cwd());

        // Even if git would say ignored...
        indexer.gitResults['check-ignore'] = { stdout: 'ignored' };

        const result = await indexer.checkIsGitIgnored('/root/file.txt');
        expect(result).toBe(false);
    });

    it('should exclude files based on default exclude patterns', () => {
        const indexer = new TestWorkspaceIndexer(mockConfig, mockTreeSitter, mockEnv, process.cwd());

        expect(indexer.checkShouldExcludeFile('/root/node_modules/package.json')).toBe(true);
        expect(indexer.checkShouldExcludeFile('/root/dist/bundle.js')).toBe(true);
        expect(indexer.checkShouldExcludeFile('/root/src/index.ts')).toBe(false);
    });

    it('should update exclude patterns when config changes', () => {
        const customConfig = new Config();
        const indexer = new TestWorkspaceIndexer(customConfig, mockTreeSitter, mockEnv, process.cwd());

        expect(indexer.checkShouldExcludeFile('/root/temp/temp.js')).toBe(false);

        customConfig.update({ excludePatterns: ['**/temp/**'] });

        indexer.triggerUpdateExcludeMatchers();

        expect(indexer.checkShouldExcludeFile('/root/temp/temp.js')).toBe(true);
    });

    describe('dispose', () => {
        it('should clear timers on dispose', () => {
            const indexer = new TestWorkspaceIndexer(mockConfig, mockTreeSitter, mockEnv, process.cwd());

            indexer.setGitCheckTimer(setTimeout(() => {}, 10000) as unknown as NodeJS.Timeout);
            indexer.setWatcherCooldownTimer(setTimeout(() => {}, 10000) as unknown as NodeJS.Timeout);

            expect(indexer.getGitCheckTimer()).not.toBeNull();
            expect(indexer.getWatcherCooldownTimer()).not.toBeNull();

            indexer.dispose();

            expect(indexer.getGitCheckTimer()).toBeNull();
            expect(indexer.getWatcherCooldownTimer()).toBeNull();
        });
    });

    describe('stringCache', () => {
        it('should cache strings and return same reference', () => {
            const indexer = new TestWorkspaceIndexer(mockConfig, mockTreeSitter, mockEnv, process.cwd());

            const str1 = indexer.testIntern('/path/to/file.ts');
            const str2 = indexer.testIntern('/path/to/file.ts');

            expect(str1).toBe(str2);
        });

        it('should evict oldest entry when cache exceeds max size', () => {
            const indexer = new TestWorkspaceIndexer(mockConfig, mockTreeSitter, mockEnv, process.cwd());

            const maxSize = 10000;
            for (let i = 0; i < maxSize + 100; i++) {
                indexer.testIntern(`/unique/path/${i}.ts`);
            }

            expect(indexer.getStringCacheSize()).toBeLessThanOrEqual(maxSize);
        });
    });
});
