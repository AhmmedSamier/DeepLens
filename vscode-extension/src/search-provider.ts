import * as vscode from 'vscode';
import { ActivityTracker } from '../../language-server/src/core/activity-tracker';
import { Config } from '../../language-server/src/core/config';
import { ISearchProvider, SearchItemType, SearchOptions, SearchResult, SearchScope, SearchableItem } from '../../language-server/src/core/types';
import { CommandIndexer } from './command-indexer';
import { DeepLensLspClient } from './lsp-client';

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
    private lastQueryId = 0;
    private currentQuickPick: vscode.QuickPick<SearchResultItem> | undefined;
    private streamingResults: Map<number, SearchResult[]> = new Map();
    private searchCts: vscode.CancellationTokenSource | undefined;

    // Visual prefixes for button tooltips
    private readonly ACTIVE_PREFIX = '● ';
    private readonly INACTIVE_PREFIX = '○ ';
    private readonly ICON_CLASS = 'symbol-class';

    private matchDecorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        border: '1px solid',
        borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder'),
        borderRadius: '2px',
    });

    // Prefix mapping for search scopes
    private readonly PREFIX_MAP = new Map<string, SearchScope>([
        ['/t ', SearchScope.TYPES],
        ['/classes ', SearchScope.TYPES],
        ['/txt ', SearchScope.TEXT],
        ['/text ', SearchScope.TEXT],
        ['/s ', SearchScope.SYMBOLS],
        ['/symbols ', SearchScope.SYMBOLS],
        ['/f ', SearchScope.FILES],
        ['/files ', SearchScope.FILES],
        ['/c ', SearchScope.COMMANDS],
        ['/commands ', SearchScope.COMMANDS],
        ['/p ', SearchScope.PROPERTIES],
        ['/properties ', SearchScope.PROPERTIES],
        ['/e ', SearchScope.ENDPOINTS],
        ['/endpoints ', SearchScope.ENDPOINTS],
        ['/a ', SearchScope.EVERYTHING],
        ['/all ', SearchScope.EVERYTHING],
        ['/everything ', SearchScope.EVERYTHING],
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
            (
                searchEngine as unknown as { setActivityCallback: (cb: (id: string) => number, weight: number) => void }
            ).setActivityCallback(
                (itemId: string) => activityTracker.getActivityScore(itemId),
                config.getActivityWeight(),
            );
        }

        // Initialize streaming results listener
        if (this.searchEngine instanceof DeepLensLspClient) {
            this.searchEngine.onStreamResult.event((params) => {
                const { requestId, result } = params;
                if (requestId !== undefined && requestId === this.lastQueryId && this.currentQuickPick) {
                    let results = this.streamingResults.get(requestId) || [];

                    // Avoid duplicates (though the server should handle this)
                    if (!results.some((r) => r.item.id === result.item.id)) {
                        results.push(result);
                        this.streamingResults.set(requestId, results);

                        // Update UI incrementally if this is still the active search
                        if (requestId === this.lastQueryId) {
                            this.currentQuickPick.items = results.map((r) => this.resultToQuickPickItem(r));
                            this.updateTitle(this.currentQuickPick, results.length);
                        }
                    }
                }
            });
        }
    }

    /**
     * Create filter buttons for each scope
     */
    private createFilterButtons(): void {
        const dimmedColor = new vscode.ThemeColor('descriptionForeground');

        const buttonConfigs = [
            { scope: SearchScope.EVERYTHING, icon: 'search', label: 'All', shortcut: '/all' },
            { scope: SearchScope.TYPES, icon: this.ICON_CLASS, label: 'Classes', shortcut: '/t' },
            { scope: SearchScope.SYMBOLS, icon: 'symbol-method', label: 'Symbols', shortcut: '/s' },
            { scope: SearchScope.FILES, icon: 'file', label: 'Files', shortcut: '/f' },
            { scope: SearchScope.TEXT, icon: 'whole-word', label: 'Text', shortcut: '/txt' },
            { scope: SearchScope.COMMANDS, icon: 'run', label: 'Commands', shortcut: '/c' },
            { scope: SearchScope.PROPERTIES, icon: 'symbol-property', label: 'Properties', shortcut: '/p' },
            { scope: SearchScope.ENDPOINTS, icon: 'globe', label: 'Endpoints', shortcut: '/e' },
        ];

        for (const config of buttonConfigs) {
            this.filterButtons.set(config.scope, {
                iconPath: new vscode.ThemeIcon(config.icon, dimmedColor),
                tooltip: `${this.INACTIVE_PREFIX}${config.label} (${config.shortcut})`,
            });
        }
    }

    /**
     * Get visually distinct active icon with color
     */
    private getActiveIcon(scope: SearchScope): vscode.ThemeIcon {
        const color = new vscode.ThemeColor('testing.iconPassed');

        switch (scope) {
            case SearchScope.EVERYTHING:
                return new vscode.ThemeIcon('search', color);
            case SearchScope.TYPES:
                return new vscode.ThemeIcon(this.ICON_CLASS, color);
            case SearchScope.SYMBOLS:
                return new vscode.ThemeIcon('symbol-method', color);
            case SearchScope.FILES:
                return new vscode.ThemeIcon('file', color);
            case SearchScope.TEXT:
                return new vscode.ThemeIcon('whole-word', color);
            case SearchScope.COMMANDS:
                return new vscode.ThemeIcon('run', color);
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
            SearchScope.TEXT,
            SearchScope.FILES,
            SearchScope.TYPES,
            SearchScope.SYMBOLS,
            SearchScope.PROPERTIES,
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
                return 'Classes: Type to search in classes only...';
            case SearchScope.SYMBOLS:
                return 'Symbols: Type to search in symbols only...';
            case SearchScope.FILES:
                return 'Files: Type to search in file names only...';
            case SearchScope.TEXT:
                return 'Text: Type to search for text content...';
            case SearchScope.COMMANDS:
                return 'Commands: Type to search in commands only...';
            case SearchScope.PROPERTIES:
                return 'Properties: Type to search in properties only...';
            case SearchScope.ENDPOINTS:
                return 'Endpoints: Type to search in endpoints only...';
            case SearchScope.EVERYTHING:
            default:
                return 'Global: Type to search everywhere (classes, files, symbols...)';
        }
    }

    /**
     * Update title to show filter and result count
     */
    private updateTitle(quickPick: vscode.QuickPick<SearchResultItem>, resultCount: number, durationMs?: number): void {
        let filterName: string;

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
                filterName = 'Everything';
        }

        const countSuffix = resultCount > 0 ? ` (${resultCount})` : '';
        
        let durationSuffix = '';
        if (durationMs !== undefined) {
             const durationText = durationMs >= 1000 ? `${(durationMs / 1000).toFixed(2)}s` : `${durationMs}ms`;
             durationSuffix = ` — Search took ${durationText}`;
        }

        quickPick.title = `DeepLens - ${filterName}${countSuffix}${durationSuffix}`;
    }

    /**
     * Cancel any ongoing search
     */
    private cancelSearch(): void {
        if (this.searchCts) {
            this.searchCts.cancel();
            this.searchCts.dispose();
            this.searchCts = undefined;
        }
    }

    /**
     * Show search UI with specific scope
     */
    /**
     * Show search UI with specific scope and optional initial query
     */
    async show(scope: SearchScope = SearchScope.EVERYTHING, initialQuery?: string): Promise<void> {
        this.currentScope = scope;
        this.userSelectedScope = scope; // Reset user selection when opening
        await this.showInternal(initialQuery);
    }

    /**
     * Internal show logic
     */
    private async showInternal(initialQuery?: string): Promise<void> {
        const originalEditor = vscode.window.activeTextEditor;
        const quickPick = vscode.window.createQuickPick<SearchResultItem>();
        this.currentQuickPick = quickPick;

        quickPick.title = 'DeepLens';
        quickPick.placeholder = this.getPlaceholder();
        quickPick.matchOnDescription = false;
        quickPick.matchOnDetail = false;
        quickPick.ignoreFocusOut = false;

        if (initialQuery) {
            quickPick.value = initialQuery;
        }

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
            const queryId = ++this.lastQueryId;
            await this.performSearch(quickPick, text, queryId);
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

            // Update title with scope reference even in history
            this.updateTitle(quickPick, 0);
            quickPick.title += ' - Recent History';
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
        let lastActiveItemId: string | undefined;
        let userHasNavigated = false;

        // Cleanup timeouts on hide
        const cleanupTimeouts = () => {
            if (burstTimeout) clearTimeout(burstTimeout);
            if (fuzzyTimeout) clearTimeout(fuzzyTimeout);
            if (previewTimeout) clearTimeout(previewTimeout);
        };

        quickPick.onDidChangeValue((query) => {
            cleanupTimeouts();
            // Reset navigation tracking when query changes
            userHasNavigated = false;
            lastActiveItemId = undefined;
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
                const currentItemId = item.result.item.id;

                // Only preview if user has actually navigated (not just auto-focus on first result)
                // We detect navigation by checking if the active item changed from a previous value
                if (lastActiveItemId !== undefined && lastActiveItemId !== currentItemId) {
                    userHasNavigated = true;
                }

                lastActiveItemId = currentItemId;

                if (userHasNavigated) {
                    previewTimeout = setTimeout(() => {
                        // Preview item (preserve focus in QuickPick)
                        this.navigateToItem(item.result, vscode.ViewColumn.Active, true);
                    }, 150);
                }
            }
        });

        quickPick.onDidTriggerButton((button) => this.handleButtonPress(quickPick, button));

        quickPick.onDidTriggerItemButton((e) => {
            const result = (e.item as SearchResultItem).result;
            if (e.button.tooltip === 'Copy Path') {
                vscode.env.clipboard.writeText(result.item.filePath);
            } else if (e.button.tooltip === 'Copy Relative Path') {
                const relativePath = vscode.workspace.asRelativePath(result.item.filePath);
                vscode.env.clipboard.writeText(relativePath);
            } else if (e.button.tooltip === 'Open to the Side') {
                accepted = true;
                this.navigateToItem(result, vscode.ViewColumn.Beside);
                quickPick.hide();
            } else if (e.button.tooltip === 'Reveal in File Explorer') {
                const uri = vscode.Uri.file(result.item.filePath);
                vscode.commands.executeCommand('revealInExplorer', uri);
            } else if (e.button.tooltip === 'Rebuild Index') {
                vscode.commands.executeCommand('deeplens.rebuildIndex');
                quickPick.hide();
            }
        });

        quickPick.onDidAccept(() => {
            const selected = quickPick.selectedItems[0];
            if (selected) {
                const isSlashCommand = selected.result.item.id.startsWith('slash-cmd:');
                if (!isSlashCommand) {
                    accepted = true;
                }

                this.navigateToItem(selected.result);

                // Cancel search immediately after selection
                this.cancelSearch();

                if (!isSlashCommand) {
                    quickPick.hide();
                }
            }
        });

        quickPick.onDidHide(() => {
            cleanupTimeouts();
            this.cancelSearch();

            // Restore original editor if cancelled
            if (!accepted && originalEditor) {
                vscode.window.showTextDocument(originalEditor.document, {
                    viewColumn: originalEditor.viewColumn,
                    selection: originalEditor.selection,
                });
            }

            // Clear decorations
            vscode.window.visibleTextEditors.forEach((editor) => {
                editor.setDecorations(this.matchDecorationType, []);
            });

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
    /**
     * Suggest slash commands based on query
     */
    private suggestSlashCommands(quickPick: vscode.QuickPick<SearchResultItem>, query: string): void {
        const commandSuggestions: SearchResult[] = [];
        const processedScopes = new Set<SearchScope>();

        const slashCommands = [
            { scope: SearchScope.TYPES, label: '/classes', desc: 'Search Classes' },
            { scope: SearchScope.SYMBOLS, label: '/symbols', desc: 'Search Symbols' },
            { scope: SearchScope.FILES, label: '/files', desc: 'Search Files' },
            { scope: SearchScope.TEXT, label: '/text', desc: 'Search Text' },
            { scope: SearchScope.COMMANDS, label: '/commands', desc: 'Search Commands' },
            { scope: SearchScope.PROPERTIES, label: '/properties', desc: 'Search Properties' },
            { scope: SearchScope.ENDPOINTS, label: '/endpoints', desc: 'Search Endpoints' },
            { scope: SearchScope.EVERYTHING, label: '/all', desc: 'Search Everything' },
        ];

        for (const { scope, label, desc } of slashCommands) {
            if (processedScopes.has(scope)) {
                continue;
            }

            // Find prefix from map
            let prefix = '';
            for (const [p, s] of this.PREFIX_MAP.entries()) {
                if (s === scope) {
                    prefix = p;
                    break;
                }
            }

            if (!prefix) {
                continue;
            }

            if (label.startsWith(query.toLowerCase()) || prefix.trim().startsWith(query.toLowerCase().trim())) {
                commandSuggestions.push({
                    item: {
                        id: 'slash-cmd:' + prefix,
                        name: label,
                        type: SearchItemType.COMMAND,
                        filePath: '',
                        detail: desc,
                    },
                    score: 1,
                    scope: SearchScope.COMMANDS,
                });
                processedScopes.add(scope);
            }
        }

        if (commandSuggestions.length > 0) {
            quickPick.items = commandSuggestions.map((r) => this.resultToQuickPickItem(r));
            this.updateTitle(quickPick, commandSuggestions.length);
            quickPick.busy = false;
        }
    }

    private async handleQueryChange(
        quickPick: vscode.QuickPick<SearchResultItem>,
        query: string,
        setBurstTimeout: (t: NodeJS.Timeout) => void,
        setFuzzyTimeout: (t: NodeJS.Timeout) => void,
    ): Promise<void> {
        // Parse scope from query
        const { scope, text } = this.parseQuery(query);

        // Auto-switch scope and remove prefix if a command is typed
        if (scope) {
            this.userSelectedScope = scope;
            this.currentScope = scope;
            this.updateFilterButtons(quickPick);
            quickPick.placeholder = this.getPlaceholder();
            
            // Remove the command prefix from the input box
            // This will trigger onDidChangeValue again with the clean text
            quickPick.value = text;
            return;
        }

        // Update current scope: use parsed scope if available, otherwise user selection
        // In this path (scope undefined), we rely on userSelectedScope
        const previousScope = this.currentScope;
        this.currentScope = this.userSelectedScope;

        // Update UI if scope changed
        if (previousScope !== this.currentScope) {
            this.updateFilterButtons(quickPick);
            quickPick.placeholder = this.getPlaceholder();
        }

        // Check if user is typing a slash command
        // We show the list if the query starts with / and we haven't matched a full scope yet
        if (query.startsWith('/')) {
            this.suggestSlashCommands(quickPick, query);
            if (quickPick.items.length > 0) {
                return;
            }
        }

        const trimmedQuery = text.trim();
        const queryId = ++this.lastQueryId;

        if (!trimmedQuery) {
            await this.showRecentHistory(quickPick);
            if (queryId === this.lastQueryId) {
                quickPick.busy = false;
            }
            return;
        }

        // Start busy indicator for deep scan
        quickPick.busy = true;

        // PHASE 0: Absolute Instant (Immediate exact-name hits)
        try {
            const instantResults = await this.searchEngine.burstSearch({
                query: trimmedQuery,
                scope: this.currentScope,
                maxResults: 5,
            }, undefined); // No token for burst search as it should be instant

            if (queryId !== this.lastQueryId) {
                return;
            }

            if (instantResults.length > 0) {
                quickPick.items = instantResults.map((r) => this.resultToQuickPickItem(r));
                this.updateTitle(quickPick, instantResults.length);
            }
            // Don't clear items here - let history stay until we have real results (avoid flicker)
        } catch (error) {
            console.error(`Phase 0 search error: ${error}`);
        }

        // PHASE 1: Quick Burst (Wait 10ms for prefix/multichar)
        setBurstTimeout(
            setTimeout(async () => {
                if (queryId !== this.lastQueryId) {
                    return;
                }

                try {
                    const burstResults = await this.searchEngine.burstSearch({
                        query: trimmedQuery,
                        scope: this.currentScope,
                        maxResults: 15,
                    }, undefined);

                    if (queryId !== this.lastQueryId) {
                        return;
                    }

                    // Update if we have more results
                    if (burstResults.length > 0) {
                        quickPick.items = burstResults.map((r) => this.resultToQuickPickItem(r));
                        this.updateTitle(quickPick, burstResults.length);
                    }
                } catch (error) {
                    console.error(`Phase 1 search error: ${error}`);
                }
            }, 10),
        );

        // PHASE 2: Deep Fuzzy Search (Stabilized results)
        setFuzzyTimeout(
            setTimeout(async () => {
                if (queryId !== this.lastQueryId) {
                    return;
                }
                try {
                    await this.performSearch(quickPick, text, queryId); // Use text (parsed) instead of raw query
                } finally {
                    if (queryId === this.lastQueryId) {
                        quickPick.busy = false;
                    }
                }
            }, 100),
        );
    }

    /**
     * Handle button clicks for filter toggling
     */
    private async handleButtonPress(
        quickPick: vscode.QuickPick<SearchResultItem>,
        button: vscode.QuickInputButton,
    ): Promise<void> {
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
                const currentQuery = quickPick.value;

                // Check if current query has ANY known prefix
                for (const [prefix] of this.PREFIX_MAP.entries()) {
                    if (currentQuery.toLowerCase().startsWith(prefix)) {
                        // Clear the prefix when switching scopes via buttons
                        const replacement = '';
                        quickPick.value = replacement + currentQuery.slice(prefix.length);
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

                // If the value changed, onDidChangeValue will take care of the search
                if (currentQuery !== quickPick.value) {
                    return;
                }

                const queryId = ++this.lastQueryId;
                await this.performSearch(quickPick, text, queryId);
                break;
            }
        }
    }

    /**
     * Perform search and update quick pick items
     */
    private async performSearch(
        quickPick: vscode.QuickPick<SearchResultItem>,
        query: string,
        queryId: number,
    ): Promise<SearchResult[]> {
        if (!query || query.trim().length === 0) {
            if (queryId === this.lastQueryId) {
                quickPick.items = [];
            }
            return [];
        }

        // Cancel previous search
        this.cancelSearch();
        this.searchCts = new vscode.CancellationTokenSource();

        const trimmedQuery = query.trim();

        const options: SearchOptions = {
            query: trimmedQuery,
            scope: this.currentScope,
            maxResults: this.config.getMaxResults(),
            enableCamelHumps: this.config.isCamelHumpsEnabled(),
            requestId: queryId,
        };

        this.streamingResults.set(queryId, []);

        const startTime = Date.now();
        let results: SearchResult[] = [];
        
        try {
            results = await this.searchEngine.search(options, this.searchCts.token);
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                return [];
            }
            console.error(error);
            return [];
        }

        const duration = Date.now() - startTime;

        if (queryId !== this.lastQueryId) {
            this.streamingResults.delete(queryId);
            return [];
        }
        
        this.processSearchResults(quickPick, results, trimmedQuery, duration, queryId);

        return results;
    }

    private processSearchResults(
        quickPick: vscode.QuickPick<SearchResultItem>,
        results: SearchResult[],
        query: string,
        duration: number,
        queryId: number,
    ): void {
        // Merge command results if command search is enabled/relevant
        if (this.currentScope === SearchScope.EVERYTHING || this.currentScope === SearchScope.COMMANDS) {
            if (this.commandIndexer) {
                const commandResults = this.commandIndexer.search(query);
                results.push(...commandResults);
            }
        }

        // Unified EVERYTHING scope merge is now handled by the LSP search engine

        if (queryId === this.lastQueryId) {
            // Sort by score if we merged multiple types
            if (this.currentScope === SearchScope.EVERYTHING) {
                results.sort((a, b) => {
                    const scoreA = typeof a.score === 'number' ? a.score : 0;
                    const scoreB = typeof b.score === 'number' ? b.score : 0;
                    return scoreB - scoreA;
                });
            }

            // If we still have NO results at the end of Phase 2, then we clear the stale items (history)
            if (results.length === 0) {
                quickPick.items = [this.getEmptyStateItem(query)];
                this.updateTitle(quickPick, 0, duration);
            } else {
                quickPick.items = results.map((result) => this.resultToQuickPickItem(result));
                this.updateTitle(quickPick, results.length, duration);
            }
            this.streamingResults.delete(queryId); // Done with streaming for this query
        }
    }

    /**
     * Get empty state item when no results are found
     */
    private getEmptyStateItem(query: string): SearchResultItem {
        const detail =
            this.currentScope !== SearchScope.EVERYTHING
                ? 'Try switching to Global search (/all) or check for typos'
                : 'Check for typos or try a different query';

        return {
            label: 'No results found',
            description: `No matching items found for '${query}'`,
            detail: detail,
            alwaysShow: true,
            iconPath: new vscode.ThemeIcon('search', new vscode.ThemeColor('descriptionForeground')),
            buttons: [
                {
                    iconPath: new vscode.ThemeIcon('refresh'),
                    tooltip: 'Rebuild Index (Fix missing files)',
                },
            ],
            result: {
                item: {
                    id: 'empty-state',
                    name: 'No results found',
                    type: SearchItemType.TEXT, // Dummy type
                    filePath: '',
                    detail: '',
                },
                score: 0,
                scope: this.currentScope,
            },
        };
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
                    iconPath: new vscode.ThemeIcon('file-submodule'),
                    tooltip: 'Copy Relative Path',
                },
                {
                    iconPath: new vscode.ThemeIcon('split-horizontal'),
                    tooltip: 'Open to the Side',
                },
                {
                    iconPath: new vscode.ThemeIcon('folder-opened'),
                    tooltip: 'Reveal in File Explorer',
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
                return 'whole-word';
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

        // Palette: Ignore empty state item
        if (item.id === 'empty-state') {
            return;
        }

        if (this.handleSlashCommandNavigation(item, preview)) {
            return;
        }

        this.recordItemActivity(item, preview);

        if (await this.handleCommandExecution(item, preview)) {
            return;
        }

        // Handle file/symbol navigation
        await this.navigateToFile(item, viewColumn, preview, result.highlights);
    }

    private handleSlashCommandNavigation(item: SearchableItem, preview: boolean): boolean {
        // Handle Slash Command Selection
        if (item.id.startsWith('slash-cmd:') && this.currentQuickPick) {
            if (preview) return true; // Don't do anything for preview

            const functionalPrefix = item.id.substring('slash-cmd:'.length);

            // Find scope for this prefix
            const scope = this.PREFIX_MAP.get(functionalPrefix);
            if (scope) {
                this.userSelectedScope = scope; // <--- FIX: Persist user selection
                this.currentScope = scope;
                this.updateFilterButtons(this.currentQuickPick);
                this.currentQuickPick.value = ''; // Clear the command text
                this.currentQuickPick.placeholder = this.getPlaceholder();
            }

            // Manually trigger handleQueryChange to force scope update logic/timeouts to reset
            this.handleQueryChange(
                this.currentQuickPick,
                '',
                () => { }, 
                () => { },
            );
            return true;
        }
        return false;
    }

    private recordItemActivity(item: SearchableItem, preview: boolean): void {
        // Don't record activity for previews
        if (!preview && this.config.isActivityTrackingEnabled()) {
            this.searchEngine.recordActivity(item.id);
            if (this.activityTracker) {
                this.activityTracker.recordAccess(item.id);
            }
        }
    }

    private async handleCommandExecution(item: SearchableItem, preview: boolean): Promise<boolean> {
        // Handle command execution
        if (item.type === SearchItemType.COMMAND && item.commandId) {
            if (!preview && this.commandIndexer) {
                await this.commandIndexer.executeCommand(item.commandId);
            }
            return true;
        }
        return false;
    }

    private async navigateToFile(
        item: SearchableItem,
        viewColumn: vscode.ViewColumn,
        preview: boolean,
        highlights?: number[][],
    ): Promise<void> {
        try {
            const uri = vscode.Uri.file(item.filePath);
            const document = await vscode.workspace.openTextDocument(uri);

            const position =
                item.line !== undefined ? new vscode.Position(item.line, item.column || 0) : new vscode.Position(0, 0);

            // Calculate range for selection and highlighting
            let range: vscode.Range;
            
            // Fix: Use absolute column for Text search if available
            // Highlights are now relative to the display label (trimmed), so we use them for length only
            if (item.type === SearchItemType.TEXT && item.column !== undefined) {
                 const length = (highlights && highlights.length > 0) 
                    ? (highlights[0][1] - highlights[0][0]) 
                    : item.name.length;
                    
                 range = new vscode.Range(
                    new vscode.Position(item.line || 0, item.column),
                    new vscode.Position(item.line || 0, item.column + length)
                 );
            } else if (highlights && highlights.length > 0) {
                const firstHighlight = highlights[0];
                range = new vscode.Range(
                    new vscode.Position(item.line || 0, firstHighlight[0]),
                    new vscode.Position(item.line || 0, firstHighlight[1]),
                );
            } else {
                range = new vscode.Range(position, position.translate(0, item.name.length));
            }

            const editor = await vscode.window.showTextDocument(document, {
                selection: range,
                viewColumn: viewColumn,
                preview: preview, // Use preview mode if requested
                preserveFocus: preview, // Keep focus on quick pick during preview
            });

            // Apply decoration
            editor.setDecorations(this.matchDecorationType, [range]);
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
