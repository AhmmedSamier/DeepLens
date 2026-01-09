import * as vscode from 'vscode';
import { ActivityTracker } from './activity-tracker';
import { CommandIndexer } from './command-indexer';
import { Config } from './config';
import { ISearchProvider } from './core/search-interface';
import { SearchItemType, SearchOptions, SearchResult, SearchScope } from './core/types';

/**
 * Search provider with enhanced UI (filter buttons, icons, counts)
 */
export class SearchProvider {
    private searchEngine: ISearchProvider;
    private config: Config;
    private activityTracker: ActivityTracker | undefined;
    private commandIndexer: CommandIndexer | undefined;
    private currentScope: SearchScope = SearchScope.EVERYTHING;
    private filterButtons: Map<SearchScope, vscode.QuickInputButton> = new Map();

    // Visual prefixes for button tooltips
    private readonly ACTIVE_PREFIX = '● ';
    private readonly INACTIVE_PREFIX = '○ ';
    private readonly ICON_CLASS = 'symbol-class';

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
        await this.showInternal();
    }

    /**
     * Internal show logic
     */
    private async showInternal(): Promise<void> {
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
        this.setupEventListeners(quickPick);

        quickPick.show();

        // Perform initial search if there's a query
        if (quickPick.value) {
            const results = await this.performSearch(quickPick, quickPick.value);
            this.updateTitle(quickPick, results.length);
        }
    }

    /**
     * Setup all quickPick event listeners
     */
    private setupEventListeners(quickPick: vscode.QuickPick<SearchResultItem>): void {
        let burstTimeout: NodeJS.Timeout | undefined;
        let fuzzyTimeout: NodeJS.Timeout | undefined;

        // Cleanup timeouts on hide
        const cleanupTimeouts = () => {
            if (burstTimeout) {
                clearTimeout(burstTimeout);
            }
            if (fuzzyTimeout) {
                clearTimeout(fuzzyTimeout);
            }
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

        quickPick.onDidTriggerButton((button) => this.handleButtonPress(quickPick, button));

        quickPick.onDidAccept(() => {
            const selected = quickPick.selectedItems[0];
            if (selected) {
                this.navigateToItem(selected.result);
                quickPick.hide();
            }
        });

        quickPick.onDidHide(() => {
            cleanupTimeouts();
            quickPick.dispose();
        });
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
        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
            quickPick.items = [];
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
                    const results = await this.performSearch(quickPick, query);
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
                this.currentScope = scope;
                quickPick.placeholder = this.getPlaceholder();
                this.updateFilterButtons(quickPick);

                // Re-run search with new filter
                const results = await this.performSearch(quickPick, quickPick.value);
                this.updateTitle(quickPick, results.length);
                break;
            }
        }
    }

    /**
     * Perform search and update quick pick items
     */
    private async performSearch(quickPick: vscode.QuickPick<SearchResultItem>, query: string): Promise<SearchResult[]> {
        if (!query || query.trim().length === 0) {
            quickPick.items = [];
            return [];
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
    private async navigateToItem(result: SearchResult): Promise<void> {
        const { item } = result;

        // Record activity
        if (this.activityTracker && this.config.isActivityTrackingEnabled()) {
            this.activityTracker.recordAccess(item.id);
        }

        // Handle command execution
        if (item.type === SearchItemType.COMMAND && item.commandId) {
            if (this.commandIndexer) {
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
                viewColumn: vscode.ViewColumn.Active,
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open file: ${item.filePath}`);
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
