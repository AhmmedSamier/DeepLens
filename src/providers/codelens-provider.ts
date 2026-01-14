import * as vscode from 'vscode';
import { TreeSitterParser } from '../core/tree-sitter-parser';
import { SearchItemType } from '../core/types';

class DeepLensCodeLens extends vscode.CodeLens {
    constructor(
        range: vscode.Range,
        public documentUri: vscode.Uri
    ) {
        super(range);
    }
}

export class DeepLensCodeLensProvider implements vscode.CodeLensProvider {
    constructor(private parser: TreeSitterParser) {}

    async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> {
        // Parse the file to get symbols
        const items = await this.parser.parseFile(document.uri);
        const lenses: vscode.CodeLens[] = [];

        for (const item of items) {
            if (token.isCancellationRequested) break;

            // Show CodeLens for definitions
            if (
                item.type === SearchItemType.CLASS ||
                item.type === SearchItemType.INTERFACE ||
                item.type === SearchItemType.METHOD ||
                item.type === SearchItemType.FUNCTION ||
                item.type === SearchItemType.ENDPOINT
            ) {
                const range = new vscode.Range(
                    item.line || 0,
                    item.column || 0,
                    item.line || 0,
                    (item.column || 0) + item.name.length
                );

                lenses.push(new DeepLensCodeLens(range, document.uri));
            }
        }
        return lenses;
    }

    async resolveCodeLens(
        codeLens: vscode.CodeLens,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens> {
        if (codeLens instanceof DeepLensCodeLens) {
            try {
                // Execute reference provider to get count
                const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                    'vscode.executeReferenceProvider',
                    codeLens.documentUri,
                    codeLens.range.start
                );

                const count = locations ? locations.length : 0;

                codeLens.command = {
                    title: count === 1 ? '1 reference' : `${count} references`,
                    tooltip: 'Show all references',
                    command: count > 0 ? 'editor.action.showReferences' : '',
                    arguments: count > 0 ? [codeLens.documentUri, codeLens.range.start, locations] : []
                };
            } catch (e) {
                console.error('Failed to resolve CodeLens:', e);
                codeLens.command = {
                    title: '0 references',
                    command: ''
                };
            }
        }
        return codeLens;
    }
}
