import * as cp from 'node:child_process';
import * as path from 'node:path';

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

        await Promise.all(
            this.workspaceRoots.map(async (root) => {
                try {
                    // Run git commands in parallel
                    const [modifiedOutput, stagedOutput, untrackedOutput] = await Promise.all([
                        // 1. Get modified tracked files
                        this.execGit(['diff', '--name-only', '-z'], root),
                        // 2. Get modified staged files (in case they are staged but not committed)
                        this.execGit(['diff', '--name-only', '--cached', '-z'], root),
                        // 3. Get untracked files
                        this.execGit(['ls-files', '--others', '--exclude-standard', '-z'], root),
                    ]);

                    this.addFilesToSet(modifiedFiles, root, modifiedOutput);
                    this.addFilesToSet(modifiedFiles, root, stagedOutput);
                    this.addFilesToSet(modifiedFiles, root, untrackedOutput);
                } catch (error) {
                    if (this.isExpectedNonRepoError(error)) {
                        return;
                    }
                    const reason = this.toErrorMessage(error);
                    console.warn(`[DeepLens][GitProvider] Failed to query git status for ${root}: ${reason}`);
                }
            }),
        );

        return modifiedFiles;
    }

    private readonly isWindows = process.platform === 'win32';

    private addFilesToSet(set: Set<string>, root: string, output: string): void {
        // ⚡ Bolt: Fast string processing optimization
        // Replaces .split('\0') with a single-pass manual loop using .indexOf('\0').
        // This avoids intermediate array and string allocations, avoids trimming, and prevents path corruption from C-style quoting.
        // for large git status outputs.
        if (!output) return;

        let lastIndex = 0;
        const len = output.length;
        let normalizedRoot = root;
        const rootLastChar = root.charCodeAt(root.length - 1);
        if (rootLastChar !== 47 && rootLastChar !== 92) {
            // 47 is '/', 92 is '\'
            normalizedRoot += path.sep;
        }

        while (lastIndex < len) {
            let nullIndex = output.indexOf('\0', lastIndex);
            if (nullIndex === -1) {
                nullIndex = len;
            }

            if (lastIndex < nullIndex) {
                const segment = output.slice(lastIndex, nullIndex);
                let filePath: string;

                if (this.isWindows) {
                    // Git always outputs forward slashes, replace with backslashes for Windows
                    filePath = (normalizedRoot + segment).replace(/\//g, '\\').toLowerCase();
                } else {
                    filePath = normalizedRoot + segment;
                }

                set.add(filePath);
            }

            lastIndex = nullIndex + 1;
        }
    }

    private isExpectedNonRepoError(error: unknown): boolean {
        const message = this.toErrorMessage(error).toLowerCase();
        return message.includes('not a git repository');
    }

    private toErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        if (typeof error === 'string') {
            return error;
        }
        try {
            return JSON.stringify(error);
        } catch {
            const tag = Object.prototype.toString.call(error);
            return `Non-Error value: ${tag}`;
        }
    }

    private async execGit(args: string[], cwd: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const child = cp.spawn('git', args, { cwd });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (chunk) => {
                stdout += chunk.toString();
            });

            child.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
            });

            child.on('error', (err) => {
                reject(err);
            });

            child.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    const output = stderr.trim();
                    const suffix = output ? `: ${output}` : '';
                    reject(new Error(`Git exited with code ${code}${suffix}`));
                }
            });
        });
    }
}
