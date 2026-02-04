/**
 * Configuration manager for extension settings
 */
export class Config {
    private data: Record<string, unknown> = {};
    private vscodeConfig: { get<T>(key: string, defaultValue?: T): T } | undefined;

    constructor(vscodeConfig?: { get<T>(key: string, defaultValue?: T): T }) {
        this.vscodeConfig = vscodeConfig;
        if (!vscodeConfig) {
            this.loadDefaults();
        }
    }

    private loadDefaults(): void {
        this.data = {
            excludePatterns: [
                '**/node_modules/**',
                '**/dist/**',
                '**/out/**',
                '**/.git/**',
                '**/build/**',
                '**/bin/**',
                '**/obj/**',
                '**/vendor/**',
            ],
            maxResults: 50,
            enableTextSearch: true,
            enableCamelHumps: true,
            searchConcurrency: 60,
            respectGitignore: true,
            'activity.enabled': true,
            'activity.weight': 0.3,
            fileExtensions: [
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
                'txt',
                'md',
                'json',
                'xml',
                'yaml',
                'yml',
            ],
        };
    }

    /**
     * Update settings from a plain object (used in LSP)
     */
    update(settings: Record<string, unknown>): void {
        const flattened: Record<string, unknown> = {};

        const flatten = (obj: unknown, prefix = '') => {
            if (typeof obj !== 'object' || obj === null) {
                if (prefix) flattened[prefix] = obj;
                return;
            }

            for (const key in obj as Record<string, unknown>) {
                const value = (obj as Record<string, unknown>)[key];
                const fullKey = prefix ? `${prefix}.${key}` : key;
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    flatten(value, fullKey);
                } else {
                    flattened[fullKey] = value;
                }
            }
        };

        flatten(settings);
        this.data = { ...this.data, ...flattened };
    }

    /**
     * Reload configuration (used in VS Code)
     */
    reload(newVscodeConfig?: { get<T>(key: string, defaultValue?: T): T }): void {
        if (newVscodeConfig) {
            this.vscodeConfig = newVscodeConfig;
        }
    }

    private get<T>(key: string, defaultValue: T): T {
        if (this.vscodeConfig && typeof this.vscodeConfig.get === 'function') {
            return this.vscodeConfig.get(key, defaultValue);
        }
        return this.data[key] !== undefined ? (this.data[key] as T) : defaultValue;
    }

    /**
     * Get exclude patterns
     */
    getExcludePatterns(): string[] {
        return this.get('excludePatterns', [
            '**/node_modules/**',
            '**/dist/**',
            '**/out/**',
            '**/.git/**',
            '**/build/**',
            '**/bin/**',
            '**/obj/**',
            '**/vendor/**',
        ]);
    }

    /**
     * Get max results
     */
    getMaxResults(): number {
        return this.get('maxResults', 50);
    }

    /**
     * Check if text search is enabled
     */
    isTextSearchEnabled(): boolean {
        return this.get('enableTextSearch', true);
    }

    /**
     * Check if CamelHumps matching is enabled
     */
    isCamelHumpsEnabled(): boolean {
        return this.get('enableCamelHumps', true);
    }

    /**
     * Check if .gitignore should be respected
     */
    shouldRespectGitignore(): boolean {
        return this.get('respectGitignore', true);
    }

    /**
     * Get search concurrency
     */
    getSearchConcurrency(): number {
        return this.get('searchConcurrency', 60);
    }

    /**
     * Check if activity tracking is enabled
     */
    isActivityTrackingEnabled(): boolean {
        return this.get('activity.enabled', true);
    }

    /**
     * Get activity weight (0-1)
     */
    getActivityWeight(): number {
        return this.get('activity.weight', 0.3);
    }

    /**
     * Get file extensions to index
     */
    getFileExtensions(): string[] {
        return this.get('fileExtensions', [
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
            'txt',
            'md',
            'json',
            'xml',
            'yaml',
            'yml',
        ]);
    }
}
