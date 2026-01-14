import * as vscode from 'vscode';
import { Config } from '../config';
import { TreeSitterParser } from '../core/tree-sitter-parser';

export class DeepLensReferenceProvider implements vscode.ReferenceProvider {
    constructor(private parser: TreeSitterParser, private config: Config) {}

    async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken
    ): Promise<vscode.Location[]> {
        const range = document.getWordRangeAtPosition(position);
        if (!range) return [];

        const symbolName = document.getText(range);
        if (!symbolName) return [];

        const locations: vscode.Location[] = [];
        const fileExtensions = this.config.getFileExtensions();
        if (fileExtensions.length === 0) return [];

        const includePattern = `**/*.{${fileExtensions.join(',')}}`;
        const excludePatterns = this.config.getExcludePatterns();
        const excludePattern = excludePatterns.length > 0 ? `{${excludePatterns.join(',')}}` : undefined;

        await vscode.workspace.findTextInFiles(
            {
                pattern: symbolName,
                isCaseSensitive: true,
                isWordMatch: true
            },
            {
                include: includePattern,
                exclude: excludePattern
            },
            (result) => {
                if ('uri' in result) {
                     // TextSearchMatch
                    for (const r of result.ranges) {
                        locations.push(new vscode.Location(result.uri, r));
                    }
                }
            },
            token
        );

        return locations;
    }
}
