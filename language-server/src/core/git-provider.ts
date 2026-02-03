import * as cp from 'child_process';
import * as path from 'path';

/**
 * Provides access to Git status for filtering search results
 */
export class GitProvider {
    private workspaceRoots: string[] = [];

    constructor(workspaceRoots: string[] = []) {
        this.workspaceRoots = workspaceRoots;
    }

    public setWorkspaceRoots(roots: string[]): void {
        this.workspaceRoots = roots;
    }

    /**
     * Get list of all modified and untracked files across all workspace roots
     */
    public async getModifiedFiles(): Promise<Set<string>> {
        const modifiedFiles = new Set<string>();
        console.error('[GitProvider] Getting modified files...');

        await Promise.all(
            this.workspaceRoots.map(async (root) => {
                try {
                    console.error(`[GitProvider] Checking root: ${root}`);
                    const gitRoot = await this.getGitRoot(root);
                    console.error(`[GitProvider] Detected git root: ${gitRoot}`);

                    // 1. Get modified tracked files
                    const modifiedOutput = await this.execGit(['diff', '--name-only'], root);
                    if (modifiedOutput.trim()) {
                         console.error(`[GitProvider] git diff output length: ${modifiedOutput.length}`);
                    }
                    this.addFilesToSet(modifiedFiles, gitRoot, modifiedOutput);

                    // 2. Get modified staged files
                    const stagedOutput = await this.execGit(['diff', '--name-only', '--cached'], root);
                    if (stagedOutput.trim()) {
                         console.error(`[GitProvider] git diff cached output length: ${stagedOutput.length}`);
                    }
                    this.addFilesToSet(modifiedFiles, gitRoot, stagedOutput);

                    // 3. Get untracked files
                    const untrackedOutput = await this.execGit(
                        ['ls-files', '--others', '--exclude-standard'],
                        root,
                    );
                     if (untrackedOutput.trim()) {
                         console.error(`[GitProvider] untracked output length: ${untrackedOutput.length}`);
                    }
                    this.addFilesToSet(modifiedFiles, gitRoot, untrackedOutput);
                } catch (error) {
                    console.error(`[GitProvider] Error in root ${root}:`, error);
                }
            }),
        );

        console.error(`[GitProvider] Total modified files found: ${modifiedFiles.size}`);
        if (modifiedFiles.size > 0) {
            console.error(`[GitProvider] Sample modified file: ${Array.from(modifiedFiles)[0]}`);
        }
        return modifiedFiles;
    }

    private async getGitRoot(cwd: string): Promise<string> {
        try {
            const output = await this.execGit(['rev-parse', '--show-toplevel'], cwd);
            let gitRoot = output.trim();
            // Git on Windows might return Unix-style path /d/... or D:/...
            if (process.platform === 'win32') {
                 // Check if it looks like /d/foo/bar
                 const unixMatch = gitRoot.match(/^[/\\]([a-z])[/\\](.+)$/i);
                 if (unixMatch) {
                     const drive = unixMatch[1].toUpperCase();
                     const restPath = unixMatch[2].replace(/\//g, '\\');
                     gitRoot = `${drive}:\\${restPath}`;
                 } else {
                     // Just normalize slashes
                     gitRoot = path.normalize(gitRoot);
                 }
            }
            return gitRoot;
        } catch {
            return cwd; // Fallback to cwd if not a git repo or error
        }
    }

    private addFilesToSet(set: Set<string>, root: string, output: string): void {
        const lines = output.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
                const fullPath = this.normalizeGitPath(root, trimmed);
                set.add(fullPath);
            }
        }
    }

    /**
     * Normalize Git paths to ensure consistent format on Windows.
     * Git on Windows (especially from Git Bash) may return Unix-style paths like /d/source-code/...
     * which need to be converted to Windows-style paths like D:\source-code\...
     */
    private normalizeGitPath(root: string, relativePath: string): string {
        const rootIsWindows = this.isWindowsPath(root) || path.win32.isAbsolute(root);
        const normalizedRoot = rootIsWindows ? this.convertWindowsPath(root) : root;
        const joinedPath = rootIsWindows
            ? path.win32.join(normalizedRoot, relativePath)
            : path.join(normalizedRoot, relativePath);
        const normalized = rootIsWindows ? path.win32.normalize(joinedPath) : path.normalize(joinedPath);

        return rootIsWindows ? this.convertWindowsPath(normalized) : normalized;
    }

    /**
     * Convert Unix-style Windows paths to proper Windows paths.
     * Examples:
     *   /d/source-code/project -> D:\source-code\project
     *   \d\source-code\project -> D:\source-code\project
     */
    private convertWindowsPath(filePath: string): string {
        const match = filePath.match(/^[/\\]([a-z])[/\\](.+)$/i);
        if (match) {
            const drive = match[1].toUpperCase();
            const restPath = match[2].replace(/\//g, '\\');
            return `${drive}:\\${restPath}`;
        }
        return path.win32.normalize(filePath);
    }

    private isWindowsPath(filePath: string): boolean {
        return /^[a-zA-Z]:/.test(filePath) || /^[\\/][a-zA-Z][\\/]/.test(filePath);
    }

    private async execGit(args: string[], cwd: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const child = cp.spawn('git', args, { cwd });

            let stdout = '';

            child.stdout.on('data', (chunk) => {
                stdout += chunk.toString();
            });

            child.on('error', (err) => {
                reject(err);
            });

            child.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Git exited with code ${code}`));
                }
            });
        });
    }
}
