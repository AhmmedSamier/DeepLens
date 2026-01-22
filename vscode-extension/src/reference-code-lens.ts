import * as vscode from 'vscode';

/**
 * Symbol kinds to show references for
 */
const SUPPORTED_SYMBOL_KINDS = [
    vscode.SymbolKind.Class,
    vscode.SymbolKind.Interface,
    vscode.SymbolKind.Function,
    vscode.SymbolKind.Method,
    vscode.SymbolKind.Enum,
    vscode.SymbolKind.Struct,
];

/**
 * CodeLens types
 */
enum CodeLensType {
    REFERENCE = 'reference',
    IMPLEMENTATION = 'implementation',
}

/**
 * CodeLens provider that shows reference and implementation counts above symbols
 * Similar to JetBrains Rider's "Code Vision" feature
 */
export class ReferenceCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    private enabled: boolean = true;
    private showImplementations: boolean = true;
    private minRefsToShow: number = 0;

    constructor() {
        this.reloadConfig();
    }

    /**
     * Reload configuration from settings
     */
    public reloadConfig(): void {
        const config = vscode.workspace.getConfiguration('deeplens');
        this.enabled = config.get<boolean>('codeLens.enabled', true);
        this.showImplementations = config.get<boolean>('codeLens.showImplementations', true);
        this.minRefsToShow = config.get<number>('codeLens.minRefsToShow', 0);
        this._onDidChangeCodeLenses.fire();
    }

    /**
     * Provide code lenses for the document
     */
    async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): Promise<vscode.CodeLens[]> {
        if (!this.enabled) {
            return [];
        }

        const codeLenses: vscode.CodeLens[] = [];

        try {
            // Get document symbols using VSCode's built-in provider
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                document.uri,
            );

            if (!symbols || token.isCancellationRequested) {
                return [];
            }

            // Check if we got DocumentSymbol[] (hierarchy) or SymbolInformation[] (flat)
            if (symbols.length > 0 && 'children' in symbols[0]) {
                this.collectSymbols(symbols as vscode.DocumentSymbol[], codeLenses, document);
            } else if (symbols.length > 0 && 'containerName' in symbols[0]) {
                // Handle flat SymbolInformation[]
                this.collectFlatSymbols(symbols as unknown as vscode.SymbolInformation[], codeLenses, document);
            }
        } catch (error) {
            console.error('[DeepLens] Error getting document symbols:', error);
        }

        return codeLenses;
    }

    /**
     * Recursively collect symbols from DocumentSymbol[] (Hierarchy)
     */
    private collectSymbols(
        symbols: vscode.DocumentSymbol[],
        codeLenses: vscode.CodeLens[],
        document: vscode.TextDocument,
        parentKind?: vscode.SymbolKind,
    ): void {
        for (const symbol of symbols) {
            this.createLensForSymbol(symbol, symbol.selectionRange.start, parentKind, document, codeLenses);

            if (symbol.children && symbol.children.length > 0) {
                this.collectSymbols(symbol.children, codeLenses, document, symbol.kind);
            }
        }
    }

    /**
     * Collect symbols from SymbolInformation[] (Flat)
     */
    private collectFlatSymbols(
        symbols: vscode.SymbolInformation[],
        codeLenses: vscode.CodeLens[],
        document: vscode.TextDocument,
    ): void {
        // Create a map for name -> kind lookups
        const kindMap = new Map<string, vscode.SymbolKind>();
        for (const sym of symbols) {
            kindMap.set(sym.name, sym.kind);
        }

        for (const symbol of symbols) {
            // Try to find parent kind via containerName
            let parentKind: vscode.SymbolKind | undefined;
            if (symbol.containerName) {
                parentKind = kindMap.get(symbol.containerName);
            }

            // SymbolInformation uses 'location.range.start' instead of 'selectionRange.start'
            this.createLensForSymbol(symbol, symbol.location.range.start, parentKind, document, codeLenses);
        }
    }

    private createLensForSymbol(
        symbol: { name: string; kind: vscode.SymbolKind },
        position: vscode.Position,
        parentKind: vscode.SymbolKind | undefined,
        document: vscode.TextDocument,
        codeLenses: vscode.CodeLens[],
    ) {
        if (!SUPPORTED_SYMBOL_KINDS.includes(symbol.kind)) {
            return;
        }

        const range = new vscode.Range(position, position);

        // 1. Reference Lens
        const refLens = new vscode.CodeLens(range, undefined);
        (refLens as CodeLensWithSymbol).symbolName = symbol.name;
        (refLens as CodeLensWithSymbol).symbolPosition = position;
        (refLens as CodeLensWithSymbol).symbolKind = symbol.kind;
        (refLens as CodeLensWithSymbol).parentKind = parentKind;
        (refLens as CodeLensWithSymbol).documentUri = document.uri;
        (refLens as CodeLensWithSymbol).type = CodeLensType.REFERENCE;
        codeLenses.push(refLens);

        // 2. Implementation Lens
        if (this.showImplementations && this.canHaveImplementations(symbol.kind)) {
            const implLens = new vscode.CodeLens(range, undefined);
            (implLens as CodeLensWithSymbol).symbolName = symbol.name;
            (implLens as CodeLensWithSymbol).symbolPosition = position;
            (implLens as CodeLensWithSymbol).symbolKind = symbol.kind;
            (implLens as CodeLensWithSymbol).parentKind = parentKind;
            (implLens as CodeLensWithSymbol).documentUri = document.uri;
            (implLens as CodeLensWithSymbol).type = CodeLensType.IMPLEMENTATION;
            codeLenses.push(implLens);
        }
    }

    private canHaveImplementations(kind: vscode.SymbolKind): boolean {
        return (
            kind === vscode.SymbolKind.Class ||
            kind === vscode.SymbolKind.Interface ||
            kind === vscode.SymbolKind.Method ||
            kind === vscode.SymbolKind.Function
        );
    }

    private isInterfaceOrAbstract(kind: vscode.SymbolKind | undefined, parentKind?: vscode.SymbolKind): boolean {
        return (
            kind === vscode.SymbolKind.Interface ||
            parentKind === vscode.SymbolKind.Interface ||
            kind === vscode.SymbolKind.Class // Abstract classes are still classes in SymbolKind
        );
    }

    /**
     * Resolve a code lens by fetching count
     */
    async resolveCodeLens(codeLens: vscode.CodeLens, token: vscode.CancellationToken): Promise<vscode.CodeLens | null> {
        const lens = codeLens as CodeLensWithSymbol;

        if (!lens.documentUri || !lens.symbolPosition || !lens.type) {
            return null;
        }

        try {
            const isReference = lens.type === CodeLensType.REFERENCE;
            const command = isReference ? 'vscode.executeReferenceProvider' : 'vscode.executeImplementationProvider';

            // Fetch locations using VSCode's built-in provider
            const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                command,
                lens.documentUri,
                lens.symbolPosition,
            );

            if (token.isCancellationRequested) {
                return null;
            }

            let finalLocations = locations || [];

            // Filter out the location that matches the symbol's own position (declaration/definition)
            finalLocations = (locations || []).filter((loc: vscode.Location | vscode.LocationLink) => {
                // Handle both Location and LocationLink (which uses targetUri/targetRange)
                const uri = (loc as vscode.Location).uri || (loc as vscode.LocationLink).targetUri;
                const range = (loc as vscode.Location).range || (loc as vscode.LocationLink).targetSelectionRange;

                if (!uri || !range) {
                    return true;
                }

                const isSameFile = uri.toString() === lens.documentUri?.toString();
                return !(isSameFile && range.contains(lens.symbolPosition!));
            });

            const count = finalLocations.length;

            // Check minimum refs threshold (only for references)
            if (isReference && count < this.minRefsToShow) {
                return null;
            }

            // For implementations, if count is 0, we can choose to hide it or keep it
            // Based on user screenshots, they want to see "no implementations" if it's an interface
            // but we should hide it for simple classes that don't have implementations elsewhere.
            const isInterfaceOrAbstract = this.isInterfaceOrAbstract(lens.symbolKind, lens.parentKind);
            const shouldHideImpl = !isReference && count === 0 && !isInterfaceOrAbstract;

            if (shouldHideImpl) {
                return null;
            }

            // Format display text with Rider-style shortcut labels
            const title = this.formatLensText(count, lens.type);

            // Convert any LocationLinks to standard Locations for the command arguments
            // The built-in commands (peekImplementation, showReferences) expect Location objects
            const commandLocations = finalLocations.map((loc: vscode.Location | vscode.LocationLink) => {
                // If it's a LocationLink (has targetUri), convert it
                if ((loc as vscode.LocationLink).targetUri) {
                    const link = loc as vscode.LocationLink;
                    return new vscode.Location(link.targetUri, link.targetSelectionRange || link.targetRange);
                }
                return loc as vscode.Location;
            });

            codeLens.command = {
                title,
                command: isReference ? 'editor.action.showReferences' : 'editor.action.peekImplementation',
                arguments: [lens.documentUri, lens.symbolPosition, commandLocations],
                tooltip: `Show all ${isReference ? 'references' : 'implementations'} to ${lens.symbolName}`,
            };
        } catch (error) {
            console.error(`[DeepLens] Error resolving ${lens.type} for ${lens.symbolName}:`, error);
            // Hide the lens entirely if the provider fails
            return null;
        }

        return codeLens;
    }

    /**
     * Format count as display text with shortcuts
     */
    private formatLensText(count: number, type: CodeLensType): string {
        const isRef = type === CodeLensType.REFERENCE;
        const label = isRef ? 'reference' : 'implementation';
        const plural = count === 1 ? label : `${label}s`;
        const shortcut = isRef ? 'Shift+F12' : 'Ctrl+F12';

        if (count === 0) {
            return `no ${plural} (${shortcut})`;
        }
        return `${count} ${plural} (${shortcut})`;
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this._onDidChangeCodeLenses.dispose();
    }
}

/**
 * Extended CodeLens with symbol info for resolving
 */
interface CodeLensWithSymbol extends vscode.CodeLens {
    symbolName?: string;
    symbolPosition?: vscode.Position;
    symbolKind?: vscode.SymbolKind;
    parentKind?: vscode.SymbolKind;
    documentUri?: vscode.Uri;
    type?: CodeLensType;
}
