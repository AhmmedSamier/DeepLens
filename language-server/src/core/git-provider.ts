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
                        this.execGit(['diff', '--name-only'], root),
                        // 2. Get modified staged files (in case they are staged but not committed)
                        this.execGit(['diff', '--name-only', '--cached'], root),
                        // 3. Get untracked files
                        this.execGit(['ls-files', '--others', '--exclude-standard'], root),
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
        const lines = output.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
                let filePath = path.normalize(path.join(root, trimmed));
                if (this.isWindows) {
                    filePath = filePath.toLowerCase();
                }
                set.add(filePath);
            }
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
        return error?.toString() ?? 'Unknown error';
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
