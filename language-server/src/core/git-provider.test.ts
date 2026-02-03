import { describe, expect, it, beforeAll } from 'bun:test';
import { GitProvider } from './git-provider';
import * as path from 'path';

describe('GitProvider', () => {
    let provider: GitProvider;

    beforeAll(() => {
        provider = new GitProvider();
    });
    describe('Path normalization on Windows', () => {
        it('should convert Unix-style Windows paths to Windows format', () => {
            const provider = new GitProvider([]);
            const root = 'D:\\source-code\\enozom\\dayoff-dotnet';
            const relativePath = 'Code/admin/package.json';

            const result = provider['normalizeGitPath'](root, relativePath);
            expect(result).toBe('D:\\source-code\\enozom\\dayoff-dotnet\\Code\\admin\\package.json');
        });

        it('should handle Unix-style /d/ paths', () => {
            const provider = new GitProvider([]);
            const root = '\\d\\source-code\\enozom\\dayoff-dotnet';
            const relativePath = 'Code/admin/package.json';

            const result = provider['normalizeGitPath'](root, relativePath);
            expect(result).toBe('D:\\source-code\\enozom\\dayoff-dotnet\\Code\\admin\\package.json');
        });

        it('should preserve normal Windows paths', () => {
            const provider = new GitProvider([]);
            const root = 'D:\\source-code\\project';
            const relativePath = 'src/file.ts';

            const result = provider['normalizeGitPath'](root, relativePath);
            expect(result).toBe('D:\\source-code\\project\\src\\file.ts');
        });

        it('should normalize forward slashes to backslashes', () => {
            const provider = new GitProvider([]);
            const root = 'D:\\source-code\\project';
            const relativePath = 'src/nested/file.ts';

            const result = provider['normalizeGitPath'](root, relativePath);
            expect(result).toBe('D:\\source-code\\project\\src\\nested\\file.ts');
        });
    });

    describe('convertWindowsPath', () => {
        it('should convert /d/source-code to D:\\source-code', () => {
            const provider = new GitProvider([]);
            const result = provider['convertWindowsPath']('/d/source-code/project');
            expect(result).toBe('D:\\source-code\\project');
        });

        it('should convert \\d\\source-code to D:\\source-code', () => {
            const provider = new GitProvider([]);
            const result = provider['convertWindowsPath']('\\d\\source-code\\project');
            expect(result).toBe('D:\\source-code\\project');
        });

        it('should convert /D/source-code to D:\\source-code', () => {
            const provider = new GitProvider([]);
            const result = provider['convertWindowsPath']('/D/source-code/project');
            expect(result).toBe('D:\\source-code\\project');
        });

        it('should handle lowercase and uppercase drive letters', () => {
            const provider = new GitProvider([]);
            const result1 = provider['convertWindowsPath']('/c/users/user/file.txt');
            const result2 = provider['convertWindowsPath']('/C/users/user/file.txt');
            expect(result1).toBe('C:\\users\\user\\file.txt');
            expect(result2).toBe('C:\\users\\user\\file.txt');
        });

        it('should return normalized path for non-Git-Bash paths', () => {
            const provider = new GitProvider([]);
            const result = provider['convertWindowsPath']('D:\\source-code\\project\\file.ts');
            expect(result).toBe('D:\\source-code\\project\\file.ts');
        });
    });

    describe('Real-world scenario - Modified files detection', () => {
        it('should correctly match Git output with indexed file paths', () => {
            const workspaceRoot = 'D:\\source-code\\enozom\\dayoff-dotnet';
            const gitOutput = 'Code/admin/src/app/pages/customers/customers-list/customers-list.component.ts';
            const indexedFilePath = path.normalize('D:\\source-code\\enozom\\dayoff-dotnet\\Code\\admin\\src\\app\\pages\\customers\\customers-list\\customers-list.component.ts');

            const modifiedSet = new Set<string>();
            provider['addFilesToSet'](modifiedSet, workspaceRoot, gitOutput);

            const normalizedGitPath = provider['normalizeGitPath'](workspaceRoot, gitOutput);
            expect(normalizedGitPath).toBe(indexedFilePath);
            expect(modifiedSet.has(indexedFilePath)).toBe(true);
        });

        it('should handle multiple modified files from git diff --name-only', () => {
            const workspaceRoot = 'D:\\\\source-code\\\\project';
            const gitOutput = `src/file1.ts
src/file2.ts
src/components/component.ts`;

            const modifiedFiles = new Set<string>();
            provider['addFilesToSet'](modifiedFiles, workspaceRoot, gitOutput);

            expect(modifiedFiles.size).toBe(3);
            const expectedPath1 = path.normalize('D:\\\\source-code\\\\project\\\\src\\\\file1.ts');
            const expectedPath2 = path.normalize('D:\\\\source-code\\\\project\\\\src\\\\file2.ts');
            const expectedPath3 = path.normalize('D:\\\\source-code\\\\project\\\\src\\\\components\\\\component.ts');
            expect(modifiedFiles.has(expectedPath1)).toBe(true);
            expect(modifiedFiles.has(expectedPath2)).toBe(true);
            expect(modifiedFiles.has(expectedPath3)).toBe(true);
        });

        it('should normalize paths consistently for Set lookup', () => {
            const workspaceRoot = 'D:\\source-code\\project';
            const gitPath = 'src/file.ts';
            const indexedPath = path.normalize('D:\\source-code\\project\\src\\file.ts');

            const modifiedSet = new Set<string>();
            provider['addFilesToSet'](modifiedSet, workspaceRoot, gitPath);

            expect(modifiedSet.has(indexedPath)).toBe(true);
        });
    });
});
