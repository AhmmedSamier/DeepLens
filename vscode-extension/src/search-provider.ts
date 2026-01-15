import * as vscode from 'vscode';
import { ActivityTracker } from '../../language-server/src/core/activity-tracker';
import { CommandIndexer } from './command-indexer';
import { Config } from '../../language-server/src/core/config';
import { ISearchProvider } from '../../language-server/src/core/search-interface';
import { SearchItemType, SearchOptions, SearchResult, SearchScope } from '../../language-server/src/core/types';

/**
 * Search provider with enhanced UI (filter buttons, icons, counts)
 */
export class SearchProvider {
    private searchEngine: ISearchProvider;
    private config: Config;
    private activityTracker: ActivityTracker | undefined;
    private commandIndexer: CommandIndexer | undefined;
    private currentScope: SearchScope = SearchScope.EVERYTHING;
    private userSelectedScope: SearchScope = SearchScope.EVERYTHING;
    private filterButtons: Map<SearchScope, vscode.QuickInputButton> = new Map();

    // Visual prefixes for button tooltips
    private readonly ACTIVE_PREFIX = '● ';
    private readonly INACTIVE_PREFIX = '○ ';
    private readonly ICON_CLASS = 'symbol-class';

    // Prefix mapping for search scopes
    private readonly PREFIX_MAP = new Map<string, SearchScope>([
        ['/t ', SearchScope.TYPES],
        ['/text ', SearchScope.TEXT],
        ['/s ', SearchScope.SYMBOLS],
        ['/f ', SearchScope.FILES],
        ['/c ', SearchScope.COMMANDS],
        ['/p ', SearchScope.PROPERTIES],
        ['/e ', SearchScope.ENDPOINTS],
        ['/a ', SearchScope.EVERYTHING],
    ]);

    constructor(
        searchEngine: ISearchProvider,
        config: Config,
        activityTracker?: ActivityTracker,
        commandIndexer?: CommandIndexer,
    ) {
        this.searchEngine = searchEngine;
        this.config = config;
        this.activityTracker = activityTracker;
        this.commandIndexer = commandIndexer;
        this.createFilterButtons();

        // Set up activity tracking in search engine if enabled (only for local engines)
        if (activityTracker && config.isActivityTrackingEnabled() && 'setActivityCallback' in searchEngine) {
            (searchEngine as unknown as { setActivityCallback: (cb: (id: string) => number, weight: number) => void }).setActivityCallback(
                (itemId: string) => activityTracker.getActivityScore(itemId),
                config.getActivityWeight(),
            );
        }
    }

    /**
     * Create filter buttons for each scope
     */
    private createFilterButtons(): void {
        this.filterButtons.set(SearchScope.EVERYTHING, {
            iconPath: new vscode.ThemeIcon('search'),
            tooltip: this.INACTIVE_PREFIX + 'All',
        });

        this.filterButtons.set(SearchScope.TYPES, {
            iconPath: new vscode.ThemeIcon(this.ICON_CLASS),
            tooltip: this.INACTIVE_PREFIX + 'Classes',
        });

        this.filterButtons.set(SearchScope.SYMBOLS, {
            iconPath: new vscode.ThemeIcon('symbol-method'),
            tooltip: this.INACTIVE_PREFIX + 'Symbols',
        });

        this.filterButtons.set(SearchScope.FILES, {
            iconPath: new vscode.ThemeIcon('file'),
            tooltip: this.INACTIVE_PREFIX + 'Files',
        });

        this.filterButtons.set(SearchScope.TEXT, {
            iconPath: new vscode.ThemeIcon('search'),
            tooltip: this.INACTIVE_PREFIX + 'Text',
        });

        this.filterButtons.set(SearchScope.COMMANDS, {
            iconPath: new vscode.ThemeIcon('run'),
            tooltip: this.INACTIVE_PREFIX + 'Commands',
        });
        this.filterButtons.set(SearchScope.PROPERTIES, {
            iconPath: new vscode.ThemeIcon('symbol-property'),
            tooltip: this.INACTIVE_PREFIX + 'Properties',
        });
        this.filterButtons.set(SearchScope.ENDPOINTS, {
            iconPath: new vscode.ThemeIcon('globe'),
            tooltip: this.INACTIVE_PREFIX + 'Endpoints',
        });
    }

