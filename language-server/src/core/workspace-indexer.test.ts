/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, expect, it } from 'bun:test';
import { Config } from './config';
import { IndexerEnvironment } from './indexer-interfaces';
import { TreeSitterParser } from './tree-sitter-parser';
import { WorkspaceIndexer } from './workspace-indexer';

// Subclass to override execGit
class TestWorkspaceIndexer extends WorkspaceIndexer {
    public gitResults: Record<string, { stdout?: string; error?: any }> = {};

    protected async execGit(args: string[], cwd: string): Promise<string> {
        const fullCommand = args.join(' ');
        // Find a matching result
        for (const key in this.gitResults) {
            if (fullCommand.includes(key)) {
                const res = this.gitResults[key];
                if (res.error) throw res.error;
                return res.stdout || '';
            }
        }
        throw new Error(`Unexpected git command: ${fullCommand}`);
    }

    // Expose protected method for testing
    public async checkIsGitIgnored(filePath: string): Promise<boolean> {
        // @ts-ignore
        return this.isGitIgnored(filePath);
    }

    public checkShouldExcludeFile(filePath: string): boolean {
        // @ts-ignore
        return this.shouldExcludeFile(filePath);
    }

    public triggerUpdateExcludeMatchers(): void {
        // @ts-ignore
        this.updateExcludeMatchers();
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
        indexer.gitResults['check-ignore'] = { stdout: '/root/ignored.txt' };

        const result = await indexer.checkIsGitIgnored('/root/ignored.txt');
        expect(result).toBe(true);
    });

    it('should return false if git check-ignore fails (exit code 1)', async () => {
        const indexer = new TestWorkspaceIndexer(mockConfig, mockTreeSitter, mockEnv, process.cwd());

        // Mock git behavior: failure with code 1 = not ignored
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

        // Initially matches defaults
        expect(indexer.checkShouldExcludeFile('/root/temp/temp.js')).toBe(false);

        // Update config
        customConfig.update({ excludePatterns: ['**/temp/**'] });

        // Trigger update (simulating what happens in indexWorkspace or manually)
        indexer.triggerUpdateExcludeMatchers();

        expect(indexer.checkShouldExcludeFile('/root/temp/temp.js')).toBe(true);
    });
});
