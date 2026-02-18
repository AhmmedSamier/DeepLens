import * as vscode from 'vscode';
import { ActivityTracker } from '../../language-server/src/core/activity-tracker';
import { Config } from '../../language-server/src/core/config';
import {
    ISearchProvider,
    SearchItemType,
    SearchOptions,
    SearchResult,
    SearchScope,
    SearchableItem,
} from '../../language-server/src/core/types';
import { CommandIndexer } from './command-indexer';
import { DeepLensLspClient } from './lsp-client';
import { SlashCommand, SlashCommandService } from './slash-command-service';

/**
 * Search provider with enhanced UI (filter buttons, icons, counts)
 */
export class SearchProvider {
    private readonly searchEngine: ISearchProvider;
    private readonly config: Config;
    private readonly activityTracker: ActivityTracker | undefined;
    private readonly commandIndexer: CommandIndexer | undefined;
    private readonly slashCommandService: SlashCommandService;
    private currentScope: SearchScope = SearchScope.EVERYTHING;
    private userSelectedScope: SearchScope = SearchScope.EVERYTHING;
    private readonly filterButtons: Map<SearchScope, vscode.QuickInputButton> = new Map();
    private lastQueryId = 0;
    private lastAutoRebuildTime = 0;
    private currentQuickPick: vscode.QuickPick<SearchResultItem> | null = null;
    private readonly streamingResults: Map<number, SearchResult[]> = new Map();
    private searchCts: vscode.CancellationTokenSource | null = null;
    private lastTitle = '';
    private feedbackTimeout: NodeJS.Timeout | null = null;

    // Visual prefixes for button tooltips
    private readonly ACTIVE_PREFIX = 'Active: ';
    private readonly INACTIVE_PREFIX = '';
    private readonly ICON_CLASS = 'symbol-class';

    // Tooltips for empty state buttons
    private readonly TOOLTIP_REBUILD_INDEX = 'Rebuild Index (Fix missing files)';
    private readonly TOOLTIP_CLEAR_CACHE = 'Clear Index Cache (Fix corruption)';
    private readonly TOOLTIP_SETTINGS = 'Configure Settings';
    private readonly TOOLTIP_SEARCH_EVERYWHERE = 'Switch to Global Search (/all)';
    private readonly TOOLTIP_NATIVE_SEARCH = 'Search in Files (Native)';
    private readonly LABEL_CLEAR_HISTORY = 'Clear Recent History';
    private readonly TOOLTIP_REMOVE_HISTORY = 'Remove from History';

    // Tooltips for item buttons
    private readonly TOOLTIP_COPY_PATH = 'Copy Path';
    private readonly TOOLTIP_COPY_REF = 'Copy Reference';
    private readonly TOOLTIP_COPY_REL = 'Copy Relative Path';
    private readonly TOOLTIP_OPEN_SIDE = 'Open to the Side';
    private readonly TOOLTIP_REVEAL = 'Reveal in File Explorer';

    // Command IDs for empty state actions
    private readonly CMD_NATIVE_SEARCH = 'command:native-search';
    private readonly CMD_SWITCH_SCOPE = 'command:switch-scope-everything';
    private readonly CMD_REBUILD_INDEX = 'command:rebuild-index';
    private readonly CMD_CLEAR_CACHE = 'command:clear-cache';
    private readonly CMD_SETTINGS = 'command:open-settings';
    private readonly ID_EMPTY_STATE = 'empty-state';