    /**
     * Get visually distinct active icon with color
     */
    private getActiveIcon(scope: SearchScope): vscode.ThemeIcon {
        const color = new vscode.ThemeColor('focusBorder');

        switch (scope) {
            case SearchScope.EVERYTHING:
                return new vscode.ThemeIcon('search', color);
            case SearchScope.TYPES:
                return new vscode.ThemeIcon(this.ICON_CLASS, color);
            case SearchScope.SYMBOLS:
                return new vscode.ThemeIcon('symbol-field', color);
            case SearchScope.FILES:
                return new vscode.ThemeIcon('files', color);
            case SearchScope.TEXT:
                return new vscode.ThemeIcon('search', color);
            case SearchScope.COMMANDS:
                return new vscode.ThemeIcon('terminal', color);
            case SearchScope.PROPERTIES:
                return new vscode.ThemeIcon('symbol-property', color);
            case SearchScope.ENDPOINTS:
                return new vscode.ThemeIcon('globe', color);
            default:
                return new vscode.ThemeIcon('search', color);
        }
    }

    /**
     * Update filter buttons to reflect active scope
     */
    private updateFilterButtons(quickPick: vscode.QuickPick<SearchResultItem>): void {
        const buttons: vscode.QuickInputButton[] = [];

        // Add buttons in the desired order
        const orderedScopes = [
            SearchScope.EVERYTHING,
            SearchScope.TYPES,
            SearchScope.SYMBOLS,
            SearchScope.PROPERTIES,
            SearchScope.FILES,
            SearchScope.TEXT,
            SearchScope.ENDPOINTS,
            SearchScope.COMMANDS,
        ];

        for (const scope of orderedScopes) {
            const baseButton = this.filterButtons.get(scope);
            if (!baseButton) {
                continue;
            }

            const isActive = scope === this.currentScope;
            const baseName = (baseButton.tooltip || '')
                .replace(this.ACTIVE_PREFIX, '')
                .replace(this.INACTIVE_PREFIX, '');

            const button: vscode.QuickInputButton = {
                iconPath: isActive ? this.getActiveIcon(scope) : baseButton.iconPath,
                tooltip: isActive ? this.ACTIVE_PREFIX + baseName : this.INACTIVE_PREFIX + baseName,
            };

            buttons.push(button);
        }

        quickPick.buttons = buttons;
    }

    /**
     * Get placeholder text based on current scope
     */
    private getPlaceholder(): string {
        switch (this.currentScope) {
            case SearchScope.TYPES:
                return 'Searching in Classes only. Type to search...';
            case SearchScope.SYMBOLS:
                return 'Searching in Symbols only. Type to search...';
            case SearchScope.FILES:
                return 'Searching in Files only. Type to search...';
            case SearchScope.TEXT:
                return 'Searching in Text content. Type to search...';
            case SearchScope.COMMANDS:
                return 'Searching in Commands only. Type to search...';
            case SearchScope.PROPERTIES:
                return 'Searching in Properties only. Type to search...';
            case SearchScope.ENDPOINTS:
                return 'Searching in Endpoints only. Type to search...';
            case SearchScope.EVERYTHING:
            default:
                return 'Type to search everywhere with DeepLens (files, classes, symbols...)';
        }
    }

    /**
     * Update title to show filter and result count
     */
    private updateTitle(quickPick: vscode.QuickPick<SearchResultItem>, resultCount: number): void {
        let filterName = '';

        switch (this.currentScope) {
            case SearchScope.TYPES:
                filterName = 'Classes';
                break;
            case SearchScope.SYMBOLS:
                filterName = 'Symbols';
                break;
            case SearchScope.FILES:
                filterName = 'Files';
                break;
            case SearchScope.TEXT:
                filterName = 'Text';
                break;
            case SearchScope.COMMANDS:
                filterName = 'Commands';
                break;
            case SearchScope.PROPERTIES:
                filterName = 'Properties';
                break;
            case SearchScope.ENDPOINTS:
                filterName = 'Endpoints';
                break;
            default:
                filterName = 'All';
        }

        if (resultCount > 0) {
            quickPick.title = `DeepLens - ${filterName} (${resultCount})`;
        } else {
            quickPick.title = 'DeepLens';
        }
    }

    /**
     * Show search UI with specific scope
     */
    async show(scope: SearchScope = SearchScope.EVERYTHING): Promise<void> {
        this.currentScope = scope;
        this.userSelectedScope = scope; // Reset user selection when opening
        await this.showInternal();
    }

