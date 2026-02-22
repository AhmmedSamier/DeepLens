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
            maxResults: 20,

            enableTextSearch: true,
            searchConcurrency: 60,
            respectGitignore: true,
            'activity.enabled': true,
            'activity.weight': 0.3,
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
        if (this.vscodeConfig?.get) {
            return this.vscodeConfig.get(key, defaultValue);
        }
        const value = this.data[key];
        return value === undefined ? defaultValue : (value as T);
    }

    /**
     * Validate and clamp a number to a specified range
     */
    private validateNumber(value: number, min: number, max: number, defaultValue: number): number {
        if (typeof value !== 'number' || Number.isNaN(value)) {
            return defaultValue;
        }
        return Math.max(min, Math.min(max, value));
    }

    /**
     * Validate an array of strings
     */
    private validateStringArray(value: unknown, defaultValue: string[]): string[] {
        if (!Array.isArray(value)) {
            return defaultValue;
        }
        return value.filter((item) => typeof item === 'string' && item.length > 0);
    }

    /**
     * Validate a boolean value
     */
    private validateBoolean(value: unknown, defaultValue: boolean): boolean {
        if (typeof value === 'boolean') {
            return value;
        }
        return defaultValue;
    }

    /**
     * Get exclude patterns
     */
    getExcludePatterns(): string[] {
        const value = this.get('excludePatterns', [
            '**/node_modules/**',
            '**/dist/**',
            '**/out/**',
            '**/.git/**',
            '**/build/**',
            '**/bin/**',
            '**/obj/**',
            '**/vendor/**',
        ]);
        return this.validateStringArray(value, [
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
        const value = this.get('maxResults', 20);
        return this.validateNumber(value, 1, 1000, 20);
    }

    /**
     * Check if text search is enabled
     */
    isTextSearchEnabled(): boolean {
        return this.get('enableTextSearch', true);
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
        const value = this.get('searchConcurrency', 60);
        return this.validateNumber(value, 1, 200, 60);
    }

    getIndexWorkerCount(): number {
        const value = this.get('indexWorkerCount', 0);
        const clamped = this.validateNumber(value, 0, 32, 0);
        if (clamped === 0) {
            return 0;
        }
        return clamped;
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
        const value = this.get('activity.weight', 0.3);
        return this.validateNumber(value, 0, 1, 0.3);
    }
}