    private readonly matchDecorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        border: '1px solid',
        borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder'),
        borderRadius: '2px',
    });

    // Prefix mapping for search scopes (slash commands from SlashCommandService)
    // Only includes prefixes with trailing space - commands must be followed by space to trigger
    // This allows typing "/txt" without immediately switching to "/t" (types)
    private readonly PREFIX_MAP = new Map<string, SearchScope>([
        ['/t ', SearchScope.TYPES],
        ['/classes ', SearchScope.TYPES],
        ['/types ', SearchScope.TYPES],
        ['/c ', SearchScope.TYPES],
        ['/txt ', SearchScope.TEXT],
        ['/text ', SearchScope.TEXT],
        ['/s ', SearchScope.SYMBOLS],
        ['/symbols ', SearchScope.SYMBOLS],
        ['/f ', SearchScope.FILES],
        ['/files ', SearchScope.FILES],
        ['/cmd ', SearchScope.COMMANDS],
        ['/commands ', SearchScope.COMMANDS],
        ['/p ', SearchScope.PROPERTIES],
        ['/properties ', SearchScope.PROPERTIES],
        ['/e ', SearchScope.ENDPOINTS],
        ['/endpoints ', SearchScope.ENDPOINTS],
        ['/a ', SearchScope.EVERYTHING],
        ['/all ', SearchScope.EVERYTHING],
        ['/everything ', SearchScope.EVERYTHING],
        ['/o ', SearchScope.OPEN],
        ['/open ', SearchScope.OPEN],
        ['/m ', SearchScope.MODIFIED],
        ['/modified ', SearchScope.MODIFIED],
        ['/git ', SearchScope.MODIFIED],
        ['#', SearchScope.SYMBOLS],
        ['>', SearchScope.COMMANDS],
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
        this.slashCommandService = new SlashCommandService();
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
     * Show transient feedback in status bar and as title flash
     */
    private showFeedback(message: string): void {
        if (this.currentQuickPick) {
            if (this.feedbackTimeout) {
                clearTimeout(this.feedbackTimeout);
            }

            this.currentQuickPick.title = `DeepLens - ${message}`;

            this.feedbackTimeout = setTimeout(() => {
                if (this.currentQuickPick) {
                    this.currentQuickPick.title = this.lastTitle;
                }
                this.feedbackTimeout = null;
            }, 2000);
        }
        vscode.window.setStatusBarMessage(`$(check) ${message}`, 2000);
    }

    /**
     * Create filter buttons for each scope
     */
    private createFilterButtons(): void {
        const dimmedColor = new vscode.ThemeColor('descriptionForeground');

        const buttonConfigs = [
            { scope: SearchScope.EVERYTHING, icon: 'search', label: 'All', shortcut: '/all' },
            { scope: SearchScope.OPEN, icon: 'book', label: 'Open Files', shortcut: '/o' },
            { scope: SearchScope.MODIFIED, icon: 'git-merge', label: 'Modified', shortcut: '/m' },
            { scope: SearchScope.TYPES, icon: this.ICON_CLASS, label: 'Classes', shortcut: '/t' },
            { scope: SearchScope.SYMBOLS, icon: 'symbol-method', label: 'Symbols', shortcut: '/s or #' },
            { scope: SearchScope.FILES, icon: 'file', label: 'Files', shortcut: '/f' },
            { scope: SearchScope.TEXT, icon: 'whole-word', label: 'Text', shortcut: '/txt' },
            { scope: SearchScope.COMMANDS, icon: 'run', label: 'Commands', shortcut: '/cmd or >' },
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
            case SearchScope.OPEN:
                return new vscode.ThemeIcon('book', color);
            case SearchScope.MODIFIED:
                return new vscode.ThemeIcon('git-merge', color);
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
            SearchScope.OPEN,
            SearchScope.MODIFIED,
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
            case SearchScope.OPEN:
                return 'Open Files: Type to search in currently open files...';
            case SearchScope.MODIFIED:
                return 'Modified: Type to search in modified/untracked files...';
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
            case SearchScope.OPEN:
                filterName = 'Open Files';
                break;
            case SearchScope.MODIFIED:
                filterName = 'Modified Files';
                break;
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

        this.lastTitle = `DeepLens - ${filterName}${countSuffix}${durationSuffix}`;

        // If a feedback flash is active, we don't overwrite it immediately unless it's stale?
        // Actually, if new results arrive, they are more important. Cancel flash.
        if (this.feedbackTimeout) {
            clearTimeout(this.feedbackTimeout);
            this.feedbackTimeout = null;
        }

        quickPick.title = this.lastTitle;
    }

    /**
     * Cancel any ongoing search
     */
    private cancelSearch(): void {
        if (this.searchCts) {
            this.searchCts.cancel();
            this.searchCts.dispose();
            this.searchCts = null;
        }
    }

    /**
     * Show search UI with specific scope and optional initial query
     */
    async show(scope?: SearchScope, initialQuery?: string): Promise<void> {
        if (scope === undefined) {
            // Use persisted scope
            this.currentScope = this.userSelectedScope;
        } else {
            this.currentScope = scope;
            this.userSelectedScope = scope;
        }
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
     * Prompt for confirmation before clearing history
     */
    private promptClearHistory(quickPick: vscode.QuickPick<SearchResultItem>): void {
        const confirmItem: SearchResultItem = {
            label: 'Confirm Clear History',
            detail: 'This cannot be undone',
            iconPath: new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground')),
            alwaysShow: true,
            result: {
                item: {
                    id: 'command:confirm-clear-history',
                    name: 'Confirm Clear History',
                    type: SearchItemType.COMMAND,
                    filePath: '',
                    detail: '',
                },
                score: 0,
                scope: SearchScope.COMMANDS,
            },
        };

        const cancelItem: SearchResultItem = {
            label: 'Cancel',
            description: 'Go back to history',
            iconPath: new vscode.ThemeIcon('close'),
            alwaysShow: true,
            result: {
                item: {
                    id: 'command:cancel-clear-history',
                    name: 'Cancel',
                    type: SearchItemType.COMMAND,
                    filePath: '',
                    detail: '',
                },
                score: 0,
                scope: SearchScope.COMMANDS,
            },
        };

        quickPick.items = [confirmItem, cancelItem];
        quickPick.title = 'Are you sure you want to clear recent history?';
    }

    /**
     * Clear recent history
     */
    private async performClearHistory(quickPick: vscode.QuickPick<SearchResultItem>): Promise<void> {
        if (this.activityTracker) {
            await this.activityTracker.clearAll();
            this.showFeedback('Recent history cleared');
            // Refresh history (which should now be empty and show welcome items)
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
                quickPick.items = this.getWelcomeItems();
                this.updateTitle(quickPick, 0);
                quickPick.title += ' - Quick Start';
                return;
            }

            // Map results to QuickPick items
            const items = results.map((r) => this.resultToQuickPickItem(r));

            // Add remove button to history items
            const removeButton = {
                iconPath: new vscode.ThemeIcon('close'),
                tooltip: this.TOOLTIP_REMOVE_HISTORY,
            };

            for (const item of items) {
                item.buttons = [...(item.buttons || []), removeButton];
            }

            // Add Clear History item if we have tracking enabled
            if (this.activityTracker) {
                items.push(this.getClearHistoryItem());
            }

            quickPick.items = items;

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
        let lastActiveItemId: string | null = null;
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
            lastActiveItemId = null;
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
                if (lastActiveItemId !== null && lastActiveItemId !== currentItemId) {
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

        quickPick.onDidTriggerItemButton(async (e) => {
            const result = (e.item as SearchResultItem).result;
            await this.handleItemButtonClick(quickPick, result, e.button.tooltip, () => {
                accepted = true;
            });
        });

        quickPick.onDidAccept(async () => {
            const selected = quickPick.selectedItems[0];
            if (selected) {
                // Handle Clear History
                if (selected.result.item.id === 'command:clear-history') {
                    this.promptClearHistory(quickPick);
                    return;
                }

                if (selected.result.item.id === 'command:confirm-clear-history') {
                    this.performClearHistory(quickPick);
                    return;
                }

                if (selected.result.item.id === 'command:cancel-clear-history') {
                    this.showRecentHistory(quickPick);
                    return;
                }

                // Handle Empty State Actions
                if (await this.handleEmptyStateAction(selected, quickPick)) {
                    return;
                }

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

            this.streamingResults.clear();
            this.currentQuickPick = null;

            quickPick.dispose();
        });
    }

    private async handleItemButtonClick(
        quickPick: vscode.QuickPick<SearchResultItem>,
        result: SearchResult,
        tooltip: string,
        markAccepted: () => void,
    ): Promise<void> {
        if (tooltip === this.TOOLTIP_SEARCH_EVERYWHERE) {
            this.handleSearchEverywhereButton(quickPick);
            return;
        }

        if (tooltip === this.TOOLTIP_NATIVE_SEARCH) {
            await vscode.commands.executeCommand('workbench.action.findInFiles', {
                query: quickPick.value,
                triggerSearch: true,
            });
            quickPick.hide();
            return;
        }

        if (tooltip === this.TOOLTIP_COPY_PATH) {
            await vscode.env.clipboard.writeText(result.item.filePath);
            this.showFeedback('Path copied to clipboard');
            return;
        }

        if (tooltip === this.TOOLTIP_COPY_REF) {
            const ref = result.item.containerName
                ? `${result.item.containerName}.${result.item.name}`
                : result.item.name;
            await vscode.env.clipboard.writeText(ref);
            this.showFeedback('Reference copied to clipboard');
            return;
        }

        if (tooltip === this.TOOLTIP_COPY_REL) {
            const relativePath = vscode.workspace.asRelativePath(result.item.filePath);
            await vscode.env.clipboard.writeText(relativePath);
            this.showFeedback('Relative path copied to clipboard');
            return;
        }

        if (tooltip === this.TOOLTIP_OPEN_SIDE) {
            markAccepted();
            this.navigateToItem(result, vscode.ViewColumn.Beside);
            quickPick.hide();
            return;
        }

        if (tooltip === this.TOOLTIP_REVEAL) {
            const uri = vscode.Uri.file(result.item.filePath);
            vscode.commands.executeCommand('revealInExplorer', uri);
            return;
        }

        if (tooltip === this.TOOLTIP_REMOVE_HISTORY) {
            if (this.activityTracker) {
                await this.activityTracker.removeItem(result.item.id);
                this.showFeedback('Item removed from history');
                await this.showRecentHistory(quickPick);
            }
            return;
        }

        if (tooltip === this.TOOLTIP_REBUILD_INDEX) {
            vscode.commands.executeCommand('deeplens.rebuildIndex');
            quickPick.hide();
            return;
        }

        if (tooltip === this.TOOLTIP_CLEAR_CACHE) {
            vscode.commands.executeCommand('deeplens.clearIndexCache');
            quickPick.hide();
            return;
        }

        if (tooltip === this.TOOLTIP_SETTINGS) {
            vscode.commands.executeCommand('workbench.action.openSettings', 'deeplens');
        }
    }

    private handleSearchEverywhereButton(quickPick: vscode.QuickPick<SearchResultItem>): void {
        this.userSelectedScope = SearchScope.EVERYTHING;
        this.currentScope = SearchScope.EVERYTHING;

        const currentQuery = quickPick.value;
        const normalizedQuery = currentQuery.toLowerCase();

        for (const [prefix] of this.PREFIX_MAP.entries()) {
            if (normalizedQuery.startsWith(prefix)) {
                quickPick.value = currentQuery.slice(prefix.length);
                break;
            }
        }

        quickPick.placeholder = this.getPlaceholder();
        this.updateFilterButtons(quickPick);

        const { text } = this.parseQuery(quickPick.value);
        const queryId = ++this.lastQueryId;
        this.performSearch(quickPick, text, queryId);
    }

    /**
     * Create a search result for a slash command
     */
    private createCommandSuggestion(cmd: SlashCommand, score: number, isRecent: boolean = false): SearchResult {
        const primaryAlias = this.slashCommandService.getPrimaryAlias(cmd);
        const aliasText = this.formatAliasText(cmd);
        const shortcutText = cmd.keyboardShortcut ? ` • ${cmd.keyboardShortcut}` : '';
        const exampleText = cmd.example ? ` • Try: ${cmd.example}` : '';
        const description = `${cmd.description}${aliasText}${shortcutText}${exampleText}`;

        return {
            item: {
                id: 'slash-cmd:' + primaryAlias,
                name: primaryAlias,
                type: SearchItemType.COMMAND,
                filePath: '',
                detail: isRecent ? `↺ Recent • ${description}` : description,
                containerName: this.getCategoryLabel(cmd.category),
            },
            score: score,
            scope: SearchScope.COMMANDS,
        };
    }

    /**
     * Parse query to extract scope and search term
     * Only considers a command complete if it's followed by a space (e.g., "/t ")
     */
    private parseQuery(query: string): { scope: SearchScope | null; text: string } {
        // Check for prefixes with space (completed commands)
        // We only auto-switch scope if the command is followed by space
        // This allows typing "/txt" without immediately switching to "/t" (types)
        // Single character triggers (#, >) are always immediate
        for (const [prefix, scope] of this.PREFIX_MAP.entries()) {
            if (query.toLowerCase().startsWith(prefix) && (prefix.endsWith(' ') || prefix.length === 1)) {
                return {
                    scope,
                    text: query.slice(prefix.length),
                };
            }
        }

        return {
            scope: null,
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
        const commands = this.slashCommandService.getCommands(query);
        const recentCommands = this.slashCommandService.getRecentCommands();

        const commandSuggestions: SearchResult[] = [];
        const seen = new Set<string>();

        // Add recent commands first with a visual indicator
        for (const cmd of recentCommands) {
            if (seen.has(cmd.name)) continue;
            if (
                query &&
                !cmd.name.toLowerCase().startsWith(query.toLowerCase()) &&
                !cmd.aliases.some((a) => a.toLowerCase().startsWith(query.toLowerCase()))
            )
                continue;

            commandSuggestions.push(this.createCommandSuggestion(cmd, 1000, true));
            seen.add(cmd.name);
        }

        // Add matching commands
        for (const cmd of commands) {
            if (seen.has(cmd.name)) continue;

            commandSuggestions.push(this.createCommandSuggestion(cmd, 1, false));
            seen.add(cmd.name);
        }

        if (commandSuggestions.length > 0) {
            quickPick.items = commandSuggestions.map((r) => this.resultToSlashCommandQuickPickItem(r));
            this.updateTitle(quickPick, commandSuggestions.length);
            quickPick.busy = false;
        }
    }

    private getCategoryLabel(category: string): string {
        switch (category) {
            case 'Search':
                return 'Search';
            case 'Navigation':
                return 'Navigation';
            case 'Files':
                return 'Files';
            case 'Refactoring':
                return 'Refactoring';
            case 'Actions':
                return 'Actions';
            default:
                return category;
        }
    }

    private formatAliasText(cmd: SlashCommand): string {
        const aliases = this.slashCommandService.getAliasesForDisplay(cmd);
        const primaryAlias = this.slashCommandService.getPrimaryAlias(cmd);

        const otherAliases = aliases.filter((a) => a !== primaryAlias);

        if (otherAliases.length === 0) {
            return '';
        }

        return ` • Aliases: ${otherAliases.join(', ')}`;
    }

    private resultToSlashCommandQuickPickItem(result: SearchResult): SearchResultItem {
        const { item } = result;
        const commandKey = item.id.startsWith('slash-cmd:') ? item.id.slice('slash-cmd:'.length) : item.name;
        const slashCmd = this.slashCommandService.getCommand(commandKey);
        const iconColor = new vscode.ThemeColor('textLink.foreground');

        // Show primary alias (short form) as label
        const label = slashCmd ? this.slashCommandService.getPrimaryAlias(slashCmd) : item.name;

        return {
            label: label,
            description: item.containerName,
            detail: item.detail,
            iconPath: slashCmd
                ? new vscode.ThemeIcon(slashCmd.icon, iconColor)
                : new vscode.ThemeIcon('run', iconColor),
            alwaysShow: true,
            result,
        };
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
        // We show the list if the query starts with /, # or > and we haven't matched a full scope yet
        if (query.startsWith('/') || query.startsWith('#') || query.startsWith('>')) {
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
        // PHASE 0: Absolute Instant (Immediate exact-name hits)
        if (this.currentScope !== SearchScope.COMMANDS) {
            try {
                const instantResults = await this.searchEngine.burstSearch(
                    {
                        query: trimmedQuery,
                        scope: this.currentScope,
                        maxResults: 5,
                        requestId: queryId,
                    },
                    undefined,
                ); // No token for burst search as it should be instant

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
        }

        // PHASE 1: Quick Burst (Wait 10ms for prefix/multichar)
        setBurstTimeout(
            setTimeout(async () => {
                if (queryId !== this.lastQueryId) {
                    return;
                }

                if (this.currentScope === SearchScope.COMMANDS) {
                    return;
                }

                try {
                    const burstResults = await this.searchEngine.burstSearch(
                        {
                            query: trimmedQuery,
                            scope: this.currentScope,
                            maxResults: 15,
                            requestId: queryId,
                        },
                        undefined,
                    );

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
            // Optimization: Skip LSP search for commands (handled purely by local indexer)
            if (this.currentScope !== SearchScope.COMMANDS) {
                results = await this.searchEngine.search(options, this.searchCts.token);
            }
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

        await this.processSearchResults(quickPick, results, trimmedQuery, duration, queryId);

        return results;
    }

    private async processSearchResults(
        quickPick: vscode.QuickPick<SearchResultItem>,
        results: SearchResult[],
        query: string,
        duration: number,
        queryId: number,
    ): Promise<void> {
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
                await this.checkEmptyIndex(queryId);

                if (queryId === this.lastQueryId) {
                    this.handleEmptyStateDisplay(quickPick, query, duration);
                }
            } else {
                quickPick.items = results.map((result) => this.resultToQuickPickItem(result));
                this.updateTitle(quickPick, results.length, duration);
            }
            if (queryId === this.lastQueryId) {
                this.streamingResults.delete(queryId); // Done with streaming for this query
            }
        }
    }

    /**
     * Handle empty state display and auto-selection
     */
    private handleEmptyStateDisplay(
        quickPick: vscode.QuickPick<SearchResultItem>,
        query: string,
        duration: number,
    ): void {
        quickPick.items = this.getEmptyStateItems(query);

        // Update title explicitly for empty state
        // This ensures screen readers announce "No results found" immediately
        const durationText = duration >= 1000 ? `${(duration / 1000).toFixed(2)}s` : `${duration}ms`;
        quickPick.title = `DeepLens - No results found — Search took ${durationText}`;

        // Auto-select the best recovery action
        // Prioritize switching scope, then native search
        const bestAction = quickPick.items.find(
            (i) => i.result.item.id === this.CMD_SWITCH_SCOPE || i.result.item.id === this.CMD_NATIVE_SEARCH,
        );

        if (bestAction) {
            quickPick.activeItems = [bestAction];
        }
    }

    /**
     * Check if index is empty and rebuild if necessary
     */
    private async checkEmptyIndex(queryId: number): Promise<void> {
        // Only run for EVERYTHING scope and if searchEngine supports getIndexStats
        if (
            this.currentScope !== SearchScope.EVERYTHING ||
            !this.searchEngine.getIndexStats ||
            queryId !== this.lastQueryId
        ) {
            return;
        }

        try {
            const stats = await this.searchEngine.getIndexStats();
            // Verify queryId is still valid after await
            if (queryId !== this.lastQueryId || !stats) {
                return;
            }

            const isIndexEmpty = stats.totalItems === 0 && stats.totalFiles === 0;
            if (isIndexEmpty && !stats.indexing) {
                this.triggerAutoRebuild();
            }
        } catch (e) {
            console.error('Failed to check index stats:', e);
        }
    }

    private triggerAutoRebuild(): void {
        const now = Date.now();
        // Limit auto-rebuild to once every 60 seconds to avoid loops
        if (now - this.lastAutoRebuildTime > 60000) {
            this.lastAutoRebuildTime = now;
            vscode.window.showInformationMessage('DeepLens index is empty. Rebuilding automatically...');
            vscode.commands.executeCommand('deeplens.rebuildIndex');
        }
    }

    /**
     * Get item for clearing history
     */
    private getClearHistoryItem(): SearchResultItem {
        return {
            label: this.LABEL_CLEAR_HISTORY,
            description: 'Remove all locally tracked history items',
            iconPath: new vscode.ThemeIcon('trash', new vscode.ThemeColor('descriptionForeground')),
            alwaysShow: true,
            result: {
                item: {
                    id: 'command:clear-history',
                    name: this.LABEL_CLEAR_HISTORY,
                    type: SearchItemType.COMMAND,
                    filePath: '',
                    detail: '',
                },
                score: 0,
                scope: SearchScope.COMMANDS,
            },
        };
    }

    private async handleEmptyStateAction(
        selected: SearchResultItem,
        quickPick: vscode.QuickPick<SearchResultItem>,
    ): Promise<boolean> {
        if (selected.result.item.id === this.CMD_NATIVE_SEARCH) {
            await vscode.commands.executeCommand('workbench.action.findInFiles', {
                query: quickPick.value,
                triggerSearch: true,
            });
            quickPick.hide();
            return true;
        }

        if (selected.result.item.id === this.CMD_SWITCH_SCOPE) {
            this.userSelectedScope = SearchScope.EVERYTHING;
            this.currentScope = SearchScope.EVERYTHING;

            const currentQuery = quickPick.value;
            let text = currentQuery;

            // Check if current query has ANY known prefix
            for (const [prefix] of this.PREFIX_MAP.entries()) {
                if (currentQuery.toLowerCase().startsWith(prefix)) {
                    text = currentQuery.slice(prefix.length);
                    quickPick.value = text;
                    break;
                }
            }

            this.updateFilterButtons(quickPick);
            quickPick.placeholder = this.getPlaceholder();
            const queryId = ++this.lastQueryId;
            this.performSearch(quickPick, text, queryId);
            return true;
        }

        if (selected.result.item.id === this.CMD_REBUILD_INDEX) {
            vscode.commands.executeCommand('deeplens.rebuildIndex');
            quickPick.hide();
            return true;
        }

        if (selected.result.item.id === this.CMD_CLEAR_CACHE) {
            vscode.commands.executeCommand('deeplens.clearIndexCache');
            quickPick.hide();
            return true;
        }

        if (selected.result.item.id === this.CMD_SETTINGS) {
            vscode.commands.executeCommand('workbench.action.openSettings', 'deeplens');
            return true;
        }

        return selected.result.item.id === this.ID_EMPTY_STATE;
    }

    /**
     * Get empty state items when no results are found
     */
    private getEmptyStateItems(query: string): SearchResultItem[] {
        const detail =
            this.currentScope !== SearchScope.EVERYTHING
                ? 'Try switching to Global search or check for typos'
                : `We couldn't find '${query}'. Check for typos, excluded files, or try rebuilding the index.`;

        const items: SearchResultItem[] = [];

        // 1. Header Item (Informational)
        items.push({
            label: `No results found for '${query}'`,
            description: '',
            detail: detail,
            alwaysShow: true,
            iconPath: new vscode.ThemeIcon('info', new vscode.ThemeColor('descriptionForeground')),
            result: {
                item: {
                    id: this.ID_EMPTY_STATE,
                    name: 'No results found',
                    type: SearchItemType.TEXT,
                    filePath: '',
                    detail: '',
                },
                score: 0,
                scope: this.currentScope,
            },
        });

        // 2. Switch Scope Action (if not already global)
        if (this.currentScope !== SearchScope.EVERYTHING) {
            items.push({
                label: 'Switch to Global Search',
                description: 'Search everywhere (/all)',
                alwaysShow: true,
                iconPath: new vscode.ThemeIcon('search'),
                result: {
                    item: {
                        id: this.CMD_SWITCH_SCOPE,
                        name: 'Switch to Global Search',
                        type: SearchItemType.COMMAND,
                        filePath: '',
                        detail: '',
                    },
                    score: 0,
                    scope: SearchScope.COMMANDS,
                },
            });
}

        // Helper method to create command items
        const addCommandItem = (
            label: string,
            description: string,
            icon: vscode.ThemeIcon,
            commandId: string,
        ) => {
            items.push({
                label,
                description,
                alwaysShow: true,
                iconPath: icon,
                result: {
                    item: {
                        id: commandId,
                        name: label.replace(' (Native)', ''),
                        type: SearchItemType.COMMAND,
                        filePath: '',
                        detail: '',
                    },
                    score: 0,
                    scope: SearchScope.COMMANDS,
                },
            });
        };

// 3. Native Search Action
        addCommandItem(
            'Search in Files (Native)',
            "Use VS Code's native search",
            new vscode.ThemeIcon('search-fuzzy'),
            this.CMD_NATIVE_SEARCH,
        );

        // 4. Rebuild Index Action
        addCommandItem(
            'Rebuild Index',
            'Fix missing files',
            new vscode.ThemeIcon('refresh'),
            this.CMD_REBUILD_INDEX,
        );

        // 5. Clear Cache Action
        addCommandItem(
            'Clear Index Cache',
            'Fix corruption',
            new vscode.ThemeIcon('trash'),
            this.CMD_CLEAR_CACHE,
        );

        // 6. Settings Action
        addCommandItem(
            'Configure Settings',
            'Check exclusion rules',
            new vscode.ThemeIcon('settings-gear'),
            this.CMD_SETTINGS,
        );

        return items;
    }

    /**
     * Get welcome items for empty state
     */
    private getWelcomeItems(): SearchResultItem[] {
        const items = [
            ['/all', 'Search Everything', 'Type to search classes, files, symbols, and more', SearchScope.EVERYTHING],
            ['/t', 'Search Classes', 'Find classes, interfaces, and enums (/t)', SearchScope.TYPES],
            ['/f', 'Search Files', 'Find files by name or path (/f)', SearchScope.FILES],
            ['/s', 'Search Symbols', 'Find methods, functions, and variables (/s)', SearchScope.SYMBOLS],
            ['/txt', 'Search Text', 'Find text content across all files (/txt)', SearchScope.TEXT],
        ] as const;

        const iconMap = new Map<SearchScope, string>([
            [SearchScope.EVERYTHING, 'search'],
            [SearchScope.TYPES, this.ICON_CLASS],
            [SearchScope.FILES, 'file'],
            [SearchScope.SYMBOLS, 'symbol-method'],
            [SearchScope.TEXT, 'whole-word'],
        ]);

        return items.map(([cmd, name, detail, scope]) => {
            const item = this.resultToQuickPickItem({
                item: {
                    id: `slash-cmd:${cmd}`,
                    name,
                    type: SearchItemType.COMMAND,
                    filePath: '',
                    detail,
                },
                score: 1,
                scope,
            });

            const icon = iconMap.get(scope) || 'lightbulb';
            item.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor('textLink.foreground'));
            item.alwaysShow = true;
            return item;
        });
    }

    /**
     * Check if a file has unsaved changes
     */
    private isFileDirty(filePath: string): boolean {
        // Normalize for comparison
        const targetPath = vscode.Uri.file(filePath).fsPath;
        return vscode.workspace.textDocuments.some((doc) => doc.isDirty && doc.uri.fsPath === targetPath);
    }

    /**
     * Get icon and resource URI for item
     */
    private getItemIcon(item: SearchableItem): { iconPath: vscode.ThemeIcon | vscode.Uri; resourceUri?: vscode.Uri } {
        // Check if experimental icons are enabled
        const enableIcons = vscode.workspace.getConfiguration('deeplens').get('experimental.enableFileIcons', false);

        if (item.type === SearchItemType.FILE) {
            if (enableIcons) {
                // Try to use native file icon via resourceUri (Proposed API)
                return {
                    resourceUri: vscode.Uri.file(item.filePath),
                    iconPath: vscode.ThemeIcon.File,
                };
            } else {
                // Fallback to standard file icon
                return {
                    iconPath: new vscode.ThemeIcon('file', new vscode.ThemeColor('symbolIcon.fileForeground')),
                };
            }
        }

        // Fallback to custom icon logic
        const icon = this.getIconForItemType(item.type);
        const iconColor = this.getIconColorForItemType(item.type);
        return {
            iconPath: new vscode.ThemeIcon(icon, iconColor),
        };
    }

    /**
     * Convert search result to QuickPick item
     */
    private resultToQuickPickItem(result: SearchResult): SearchResultItem {
        const { item } = result;

        const { iconPath, resourceUri } = this.getItemIcon(item);

        // Don't add icon to label - iconPath will render it
        const label = item.name;
        let description = '';
        let detail = '';

        // Add container name if available
        if (item.containerName) {
            description = item.containerName;
        }

        // Add unsaved indicator for dirty files
        if (item.type === SearchItemType.FILE && this.isFileDirty(item.filePath)) {
            const indicator = '$(circle-filled)'; // VS Code unsaved indicator style
            // Add (Unsaved) text for accessibility and clarity
            description = description ? `${indicator} ${description} (Unsaved)` : `${indicator} Unsaved`;
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

        // Conditional buttons based on item type
        const buttons: vscode.QuickInputButton[] = [];

        if (item.type !== SearchItemType.COMMAND) {
            buttons.push(
                {
                    iconPath: new vscode.ThemeIcon('copy'),
                    tooltip: this.TOOLTIP_COPY_PATH,
                },
                {
                    iconPath: new vscode.ThemeIcon('references'),
                    tooltip: this.TOOLTIP_COPY_REF,
                },
                {
                    iconPath: new vscode.ThemeIcon('file-submodule'),
                    tooltip: this.TOOLTIP_COPY_REL,
                },
                {
                    iconPath: new vscode.ThemeIcon('split-horizontal'),
                    tooltip: this.TOOLTIP_OPEN_SIDE,
                },
                {
                    iconPath: new vscode.ThemeIcon('folder-opened'),
                    tooltip: this.TOOLTIP_REVEAL,
                },
            );
        }

        return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            label: label as any,
            description,
            detail,
            iconPath: iconPath,
            resourceUri: resourceUri,
            alwaysShow: true, // Crucial: prevent VS Code from re-filtering our fuzzy results
            result,
            buttons: buttons,
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

            // Find scope for this prefix (add space to match PREFIX_MAP)
            const scope = this.PREFIX_MAP.get(functionalPrefix + ' ');
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
                () => {},
                () => {},
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
                this.activityTracker.recordAccess(item);
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
                const length =
                    highlights && highlights.length > 0 ? highlights[0][1] - highlights[0][0] : item.name.length;

                range = new vscode.Range(
                    new vscode.Position(item.line || 0, item.column),
                    new vscode.Position(item.line || 0, item.column + length),
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
    resourceUri?: vscode.Uri;
}
