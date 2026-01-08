import * as vscode from 'vscode';

/**
 * Configuration manager for extension settings
 */
export class Config {
    private config: vscode.WorkspaceConfiguration;

    constructor() {
        this.config = vscode.workspace.getConfiguration('findEverywhere');
    }

    /**
     * Reload configuration
     */
    reload(): void {
        this.config = vscode.workspace.getConfiguration('findEverywhere');
    }

    /**
     * Get exclude patterns
     */
    getExcludePatterns(): string[] {
        return this.config.get<string[]>('excludePatterns', [
            '**/node_modules/**',
            '**/dist/**',
            '**/out/**',
            '**/.git/**',
            '**/build/**',
        ]);
    }

    /**
     * Get max results
     */
    getMaxResults(): number {
        return this.config.get<number>('maxResults', 50);
    }

    /**
     * Check if text search is enabled
     */
    isTextSearchEnabled(): boolean {
        return this.config.get<boolean>('enableTextSearch', true);
    }

    /**
   * Check if CamelHumps matching is enabled
   */
    isCamelHumpsEnabled(): boolean {
        return this.config.get<boolean>('enableCamelHumps', true);
    }

    /**
   * Check if .gitignore should be respected
   */
    shouldRespectGitignore(): boolean {
        return this.config.get<boolean>('respectGitignore', true);
    }

    /**
     * Check if activity tracking is enabled
     */
    isActivityTrackingEnabled(): boolean {
        return this.config.get<boolean>('activity.enabled', true);
    }

    /**
     * Get activity weight (0-1)
     */
    getActivityWeight(): number {
        return this.config.get<number>('activity.weight', 0.3);
    }

    /**
     * Get file extensions to index
     */
    getFileExtensions(): string[] {
        return this.config.get<string[]>('fileExtensions', [
            'ts',
            'tsx',
            'js',
            'jsx',
            'py',
            'java',
            'cs',
            'cpp',
            'c',
            'h',
            'go',
            'rb',
            'php',
        ]);
    }
}