    /**
     * Internal show logic
     */
    private async showInternal(): Promise<void> {
        const originalEditor = vscode.window.activeTextEditor;
        const quickPick = vscode.window.createQuickPick<SearchResultItem>();

        quickPick.title = 'DeepLens';
        quickPick.placeholder = this.getPlaceholder();
        quickPick.matchOnDescription = false;
        quickPick.matchOnDetail = false;
        quickPick.ignoreFocusOut = false;

        // Set up filter buttons
        this.updateFilterButtons(quickPick);
        this.updateTitle(quickPick, 0);

        // Register all listeners
        this.setupEventListeners(quickPick, originalEditor);

        quickPick.show();

        // Perform initial search if there's a query
        if (quickPick.value) {
            // Manually trigger query change logic to handle parsing
            // We can't easily access the timeouts here, so we just run performSearch
            // But better to rely on onDidChangeValue if we set value?
            // Since we are reading value, we should parse it.
            const { scope, text } = this.parseQuery(quickPick.value);
            if (scope) {
                this.currentScope = scope;
                this.updateFilterButtons(quickPick);
            }
            const results = await this.performSearch(quickPick, text);
            this.updateTitle(quickPick, results.length);
        } else {
            // Show recent history if no initial query
            await this.showRecentHistory(quickPick);
        }
    }

    /**
     * Show recent history items
     */
    private async showRecentHistory(quickPick: vscode.QuickPick<SearchResultItem>): Promise<void> {
        quickPick.busy = true;
        try {
            const results = await this.searchEngine.getRecentItems(20);

            if (!results || results.length === 0) {
                quickPick.items = [];
                this.updateTitle(quickPick, 0);
                return;
            }

            // Map results to QuickPick items
            quickPick.items = results.map((r) => this.resultToQuickPickItem(r));

            // Update title
            quickPick.title = `DeepLens - Recent History`;
        } finally {
            quickPick.busy = false;
        }
    }

    /**
     * Setup all quickPick event listeners
     */
    private setupEventListeners(
        quickPick: vscode.QuickPick<SearchResultItem>,
        originalEditor: vscode.TextEditor | undefined,
    ): void {
        let burstTimeout: NodeJS.Timeout | undefined;
        let fuzzyTimeout: NodeJS.Timeout | undefined;
        let previewTimeout: NodeJS.Timeout | undefined;
        let accepted = false;

        // Cleanup timeouts on hide
        const cleanupTimeouts = () => {
            if (burstTimeout) clearTimeout(burstTimeout);
            if (fuzzyTimeout) clearTimeout(fuzzyTimeout);
            if (previewTimeout) clearTimeout(previewTimeout);
        };

        quickPick.onDidChangeValue((query) => {
            cleanupTimeouts();
            this.handleQueryChange(
                quickPick,
                query,
                (bt) => (burstTimeout = bt),
                (ft) => (fuzzyTimeout = ft),
            );
        });

        quickPick.onDidChangeActive((items) => {
            if (previewTimeout) clearTimeout(previewTimeout);

            const item = items[0];
            if (item) {
                previewTimeout = setTimeout(() => {
                    // Preview item (preserve focus in QuickPick)
                    this.navigateToItem(item.result, vscode.ViewColumn.Active, true);
                }, 150);
            }
        });

        quickPick.onDidTriggerButton((button) => this.handleButtonPress(quickPick, button));

        quickPick.onDidTriggerItemButton((e) => {
            const result = (e.item as SearchResultItem).result;
            if (e.button.tooltip === 'Copy Path') {
                vscode.env.clipboard.writeText(result.item.filePath);
            } else if (e.button.tooltip === 'Open to the Side') {
                accepted = true;
                this.navigateToItem(result, vscode.ViewColumn.Beside);
                quickPick.hide();
            }
        });

        quickPick.onDidAccept(() => {
            const selected = quickPick.selectedItems[0];
            if (selected) {
                accepted = true;
                this.navigateToItem(selected.result);
                quickPick.hide();
            }
        });

        quickPick.onDidHide(() => {
            cleanupTimeouts();

            // Restore original editor if cancelled
            if (!accepted && originalEditor) {
                vscode.window.showTextDocument(originalEditor.document, {
                    viewColumn: originalEditor.viewColumn,
                    selection: originalEditor.selection
                });
            }

            quickPick.dispose();
        });
    }

    /**
     * Parse query to extract scope and search term
     */
    private parseQuery(query: string): { scope: SearchScope | undefined; text: string } {
        // Check for prefixes
        for (const [prefix, scope] of this.PREFIX_MAP.entries()) {
            if (query.toLowerCase().startsWith(prefix)) {
                return {
                    scope,
                    text: query.slice(prefix.length),
                };
            }
        }

        return {
            scope: undefined,
            text: query,
        };
    }

