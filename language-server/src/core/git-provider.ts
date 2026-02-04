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

        await Promise.all(
            this.workspaceRoots.map(async (root) => {
                try {
                    // 1. Get modified tracked files
                    const modifiedOutput = await this.execGit(['diff', '--name-only'], root);
                    this.addFilesToSet(modifiedFiles, root, modifiedOutput);

                    // 2. Get modified staged files (in case they are staged but not committed)
                    const stagedOutput = await this.execGit(['diff', '--name-only', '--cached'], root);
                    this.addFilesToSet(modifiedFiles, root, stagedOutput);

                    // 3. Get untracked files
                    const untrackedOutput = await this.execGit(['ls-files', '--others', '--exclude-standard'], root);
                    this.addFilesToSet(modifiedFiles, root, untrackedOutput);
                } catch (error) {
                    // Ignore errors (e.g., not a git repo)
                    // console.debug(`Git check failed for ${root}:`, error);
                }
            }),
        );

        return modifiedFiles;
    }

    private addFilesToSet(set: Set<string>, root: string, output: string): void {
        const lines = output.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
                set.add(path.normalize(path.join(root, trimmed)));
            }
        }
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
