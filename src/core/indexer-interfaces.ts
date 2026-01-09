/**
 * Lean version of VS Code symbol types to avoid dependency on vscode namespace
 */
export interface LeanSymbolInformation {
    name: string;
    kind: number;
    location: {
        uri: string;
        range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
        };
    };
    containerName?: string;
}

export interface LeanDocumentSymbol {
    name: string;
    detail: string;
    kind: number;
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    selectionRange: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    children: LeanDocumentSymbol[];
}

/**
 * Interface for the environment-specific functionality needed by the indexer
 */
export interface IndexerEnvironment {
    getWorkspaceFolders(): string[];
    findFiles(include: string, exclude: string): Promise<string[]>;
    asRelativePath(filePath: string): string;
    log(message: string): void;

    // For falling back to editor-provided symbols (optional)
    executeDocumentSymbolProvider?(filePath: string): Promise<LeanDocumentSymbol[]>;
    executeWorkspaceSymbolProvider?(): Promise<LeanSymbolInformation[]>;

    // For file watching
    createFileSystemWatcher?(pattern: string, onEvent: (path: string, type: 'create' | 'change' | 'delete') => void): { dispose(): void };
}