    /**
     * Handle search query changes with tiered execution
     */
    private async handleQueryChange(
        quickPick: vscode.QuickPick<SearchResultItem>,
        query: string,
        setBurstTimeout: (t: NodeJS.Timeout) => void,
        setFuzzyTimeout: (t: NodeJS.Timeout) => void,
    ): Promise<void> {
        // Parse scope from query
        const { scope, text } = this.parseQuery(query);

        // Update current scope: use parsed scope if available, otherwise user selection
        const previousScope = this.currentScope;
        this.currentScope = scope || this.userSelectedScope;

        // Update UI if scope changed
        if (previousScope !== this.currentScope) {
            this.updateFilterButtons(quickPick);
            quickPick.placeholder = this.getPlaceholder();
        }

        const trimmedQuery = text.trim();
        if (!trimmedQuery) {
            await this.showRecentHistory(quickPick);
            quickPick.busy = false;
            return;
        }

        // Start busy indicator for deep scan
        quickPick.busy = true;

        // PHASE 0: Absolute Instant (Immediate exact-name hits)
        const instantResults = await this.searchEngine.burstSearch({
            query: trimmedQuery,
            scope: this.currentScope,
            maxResults: 5,
        });

        if (instantResults.length > 0) {
            quickPick.items = instantResults.map((r) => this.resultToQuickPickItem(r));
            this.updateTitle(quickPick, instantResults.length);
        } else if (quickPick.items.length > 0) {
            // Clear items immediately if Phase 0 found nothing (prevent stale results)
            quickPick.items = [];
            this.updateTitle(quickPick, 0);
        }

        // PHASE 1: Quick Burst (Wait 10ms for prefix/multichar)
        setBurstTimeout(
            setTimeout(async () => {
                const burstResults = await this.searchEngine.burstSearch({
                    query: trimmedQuery,
                    scope: this.currentScope,
                    maxResults: 15,
                });

                // Update if we have more results or if current list is empty
                if (
                    burstResults.length > instantResults.length ||
                    (burstResults.length > 0 && quickPick.items.length === 0)
                ) {
                    quickPick.items = burstResults.map((r) => this.resultToQuickPickItem(r));
                    this.updateTitle(quickPick, burstResults.length);
                }
            }, 10),
        );

        // PHASE 2: Deep Fuzzy Search (Stabilized results)
        setFuzzyTimeout(
            setTimeout(async () => {
                try {
                    const results = await this.performSearch(quickPick, text); // Use text (parsed) instead of raw query
                    this.updateTitle(quickPick, results.length);
                } finally {
                    quickPick.busy = false;
                }
            }, 100),
        );
    }

    /**
     * Handle button clicks for filter toggling
     */
    private async handleButtonPress(quickPick: vscode.QuickPick<SearchResultItem>, button: vscode.QuickInputButton): Promise<void> {
        const tooltip = button.tooltip || '';
        const baseName = tooltip.replace(this.ACTIVE_PREFIX, '').replace(this.INACTIVE_PREFIX, '');

        // Find which scope was clicked
        for (const [scope, filterButton] of this.filterButtons.entries()) {
            const buttonBaseName = (filterButton.tooltip || '')
                .replace(this.ACTIVE_PREFIX, '')
                .replace(this.INACTIVE_PREFIX, '');

            if (buttonBaseName === baseName) {
                // Update user selection
                this.userSelectedScope = scope;

                // Also update current scope (though it might be overridden by query prefix in next step)
                this.currentScope = scope;

                // Check if we need to update the query prefix
                let currentQuery = quickPick.value;
                let newPrefix = '';

                // Find associated prefix for the new scope
                for (const [prefix, s] of this.PREFIX_MAP.entries()) {
                    if (s === scope) {
                        newPrefix = prefix;
                        break;
                    }
                }

                // Check if current query has ANY known prefix
                let hasPrefix = false;
                for (const [prefix] of this.PREFIX_MAP.entries()) {
                    if (currentQuery.toLowerCase().startsWith(prefix)) {
                        // Replace existing prefix with new one (or empty if none)
                        // If new scope is EVERYTHING, we typically don't force a prefix unless we want '/a '
                        // But PREFIX_MAP has '/a ' for EVERYTHING.
                        // However, usually "All" means no prefix.
                        // Let's decide: if scope is EVERYTHING, remove prefix.
                        // Wait, my PREFIX_MAP has '/a ' -> EVERYTHING.
                        // If user clicks "All", do we want to insert '/a '?
                        // Probably cleaner to remove prefix.

                        const replacement = scope === SearchScope.EVERYTHING ? '' : newPrefix;
                        quickPick.value = replacement + currentQuery.slice(prefix.length);
                        hasPrefix = true;
                        break;
                    }
                }

                // If no prefix was present, we generally don't add one just by clicking the button
                // (Normal behavior: button sets filter state invisible to text)
                // EXCEPT if the user explicitly wants that behavior.
                // Current plan: only replace if prefix exists.

                quickPick.placeholder = this.getPlaceholder();
                this.updateFilterButtons(quickPick);

                // Re-run search with new filter
                // We use parseQuery to ensure we handle the (potentially updated) text correctly
                const { text } = this.parseQuery(quickPick.value);
                const results = await this.performSearch(quickPick, text);
                this.updateTitle(quickPick, results.length);
                break;
            }
        }
    }

