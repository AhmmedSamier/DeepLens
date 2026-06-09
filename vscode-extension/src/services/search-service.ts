import * as vscode from 'vscode';
import { ActivityTracker } from '../../../language-server/src/core/activity-tracker';
import { Config } from '../../../language-server/src/core/config';
import {
    IndexStats,
    ISearchProvider,
    SearchItemType,
    SearchOptions,
    SearchResult,
    SearchScope,
    SearchableItem,
} from '../../../language-server/src/core/types';
import { CommandIndexer } from '../command-indexer';

export interface SearchResultItem extends vscode.QuickPickItem {
    result: SearchResult;
    resourceUri?: vscode.Uri;
}

export class SearchService {
    private readonly searchEngine: ISearchProvider;
    private readonly config: Config;
    private readonly activityTracker: ActivityTracker | undefined;
    private readonly commandIndexer: CommandIndexer | undefined;

    private readonly matchDecorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        border: '1px solid',
        borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder'),
        borderRadius: '2px',
    });

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
    }

    async search(query: string, scope: SearchScope, maxResults?: number): Promise<SearchResult[]> {
        if (!query || query.trim().length === 0) {
            return [];
        }

        const options: SearchOptions = {
            query: query.trim(),
            scope: scope,
            maxResults: maxResults ?? this.config.getMaxResults(),
        };

        try {
            const results = await this.searchEngine.search(options);
            return this.mergeCommandResults(results, query, scope);
        } catch (error) {
            console.error('Search error:', error);
            return [];
        }
    }

    async burstSearch(query: string, scope: SearchScope, maxResults?: number): Promise<SearchResult[]> {
        if (!query || query.trim().length === 0) {
            return [];
        }

        const options: SearchOptions = {
            query: query.trim(),
            scope: scope,
            maxResults: maxResults ?? this.config.getMaxResults(),
        };

        try {
            const results = await this.searchEngine.burstSearch(options);
            return this.mergeCommandResults(results, query, scope);
        } catch (error) {
            console.error('Burst search error:', error);
            return [];
        }
    }

    async burstSearchWithCancellationToken(
        query: string,
        scope: SearchScope,
        maxResults: number,
        cancellationToken: vscode.CancellationToken,
    ): Promise<SearchResult[]> {
        if (!query || query.trim().length === 0) {
            return [];
        }

        const options: SearchOptions = {
            query: query.trim(),
            scope: scope,
            maxResults: maxResults,
        };

        try {
            const results = await this.searchEngine.burstSearch(options, cancellationToken);
            return this.mergeCommandResults(results, query, scope);
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                return [];
            }
            console.error('Burst search error:', error);
            return [];
        }
    }

    private mergeCommandResults(results: SearchResult[], query: string, scope: SearchScope): SearchResult[] {
        if (scope === SearchScope.EVERYTHING || scope === SearchScope.COMMANDS) {
            if (this.commandIndexer) {
                const commandResults = this.commandIndexer.search(query.trim());
                for (let i = 0; i < commandResults.length; i++) {
                    results.push(commandResults[i]);
                }
            }
        }
        return results;
    }

    async getRecentItems(limit: number = 20): Promise<SearchResult[]> {
        try {
            return await this.searchEngine.getRecentItems(limit);
        } catch (error) {
            console.error('Failed to get recent items:', error);
            return [];
        }
    }

    getPlaceholder(scope: SearchScope): string {
        switch (scope) {
            case SearchScope.OPEN:
                return "Open Files: Try 'index.ts', 'styles.css', or 'README'...";
            case SearchScope.MODIFIED:
                return "Modified: Try 'app.ts', 'main.go', or 'config.json'...";
            case SearchScope.TYPES:
                return "Classes: Try 'UserService', 'IConfig', or 'AuthError'...";
            case SearchScope.SYMBOLS:
                return "Symbols: Try 'getUser', 'onInit', or 'MAX_RETRIES'...";
            case SearchScope.FILES:
                return "Files: Try 'app.ts', 'components/Button', or 'index.html'...";
            case SearchScope.TEXT:
                return "Text: Try 'async function', 'TODO:', or 'extends Component'...";
            case SearchScope.COMMANDS:
                return "Commands: Try 'format', 'settings', or 'restart'...";
            case SearchScope.PROPERTIES:
                return "Properties: Try 'length', 'name', or 'isActive'...";
            case SearchScope.ENDPOINTS:
                return "Endpoints: Try 'GET /api/users', '/auth/login', or 'POST'...";
            case SearchScope.EVERYTHING:
            default:
                return "Global: Try 'UserService', 'app.ts', 'GET /api', or '/t'...";
        }
    }

    createSearchResultItem(result: SearchResult): SearchResultItem {
        const { item } = result;
        const { iconPath, resourceUri } = this.getItemIcon(item);

        const label = item.name;
        let description = '';
        let detail = '';

        if (item.containerName) {
            description = item.containerName;
        }

        if (item.type === SearchItemType.FILE && this.isFileDirty(item.filePath)) {
            const indicator = '$(circle-filled)';
            description = description ? `${indicator} ${description} (Unsaved)` : `${indicator} Unsaved`;
        }

        if (item.type !== SearchItemType.COMMAND) {
            const relativePath = vscode.workspace.asRelativePath(item.filePath);
            if (item.line === undefined) {
                detail = relativePath;
            } else {
                detail = `${relativePath}:${item.line + 1}`;
            }

            if (item.detail) {
                description = description ? `${description} - ${item.detail}` : item.detail;
            }
        } else {
            detail = item.detail || '';
        }

        const buttons = this.getButtonsForItem(item);

        return {
            label,
            description,
            detail,
            iconPath,
            resourceUri,
            alwaysShow: true,
            result,
            buttons,
        };
    }

    private getButtonsForItem(item: SearchableItem): vscode.QuickInputButton[] {
        const buttons: vscode.QuickInputButton[] = [];

        if (!this.isInlineButtonAllowed(item.type)) {
            return buttons;
        }

        buttons.push({
            iconPath: new vscode.ThemeIcon('copy'),
            tooltip: 'Copy Path',
        });

        if (
            item.type === SearchItemType.CLASS ||
            item.type === SearchItemType.INTERFACE ||
            item.type === SearchItemType.ENUM ||
            item.type === SearchItemType.FUNCTION ||
            item.type === SearchItemType.METHOD ||
            item.type === SearchItemType.PROPERTY ||
            item.type === SearchItemType.VARIABLE
        ) {
            buttons.push({
                iconPath: new vscode.ThemeIcon('references'),
                tooltip: 'Copy Reference',
            });
        } else if (item.type === SearchItemType.FILE || item.type === SearchItemType.TEXT) {
            buttons.push({
                iconPath: new vscode.ThemeIcon('file-submodule'),
                tooltip: 'Copy Relative Path',
            });
        }

        buttons.push({
            iconPath: new vscode.ThemeIcon('split-horizontal'),
            tooltip: 'Open to the Side',
        });

        if (item.type === SearchItemType.FILE || item.type === SearchItemType.TEXT) {
            buttons.push({
                iconPath: new vscode.ThemeIcon('folder-opened'),
                tooltip: 'Reveal in File Explorer',
            });
        }

        return buttons;
    }

    private isFileDirty(filePath: string): boolean {
        const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath === filePath);
        return editor ? editor.document.isDirty : false;
    }

    private isInlineButtonAllowed(type: SearchItemType): boolean {
        return type !== SearchItemType.COMMAND;
    }

    private getItemIcon(item: SearchableItem): { iconPath: vscode.ThemeIcon | undefined; resourceUri?: vscode.Uri } {
        const iconId = this.getIconForItemType(item.type);
        const color = this.getIconColorForItemType(item.type);
        const iconPath = new vscode.ThemeIcon(iconId, color);

        let resourceUri: vscode.Uri | undefined = null;
        if (item.type === SearchItemType.FILE || item.type === SearchItemType.TEXT) {
            resourceUri = vscode.Uri.file(item.filePath);
        }

        return { iconPath, resourceUri };
    }

    private getIconForItemType(type: SearchItemType): string {
        switch (type) {
            case SearchItemType.CLASS:
                return 'symbol-class';
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
                return new vscode.ThemeColor('symbolIcon.interfaceForeground');
            default:
                return undefined;
        }
    }

    async navigateToFile(
        item: SearchableItem,
        viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active,
        preview: boolean = false,
        highlights?: number[][],
    ): Promise<void> {
        try {
            const uri = vscode.Uri.file(item.filePath);
            const document = await vscode.workspace.openTextDocument(uri);

            const position =
                item.line === undefined ? new vscode.Position(0, 0) : new vscode.Position(item.line, item.column || 0);

            let range: vscode.Range;
            if (item.type === SearchItemType.TEXT) {
                range = this.getTextSelectionRange(document, item, highlights, position);
            } else {
                range = this.getNonTextSelectionRange(document, item, highlights, position);
            }

            const editor = await vscode.window.showTextDocument(document, {
                selection: range,
                viewColumn,
                preview,
                preserveFocus: preview,
            });

            const decorationRanges =
                item.type !== SearchItemType.TEXT && highlights
                    ? this.getNonTextDecorationRanges(document, item, highlights)
                    : undefined;
            editor.setDecorations(this.matchDecorationType, decorationRanges ?? [range]);
        } catch (error) {
            if (!preview) {
                vscode.window.showErrorMessage(`Failed to open file: ${item.filePath}`);
            }
            console.error(`Navigation error for ${item.filePath}:`, error);
        }
    }

    recordActivity(item: SearchableItem, preview: boolean): void {
        if (!preview && this.config.isActivityTrackingEnabled()) {
            this.searchEngine.recordActivity(item.id);
            if (this.activityTracker) {
                this.activityTracker.recordAccess(item);
            }
        }
    }

    private getTextSelectionRange(
        document: vscode.TextDocument,
        item: SearchableItem,
        highlights: number[][] | undefined,
        position: vscode.Position,
    ): vscode.Range {
        if (item.line !== undefined && highlights && highlights.length > 0) {
            const textLine = document.lineAt(item.line);
            const lineText = textLine.text;
            const leadingWhitespace = lineText.length - lineText.trimStart().length;
            const firstHighlight = highlights[0];
            const highlightStart = firstHighlight[0];
            const highlightEnd = firstHighlight[1];
            const startColumn = Math.max(0, leadingWhitespace + highlightStart);
            const endColumn = Math.max(startColumn, leadingWhitespace + highlightEnd);
            const clampedStart = Math.min(startColumn, lineText.length);
            const clampedEnd = Math.min(endColumn, lineText.length);

            return new vscode.Range(
                new vscode.Position(item.line, clampedStart),
                new vscode.Position(item.line, clampedEnd),
            );
        }

        if (item.column !== undefined) {
            const length = highlights && highlights.length > 0 ? highlights[0][1] - highlights[0][0] : item.name.length;
            return new vscode.Range(
                new vscode.Position(item.line || 0, item.column),
                new vscode.Position(item.line || 0, item.column + length),
            );
        }

        return new vscode.Range(position, position.translate(0, item.name.length));
    }

    private getNonTextSelectionRange(
        document: vscode.TextDocument,
        item: SearchableItem,
        highlights: number[][] | undefined,
        position: vscode.Position,
    ): vscode.Range {
        if (item.line !== undefined) {
            const rangeFromLine = this.getSymbolRangeFromLine(document, item);
            if (rangeFromLine) {
                if (highlights && highlights.length > 0 && item.name) {
                    const textLine = document.lineAt(item.line);
                    const lineText = textLine.text;
                    const nameStartInLine = lineText.indexOf(item.name);
                    if (nameStartInLine >= 0) {
                        const firstHL = highlights[0];
                        const startCol = Math.min(nameStartInLine + firstHL[0], lineText.length);
                        const endCol = Math.min(nameStartInLine + firstHL[1], lineText.length);
                        return new vscode.Range(
                            new vscode.Position(item.line, startCol),
                            new vscode.Position(item.line, endCol),
                        );
                    }
                }
                return rangeFromLine;
            }
        }

        if (item.line !== undefined && item.column !== undefined) {
            return new vscode.Range(
                new vscode.Position(item.line, item.column),
                new vscode.Position(item.line, item.column + item.name.length),
            );
        }

        if (highlights && highlights.length > 0) {
            const firstHighlight = highlights[0];
            return new vscode.Range(
                new vscode.Position(item.line || 0, firstHighlight[0]),
                new vscode.Position(item.line || 0, firstHighlight[1]),
            );
        }

        return new vscode.Range(position, position.translate(0, item.name.length));
    }

    private getNonTextDecorationRanges(
        document: vscode.TextDocument,
        item: SearchableItem,
        highlights: number[][] | undefined,
    ): vscode.Range[] {
        if (!highlights || highlights.length === 0 || item.line === undefined || !item.name) {
            return [];
        }

        const textLine = document.lineAt(item.line);
        const lineText = textLine.text;
        const nameStartInLine = lineText.indexOf(item.name);
        if (nameStartInLine < 0) {
            return [];
        }

        const ranges: vscode.Range[] = [];
        for (const [hlStart, hlEnd] of highlights) {
            const startCol = Math.min(nameStartInLine + hlStart, lineText.length);
            const endCol = Math.min(nameStartInLine + hlEnd, lineText.length);
            if (startCol < endCol) {
                ranges.push(
                    new vscode.Range(new vscode.Position(item.line, startCol), new vscode.Position(item.line, endCol)),
                );
            }
        }
        return ranges;
    }

    private getSymbolRangeFromLine(document: vscode.TextDocument, item: SearchableItem): vscode.Range | undefined {
        if (item.line === undefined) {
            return undefined;
        }

        const textLine = document.lineAt(item.line);
        const lineText = textLine.text;
        const name = item.name || '';

        if (!name) {
            return undefined;
        }

        let index = lineText.indexOf(name);

        if (index < 0) {
            const trimmedName = name.trim();
            if (trimmedName.length > 0) {
                index = lineText.indexOf(trimmedName);
                if (index < 0) {
                    index = lineText.toLowerCase().indexOf(trimmedName.toLowerCase());
                }
            }
        }

        if (index < 0 && item.column !== undefined) {
            index = item.column;
        }

        if (index < 0) {
            return undefined;
        }

        const startColumn = Math.min(index, lineText.length);
        const endColumn = Math.min(startColumn + name.length, lineText.length);

        return new vscode.Range(new vscode.Position(item.line, startColumn), new vscode.Position(item.line, endColumn));
    }

    async clearHistory(): Promise<void> {
        try {
            await this.searchEngine.clearHistory();
        } catch (error) {
            console.error('Failed to clear history:', error);
        }
    }

    async removeHistoryItem(id: string): Promise<void> {
        try {
            await this.searchEngine.removeHistoryItem(id);
        } catch (error) {
            console.error('Failed to remove history item:', error);
        }
    }

    async getIndexStats(): Promise<IndexStats | undefined> {
        try {
            return await this.searchEngine.getIndexStats?.();
        } catch (error) {
            console.error('Failed to get index stats:', error);
            return undefined;
        }
    }
}
