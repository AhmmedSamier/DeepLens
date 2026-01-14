import * as vscode from 'vscode';
import { SearchItemType } from '../core/types';
import { WorkspaceIndexer } from '../workspace-indexer';

export class DeepLensImplementationProvider implements vscode.ImplementationProvider {
    constructor(private workspaceIndexer: WorkspaceIndexer) {}

    async provideImplementation(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Location[]> {
        const range = document.getWordRangeAtPosition(position);
        if (!range) return [];

        const symbolName = document.getText(range);
        if (!symbolName) return [];

        const items = this.workspaceIndexer.getItems();
        const locations: vscode.Location[] = [];

        for (const item of items) {
            if (token.isCancellationRequested) break;

            // Strategy 1: Find Classes/Interfaces that implement the symbol (if symbol is a Type)
            if (item.implements) {
                const matches = item.implements.some((impl) => {
                    // Remove generic type arguments: "List<T>" -> "List"
                    const simpleName = impl.split('<')[0].trim();
                    // Remove namespace: "System.Collections.IEnumerable" -> "IEnumerable"
                    const shortName = simpleName.split('.').pop() || simpleName;

                    return shortName === symbolName;
                });

                if (matches) {
                    locations.push(
                        new vscode.Location(
                            vscode.Uri.file(item.filePath),
                            new vscode.Position(item.line || 0, item.column || 0)
                        )
                    );
                    // Continue to next item, as this item matched as a Type implementation
                    continue;
                }
            }

            // Strategy 2: Find Methods/Functions matching the name (if symbol is a Method call)
            // This acts as a "Go to Implementation" for methods by finding all methods with the same name.
            if (
                (item.type === SearchItemType.METHOD || item.type === SearchItemType.FUNCTION) &&
                item.name === symbolName
            ) {
                locations.push(
                    new vscode.Location(
                        vscode.Uri.file(item.filePath),
                        new vscode.Position(item.line || 0, item.column || 0)
                    )
                );
            }
        }

        return locations;
    }
}