    /**
     * Perform native text search using VS Code API (ripgrep)
     */
    private async performNativeTextSearch(query: string, maxResults: number): Promise<SearchResult[]> {
        const results: SearchResult[] = [];
        const uniqueIds = new Set<string>();
        const tokenSource = new vscode.CancellationTokenSource();

        try {
            const options: vscode.FindTextInFilesOptions = {
                previewOptions: {
                    matchLines: 1,
                    charsPerLine: 1000,
                },
            };

            await vscode.workspace.findTextInFiles(
                { pattern: query, isCaseSensitive: false },
                options,
                (result) => {
                    if (results.length >= maxResults) {
                        tokenSource.cancel();
                        return;
                    }

                    if ('ranges' in result) {
                        const match = result as vscode.TextSearchMatch;
                        const filePath = match.uri.fsPath;
                        const range = match.ranges[0]; // Take first match range
                        const line = range.start.line;
                        const column = range.start.character;
                        const previewText = match.preview.text.trim();

                        const id = `text:${filePath}:${line}:${column}`;
                        if (uniqueIds.has(id)) {
                            return;
                        }
                        uniqueIds.add(id);

                        results.push({
                            item: {
                                id,
                                name: previewText,
                                type: SearchItemType.TEXT,
                                filePath,
                                line,
                                column,
                                detail: vscode.workspace.asRelativePath(match.uri),
                            },
                            score: 1.0,
                            scope: SearchScope.TEXT,
                            highlights: [], // Native highlights are complex to map back to trimmed text
                        });
                    }
                },
                tokenSource.token,
            );
        } catch (error) {
            // Cancellation throws an error usually, which is fine
        } finally {
            tokenSource.dispose();
        }

        return results;
    }

    /**
     * Perform search and update quick pick items
     */
    private async performSearch(quickPick: vscode.QuickPick<SearchResultItem>, query: string): Promise<SearchResult[]> {
        if (!query || query.trim().length === 0) {
            quickPick.items = [];
            return [];
        }

        // Use native text search if scope is TEXT and enabled
        if (this.currentScope === SearchScope.TEXT && this.config.isTextSearchEnabled()) {
            const results = await this.performNativeTextSearch(query.trim(), this.config.getMaxResults());
            quickPick.items = results.map((result) => this.resultToQuickPickItem(result));
            return results;
        }

        const options: SearchOptions = {
            query: query.trim(),
            scope: this.currentScope,
            maxResults: this.config.getMaxResults(),
            enableCamelHumps: this.config.isCamelHumpsEnabled(),
        };

        const results = await this.searchEngine.search(options);

        // Merge command results if command search is enabled/relevant
        if (this.commandIndexer) {
            const commandResults = this.commandIndexer.search(query);
            results.push(...commandResults);
        }

        quickPick.items = results.map((result) => this.resultToQuickPickItem(result));

        return results;
    }

