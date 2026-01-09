import * as vscode from 'vscode';
import { IndexerEnvironment, LeanDocumentSymbol, LeanSymbolInformation } from './core/indexer-interfaces';

export class VsCodeIndexerEnvironment implements IndexerEnvironment {
    private logger: vscode.OutputChannel;

    constructor() {
        this.logger = vscode.window.createOutputChannel('DeepLens (Indexer)');
    }

    getWorkspaceFolders(): string[] {
        return vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) || [];
    }

    async findFiles(include: string, exclude: string): Promise<string[]> {
        const files = await vscode.workspace.findFiles(include, exclude);
        return files.map(f => f.fsPath);
    }

    asRelativePath(filePath: string): string {
        return vscode.workspace.asRelativePath(filePath);
    }

    log(message: string): void {
        this.logger.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
    }

    async executeDocumentSymbolProvider(filePath: string): Promise<LeanDocumentSymbol[]> {
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            vscode.Uri.file(filePath)
        );

        if (!symbols) return [];
        return this.mapDocumentSymbols(symbols);
    }

    async executeWorkspaceSymbolProvider(): Promise<LeanSymbolInformation[]> {
        const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
            'vscode.executeWorkspaceSymbolProvider',
            ''
        );

        if (!symbols) return [];
        return symbols.map(s => ({
            name: s.name,
            kind: s.kind,
            location: {
                uri: s.location.uri.fsPath,
                range: {
                    start: { line: s.location.range.start.line, character: s.location.range.start.character },
                    end: { line: s.location.range.end.line, character: s.location.range.end.character }
                }
            },
            containerName: s.containerName
        }));
    }

    createFileSystemWatcher(pattern: string, onEvent: (path: string, type: 'create' | 'change' | 'delete') => void): { dispose(): void } {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);

        const d1 = watcher.onDidCreate(uri => onEvent(uri.fsPath, 'create'));
        const d2 = watcher.onDidChange(uri => onEvent(uri.fsPath, 'change'));
        const d3 = watcher.onDidDelete(uri => onEvent(uri.fsPath, 'delete'));

        return {
            dispose: () => {
                d1.dispose();
                d2.dispose();
                d3.dispose();
                watcher.dispose();
            }
        };
    }

    private mapDocumentSymbols(symbols: vscode.DocumentSymbol[]): LeanDocumentSymbol[] {
        return symbols.map(s => ({
            name: s.name,
            detail: s.detail,
            kind: s.kind,
            range: {
                start: { line: s.range.start.line, character: s.range.start.character },
                end: { line: s.range.end.line, character: s.range.end.character }
            },
            selectionRange: {
                start: { line: s.selectionRange.start.line, character: s.selectionRange.start.character },
                end: { line: s.selectionRange.end.line, character: s.selectionRange.end.character }
            },
            children: s.children ? this.mapDocumentSymbols(s.children) : []
        }));
    }
}