    /**
     * Convert search result to QuickPick item
     */
    private resultToQuickPickItem(result: SearchResult): SearchResultItem {
        const { item } = result;
        const icon = this.getIconForItemType(item.type);
        const iconColor = this.getIconColorForItemType(item.type);

        // Create colored icon
        const coloredIcon = new vscode.ThemeIcon(icon, iconColor);

        // Don't add icon to label - iconPath will render it
        const label = item.name;
        let description = '';
        let detail = '';

        // Add container name if available
        if (item.containerName) {
            description = item.containerName;
        }

        // Add file path and line number
        const relativePath = vscode.workspace.asRelativePath(item.filePath);
        if (item.line !== undefined) {
            detail = `${relativePath}:${item.line + 1}`;
        } else {
            detail = relativePath;
        }

        // Add additional detail if available
        if (item.detail) {
            description = description ? `${description} - ${item.detail}` : item.detail;
        }

        return {
            label,
            description,
            detail,
            iconPath: coloredIcon,
            alwaysShow: true, // Crucial: prevent VS Code from re-filtering our fuzzy results
            result,
            buttons: [
                {
                    iconPath: new vscode.ThemeIcon('copy'),
                    tooltip: 'Copy Path',
                },
                {
                    iconPath: new vscode.ThemeIcon('split-horizontal'),
                    tooltip: 'Open to the Side',
                },
            ],
        };
    }

    /**
     * Get icon for item type
     */
    private getIconForItemType(type: SearchItemType): string {
        switch (type) {
            case SearchItemType.CLASS:
                return this.ICON_CLASS;
            case SearchItemType.INTERFACE:
                return 'symbol-interface';
            case SearchItemType.ENUM:
                return 'symbol-enum';
            case SearchItemType.FUNCTION:
                return 'symbol-function';
            case SearchItemType.METHOD:
                return 'symbol-method';
            case SearchItemType.PROPERTY:
                return 'symbol-property';
            case SearchItemType.VARIABLE:
                return 'symbol-variable';
            case SearchItemType.FILE:
                return 'file';
            case SearchItemType.TEXT:
                return 'search';
            case SearchItemType.COMMAND:
                return 'run';
            case SearchItemType.ENDPOINT:
                return 'globe';
            default:
                return 'symbol-misc';
        }
    }

    /**
     * Get color for icon based on item type
     */
    private getIconColorForItemType(type: SearchItemType): vscode.ThemeColor | undefined {
        switch (type) {
            case SearchItemType.CLASS:
            case SearchItemType.INTERFACE:
                return new vscode.ThemeColor('symbolIcon.classForeground');
            case SearchItemType.ENUM:
                return new vscode.ThemeColor('symbolIcon.enumForeground');
            case SearchItemType.FUNCTION:
            case SearchItemType.METHOD:
                return new vscode.ThemeColor('symbolIcon.methodForeground');
            case SearchItemType.PROPERTY:
                return new vscode.ThemeColor('symbolIcon.propertyForeground');
            case SearchItemType.VARIABLE:
                return new vscode.ThemeColor('symbolIcon.variableForeground');
            case SearchItemType.FILE:
                return new vscode.ThemeColor('symbolIcon.fileForeground');
            case SearchItemType.ENDPOINT:
                return new vscode.ThemeColor('symbolIcon.interfaceForeground'); // Purple-ish
            default:
                return undefined;
        }
    }

    /**
     * Navigate to the selected item or execute command
     */
    private async navigateToItem(
        result: SearchResult,
        viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active,
        preview: boolean = false,
    ): Promise<void> {
        const { item } = result;

        // Don't record activity for previews
        if (!preview && this.config.isActivityTrackingEnabled()) {
            this.searchEngine.recordActivity(item.id);
            if (this.activityTracker) {
                this.activityTracker.recordAccess(item.id);
            }
        }

        // Handle command execution
        if (item.type === SearchItemType.COMMAND && item.commandId) {
            if (!preview && this.commandIndexer) {
                await this.commandIndexer.executeCommand(item.commandId);
            }
            return;
        }

        // Handle file/symbol navigation
        try {
            const uri = vscode.Uri.file(item.filePath);
            const document = await vscode.workspace.openTextDocument(uri);

            const position =
                item.line !== undefined ? new vscode.Position(item.line, item.column || 0) : new vscode.Position(0, 0);

            await vscode.window.showTextDocument(document, {
                selection: new vscode.Range(position, position),
                viewColumn: viewColumn,
                preview: preview, // Use preview mode if requested
                preserveFocus: preview, // Keep focus on quick pick during preview
            });
        } catch (error) {
            if (!preview) {
                vscode.window.showErrorMessage(`Failed to open file: ${item.filePath}`);
            }
            console.error(`Navigation error for ${item.filePath}:`, error);
        }
    }
}

/**
 * QuickPick item with search result
 */
interface SearchResultItem extends vscode.QuickPickItem {
    result: SearchResult;
}
