import * as path from 'node:path';
import * as vscode from 'vscode';
import { ActivityTracker } from '../../language-server/src/core/activity-tracker';
import { Config } from '../../language-server/src/core/config';
import { SearchItemType, SearchableItem } from '../../language-server/src/core/types';
import { CommandIndexer } from './command-indexer';
import { DeepLensLspClient } from './lsp-client';
import { ReferenceCodeLensProvider } from './reference-code-lens';
import { SearchProvider } from './search-provider';
import { GitService } from './services/git-service';
import { logger } from './services/logging-service';

let lspClient: DeepLensLspClient;
let searchProvider: SearchProvider;
let config: Config;
let activityTracker: ActivityTracker;
let commandIndexer: CommandIndexer;
let gitService: GitService;

const CALL_CHAIN_DEPTH = 4;

interface CallNode {
    readonly item: vscode.CallHierarchyItem;
    readonly callSite: vscode.Range;
    readonly children: CallNode[];
}

interface RefCallNode {
    readonly name: string;
    readonly uri: vscode.Uri;
    readonly range: vscode.Range;
    readonly selectionRange: vscode.Range;
    readonly callSite: vscode.Range;
    readonly children: RefCallNode[];
}

type SymbolInfo = vscode.DocumentSymbol | vscode.SymbolInformation;

async function buildIncomingCallTree(
    item: vscode.CallHierarchyItem,
    depth: number,
    visited: Set<string>,
    callSite?: vscode.Range,
): Promise<CallNode> {
    const effectiveCallSite = callSite || item.selectionRange;

    if (depth <= 0) {
        return { item, callSite: effectiveCallSite, children: [] };
    }

    const key = `${item.uri.toString()}:${item.range.start.line}:${item.range.start.character}:${item.name}`;
    if (visited.has(key)) {
        return { item, callSite: effectiveCallSite, children: [] };
    }

    visited.add(key);

    const incoming =
        (await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
            'vscode.provideIncomingCalls',
            item,
        )) || [];

    const expandedEntries: Array<{ entry: vscode.CallHierarchyIncomingCall; callSite: vscode.Range }> = [];

    for (const entry of incoming) {
        if (entry.fromRanges.length === 0) {
            expandedEntries.push({ entry, callSite: entry.from.selectionRange });
        } else {
            for (const callSite of entry.fromRanges) {
                expandedEntries.push({ entry, callSite });
            }
        }
    }

    const children = await Promise.all(
        expandedEntries.map(async ({ entry, callSite }) => {
            return buildIncomingCallTree(entry.from, depth - 1, new Set(visited), callSite);
        }),
    );

    visited.delete(key);
    return { item, callSite: effectiveCallSite, children };
}

function buildSymbolMap(uri: vscode.Uri, symbols: SymbolInfo[] | null): Map<string, SymbolInfo> {
    const symbolMap = new Map<string, SymbolInfo>();

    if (!symbols) {
        return symbolMap;
    }

    const collectSymbols = (syms: SymbolInfo[]) => {
        for (const sym of syms) {
            const range = 'selectionRange' in sym ? sym.selectionRange : sym.location.range;
            const key = `${uri.toString()}:${range.start.line}:${range.start.character}`;
            symbolMap.set(key, sym);
            if ('children' in sym && sym.children) {
                collectSymbols(sym.children as vscode.DocumentSymbol[]);
            }
        }
    };

    collectSymbols(symbols);
    return symbolMap;
}

async function buildCallTreeFromReferences(
    uri: vscode.Uri,
    position: vscode.Position,
    depth: number,
    visited: Set<string>,
): Promise<RefCallNode | null> {
    if (depth <= 0) {
        return null;
    }

    const references =
        (await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', uri, position)) ||
        [];

    if (references.length === 0) {
        return null;
    }

    const symbols = await vscode.commands.executeCommand<SymbolInfo[]>('vscode.executeDocumentSymbolProvider', uri);

    const symbolMap = buildSymbolMap(uri, symbols);

    const rootSymbol = findEnclosingSymbol(position, symbolMap);

    let rootRange: vscode.Range;
    let rootName: string;

    if (!rootSymbol) {
        rootRange = new vscode.Range(position, position);
        rootName = `call at line ${position.line + 1}`;
    } else {
        rootRange = 'selectionRange' in rootSymbol ? rootSymbol.selectionRange : rootSymbol.location.range;
        rootName = rootSymbol.name;
    }

    const callers = await findAllCallers(references, uri, symbols, rootRange);

    const children: RefCallNode[] = [];
    for (const [, caller] of callers) {
        const key = `${caller.uri.toString()}:${caller.selectionRange.start.line}:${caller.selectionRange.start.character}:${caller.name}`;
        if (visited.has(key)) {
            continue;
        }
        visited.add(key);

        const grandChildren =
            depth > 1
                ? await buildCallerChildrenForCaller(caller.uri, caller.selectionRange.start, depth - 1, visited)
                : [];
        children.push({
            name: caller.name,
            uri: caller.uri,
            range: caller.range,
            selectionRange: caller.selectionRange,
            callSite: caller.callSite,
            children: grandChildren,
        });
        visited.delete(key);
    }

    return {
        name: rootName,
        uri,
        range: rootRange,
        selectionRange: rootRange,
        callSite: rootRange,
        children,
    };
}

async function loadReferenceDocuments(references: vscode.Location[]): Promise<Map<string, vscode.TextDocument>> {
    const refUriStrings = [...new Set(references.map((r) => r.uri.toString()))];
    const textDocuments = new Map<string, vscode.TextDocument>();

    for (const uriStr of refUriStrings) {
        const refUri = references.find((r) => r.uri.toString() === uriStr)?.uri;
        if (refUri) {
            try {
                const doc = await vscode.workspace.openTextDocument(refUri);
                textDocuments.set(uriStr, doc);
            } catch (e) {
                logger.error(`Failed to open document ${refUri}: ${e}`);
            }
        }
    }

    return textDocuments;
}

function processReference(
    ref: vscode.Location,
    textDocuments: Map<string, vscode.TextDocument>,
    rootUri: vscode.Uri,
    rootRange: vscode.Range,
): {
    key: string;
    value: { name: string; uri: vscode.Uri; range: vscode.Range; selectionRange: vscode.Range; callSite: vscode.Range };
} | null {
    const refUriStr = ref.uri.toString();

    if (refUriStr === rootUri.toString() && ref.range.isEqual(rootRange)) {
        return null;
    }

    let methodName = `call at line ${ref.range.start.line + 1}`;
    let methodStartPos = ref.range.start;
    const doc = textDocuments.get(refUriStr);
    if (doc) {
        const enclosingMethod = findEnclosingMethodInfo(doc, ref.range.start);
        if (enclosingMethod) {
            methodName = enclosingMethod.name;
            methodStartPos = enclosingMethod.startPosition;
        }
    }

    const key = `${refUriStr}:${methodStartPos.line}:${methodStartPos.character}`;
    return {
        key,
        value: {
            name: methodName,
            uri: ref.uri,
            range: new vscode.Range(methodStartPos, methodStartPos),
            selectionRange: new vscode.Range(methodStartPos, methodStartPos),
            callSite: ref.range,
        },
    };
}

async function findAllCallers(
    references: vscode.Location[],
    rootUri: vscode.Uri,
    rootSymbols: SymbolInfo[] | null,
    rootRange: vscode.Range,
): Promise<
    Map<
        string,
        { name: string; uri: vscode.Uri; range: vscode.Range; selectionRange: vscode.Range; callSite: vscode.Range }
    >
> {
    const callerMap = new Map<
        string,
        { name: string; uri: vscode.Uri; range: vscode.Range; selectionRange: vscode.Range; callSite: vscode.Range }
    >();

    const textDocuments = await loadReferenceDocuments(references);

    for (const ref of references) {
        const result = processReference(ref, textDocuments, rootUri, rootRange);
        if (result && !callerMap.has(result.key)) {
            callerMap.set(result.key, result.value);
        }
    }

    return callerMap;
}

function shouldSkipLine(lineText: string): boolean {
    return lineText === '' || lineText === '{' || lineText === '}';
}

function isCommentLine(lineText: string): boolean {
    return lineText.startsWith('//') || lineText.startsWith('/*') || lineText.startsWith('*');
}

function isDeclarationBoundary(lineText: string): boolean {
    return lineText.includes('class ') || lineText.includes('interface ') || lineText.includes('namespace ');
}

function matchMethodPattern(lineText: string): RegExpExecArray | null {
    // These patterns are used to detect C# method signatures.
    // They are intentionally complex to match various C# method declaration styles.
    /* eslint-disable sonarjs/slow-regex, sonarjs/regex-complexity */
    const standardMethodPattern =
        /(?:public|private|protected|internal|static|virtual|override|async|abstract|partial|readonly|extern|new|sealed)\s+(?:async\s+)?(?:void|int|string|bool|Task|List<[^>]+>|IEnumerable<[^>]+>|IList<[^>]+>|Dictionary<[^,]+,[^>]+>|var|[\w<>[\],\s]+\??)\s+(\w+)\s*\(/;
    const genericMethodPattern =
        /(?:public|private|protected|internal|static|virtual|override|async|abstract|partial)\s+(\w+)\s*<[^>]+>\s*\(/;
    const simplifiedPattern = /(\w+)\s*<[^>]+>\s*\([^)]*\)\s*\{/;
    /* eslint-enable sonarjs/slow-regex, sonarjs/regex-complexity */

    const methodPatterns = [standardMethodPattern, genericMethodPattern, simplifiedPattern];

    for (const pattern of methodPatterns) {
        const match = pattern.exec(lineText);
        if (match) {
            return match;
        }
    }
    return null;
}

function findEnclosingMethodInfo(
    doc: vscode.TextDocument,
    position: vscode.Position,
): { name: string; startPosition: vscode.Position } | null {
    const lineNum = position.line;

    for (let i = lineNum; i >= 0; i--) {
        const line = doc.lineAt(i);
        const lineText = line.text.trim();

        if (shouldSkipLine(lineText)) {
            continue;
        }

        const match = matchMethodPattern(lineText);
        if (match) {
            return { name: match[1], startPosition: new vscode.Position(i, 0) };
        }

        if (isCommentLine(lineText)) {
            continue;
        }

        if (isDeclarationBoundary(lineText)) {
            break;
        }
    }

    return null;
}

async function buildCallerChildrenForCaller(
    uri: vscode.Uri,
    position: vscode.Position,
    depth: number,
    visited: Set<string>,
): Promise<RefCallNode[]> {
    if (depth <= 0) {
        return [];
    }

    const references =
        (await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', uri, position)) ||
        [];

    if (references.length === 0) {
        return [];
    }

    const symbols = await vscode.commands.executeCommand<SymbolInfo[]>('vscode.executeDocumentSymbolProvider', uri);

    const rootRange = new vscode.Range(position, position);
    const callers = await findAllCallers(references, uri, symbols, rootRange);

    const children: RefCallNode[] = [];
    const seenInThisBranch = new Set<string>();

    for (const [, caller] of callers) {
        const key = `${caller.uri.toString()}:${caller.selectionRange.start.line}:${caller.selectionRange.start.character}:${caller.name}`;
        if (seenInThisBranch.has(key)) {
            continue;
        }
        seenInThisBranch.add(key);

        if (visited.has(key)) {
            continue;
        }
        visited.add(key);

        const grandChildren = await buildCallerChildrenForCaller(
            caller.uri,
            caller.selectionRange.start,
            depth - 1,
            visited,
        );
        children.push({
            name: caller.name,
            uri: caller.uri,
            range: caller.range,
            selectionRange: caller.selectionRange,
            callSite: caller.callSite,
            children: grandChildren,
        });
        visited.delete(key);
    }

    return children;
}

function findEnclosingSymbol(
    position: vscode.Position,
    symbolMap: Map<string, vscode.DocumentSymbol | vscode.SymbolInformation>,
): vscode.DocumentSymbol | vscode.SymbolInformation | null {
    let enclosing: vscode.DocumentSymbol | vscode.SymbolInformation | null = null;

    for (const [, symbol] of symbolMap) {
        const range = 'selectionRange' in symbol ? symbol.selectionRange : symbol.location.range;
        if (range.contains(position)) {
            if (
                !enclosing ||
                range.contains('selectionRange' in enclosing ? enclosing.selectionRange : enclosing.location.range)
            ) {
                enclosing = symbol;
            }
        }
    }

    return enclosing;
}

// escapeHtml is used when rendering CallHierarchyItem data in the call-chain webview.
// Inputs originate from language-server-provided symbol names and file paths, and output stays
// inside this extension-owned webview, so a minimal five-character replacement is sufficient.
// ⚡ Bolt: Fast string escaping optimization
// Using charCodeAt and slice avoids multiple engine passes and string allocations
// caused by chained .replaceAll() calls. This is roughly ~4x faster for short strings.
function escapeHtml(value: string): string {
    let res = '';
    let last = 0;
    const len = value.length;
    for (let i = 0; i < len; i++) {
        const charCode = value.charCodeAt(i);
        if (charCode === 38) {
            // &
            res += value.slice(last, i) + '&amp;';
            last = i + 1;
        } else if (charCode === 60) {
            // <
            res += value.slice(last, i) + '&lt;';
            last = i + 1;
        } else if (charCode === 62) {
            // >
            res += value.slice(last, i) + '&gt;';
            last = i + 1;
        } else if (charCode === 34) {
            // "
            res += value.slice(last, i) + '&quot;';
            last = i + 1;
        } else if (charCode === 39) {
            // '
            res += value.slice(last, i) + '&#39;';
            last = i + 1;
        }
    }
    if (last === 0) {
        return value;
    }
    return res + value.slice(last);
}

function renderCallTree(node: CallNode, level: number): string {
    const relativePath = vscode.workspace.asRelativePath(node.item.uri, false);
    const callLine = node.callSite.start.line + 1;
    const location = `${relativePath}:${callLine}`;
    const payload = encodeURIComponent(
        JSON.stringify({
            uri: node.item.uri.toString(),
            line: node.callSite.start.line,
            character: node.callSite.start.character,
        }),
    );
    const childrenMarkup = node.children.map((child) => renderCallTree(child, level + 1)).join('');

    return `
        <li>
            <button class="node level-${level}" data-location="${payload}" aria-label="Navigate to ${escapeHtml(node.item.name)} at ${escapeHtml(location)}">
                <span class="name">${escapeHtml(node.item.name)}</span>
                <span class="meta">${escapeHtml(location)}</span>
            </button>
            ${childrenMarkup.length > 0 ? `<ul>${childrenMarkup}</ul>` : ''}
        </li>
    `;
}

function renderRefCallTree(node: RefCallNode, level: number): string {
    const relativePath = vscode.workspace.asRelativePath(node.uri, false);
    const location = `${relativePath}:${node.selectionRange.start.line + 1}`;
    const payload = encodeURIComponent(
        JSON.stringify({
            uri: node.uri.toString(),
            line: node.callSite.start.line,
            character: node.callSite.start.character,
        }),
    );
    const childrenMarkup = node.children.map((child) => renderRefCallTree(child, level + 1)).join('');

    return `
        <li>
            <button class="node level-${level}" data-location="${payload}" aria-label="Navigate to ${escapeHtml(node.name)} at ${escapeHtml(location)}">
                <span class="name">${escapeHtml(node.name)}</span>
                <span class="meta">${escapeHtml(location)}</span>
            </button>
            ${childrenMarkup.length > 0 ? `<ul>${childrenMarkup}</ul>` : ''}
        </li>
    `;
}

async function showCallChain(uri: vscode.Uri, position: vscode.Position, symbolName?: string): Promise<void> {
    try {
        const roots =
            (await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
                'vscode.prepareCallHierarchy',
                uri,
                position,
            )) || [];

        let treeMarkup: string;
        let title: string;
        let useRefFallback = false;

        if (roots.length === 0) {
            useRefFallback = true;
        }

        let refTree: RefCallNode | null = null;
        if (useRefFallback) {
            refTree = await buildCallTreeFromReferences(uri, position, CALL_CHAIN_DEPTH, new Set<string>());
            if (!refTree) {
                vscode.window.showInformationMessage(
                    'DeepLens: No call hierarchy information is available for this symbol.',
                );
                return;
            }
            treeMarkup = `<ul class="tree">${renderRefCallTree(refTree, 0)}</ul>`;
            title = symbolName || refTree.name || 'Call Chain';
        } else {
            const root = roots[0];
            const tree = await buildIncomingCallTree(root, CALL_CHAIN_DEPTH, new Set<string>());
            treeMarkup = `<ul class="tree">${renderCallTree(tree, 0)}</ul>`;
            title = symbolName || root.name;
        }

        const panel = vscode.window.createWebviewPanel(
            'deeplensCallChain',
            `DeepLens Call Chain: ${title}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
            },
        );

        panel.webview.html = `
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Call Chain</title>
                <style>
                    body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); padding: 12px; }
                    .header { margin-bottom: 12px; }
                    .tree, .tree ul { list-style: none; padding-left: 14px; margin: 0; }
                    .tree li { margin: 4px 0; position: relative; }
                    .tree li::before {
                        content: '';
                        position: absolute;
                        left: -14px;
                        top: 0;
                        bottom: 0;
                        width: 1px;
                        background: var(--vscode-editorLineNumber-foreground);
                        opacity: 0.3;
                    }
                    .tree li:last-child::before {
                        height: 12px;
                    }
                    .tree li::after {
                        content: '';
                        position: absolute;
                        left: -14px;
                        top: 12px;
                        width: 10px;
                        height: 1px;
                        background: var(--vscode-editorLineNumber-foreground);
                        opacity: 0.3;
                    }
                    .tree > li::before, .tree > li::after { display: none; }
                    .node { width: 100%; text-align: left; border: 1px solid transparent; background: transparent; color: inherit; cursor: pointer; border-radius: 4px; padding: 4px 6px; display: flex; justify-content: space-between; gap: 8px; position: relative; z-index: 1; }
                    .node:hover { background: var(--vscode-list-hoverBackground); border-color: var(--vscode-list-hoverBackground); }
                    .node:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; background: var(--vscode-list-hoverBackground); border-color: var(--vscode-list-hoverBackground); }
                    .name { font-weight: 600; }
                    .meta { opacity: 0.8; font-family: var(--vscode-editor-font-family); }
                </style>
            </head>
            <body>
                <div class="header">
                    <h2>Call Chain: ${escapeHtml(title)}</h2>
                    <p>Incoming call chain (depth ${CALL_CHAIN_DEPTH}). ${useRefFallback ? 'Built from references (call hierarchy not available for this language).' : ''} Click any node to navigate.</p>
                </div>
                ${treeMarkup}
                <script>
                    const vscodeApi = acquireVsCodeApi();
                    document.querySelectorAll('.node').forEach((node) => {
                        node.addEventListener('click', () => {
                            const location = node.getAttribute('data-location');
                            vscodeApi.postMessage({ type: 'navigate', location });
                        });
                    });
                </script>
            </body>
        </html>
    `;

        panel.webview.onDidReceiveMessage(async (message) => {
            if (message.type !== 'navigate' || typeof message.location !== 'string') {
                return;
            }

            try {
                const parsed = JSON.parse(decodeURIComponent(message.location)) as {
                    uri: string;
                    line: number;
                    character: number;
                };
                const targetUri = vscode.Uri.parse(parsed.uri);
                const pos = new vscode.Position(parsed.line, parsed.character);
                const doc = await vscode.workspace.openTextDocument(targetUri);
                await vscode.window.showTextDocument(doc, {
                    viewColumn: vscode.ViewColumn.One,
                    preserveFocus: false,
                    selection: new vscode.Range(pos, pos),
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`Failed to navigate from call chain webview: ${message}`);
                return;
            }
        });
    } catch (err) {
        vscode.window.showErrorMessage('DeepLens: Failed to show call chain.');
        console.error('showCallChain error', err);
        return;
    }
}

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext) {
    logger.log('DeepLens extension is now active');

    // Initialize
    config = new Config(vscode.workspace.getConfiguration('deeplens'));

    // Start LSP Client
    lspClient = new DeepLensLspClient(context);
    try {
        await lspClient.start();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to start DeepLens language server: ${message}`);
        vscode.window.showErrorMessage('DeepLens: Failed to start language server. Check the output log for details.');
        return;
    }

    // Command Indexer still runs locally for VS Code commands
    commandIndexer = new CommandIndexer(config);
    activityTracker = new ActivityTracker(context);

    // UI remains local
    searchProvider = new SearchProvider(lspClient, config, activityTracker, commandIndexer);

    // T013: Listen for ripgrep unavailability
    context.subscriptions.push(
        lspClient.onRipgrepUnavailable.event(() => {
            searchProvider.disableTextSearch();
            vscode.window
                .showWarningMessage('DeepLens: Ripgrep is unavailable. Text search is disabled.', 'Open Settings')
                .then((val) => {
                    if (val === 'Open Settings') {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'deeplens.ripgrep');
                    }
                });
        }),
    );

    const updateActiveFiles = () => {
        const activeFiles: string[] = [];

        // Use tabGroups to get files actually open in tabs (more accurate than textDocuments)
        if (vscode.window.tabGroups) {
            for (const group of vscode.window.tabGroups.all) {
                for (const tab of group.tabs) {
                    if (tab.input instanceof vscode.TabInputText) {
                        activeFiles.push(tab.input.uri.fsPath);
                    }
                }
            }
        } else {
            // Fallback for older VS Code versions
            const docs = vscode.workspace.textDocuments
                .filter((doc) => doc.uri.scheme === 'file')
                .map((doc) => doc.uri.fsPath);
            activeFiles.push(...docs);
        }

        const activeEditorPath = vscode.window.activeTextEditor?.document.uri;
        if (activeEditorPath?.scheme === 'file' && !activeFiles.includes(activeEditorPath.fsPath)) {
            activeFiles.push(activeEditorPath.fsPath);
        }

        // Deduplicate
        const uniqueFiles = Array.from(new Set(activeFiles));
        lspClient.setActiveFiles(uniqueFiles);
    };

    updateActiveFiles();
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(updateActiveFiles),
        vscode.workspace.onDidCloseTextDocument(updateActiveFiles),
        vscode.window.onDidChangeActiveTextEditor(updateActiveFiles),
    );

    if (vscode.window.tabGroups != undefined) {
        context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(updateActiveFiles));
    }

    // Register search command
    const searchCommand = vscode.commands.registerCommand('deeplens.search', async () => {
        const editor = vscode.window.activeTextEditor;
        let initialQuery: string | undefined;

        if (editor && !editor.selection.isEmpty) {
            initialQuery = editor.document.getText(editor.selection);
        }

        await searchProvider.show(undefined, initialQuery);
    });

    // Register rebuild index command
    const rebuildCommand = vscode.commands.registerCommand('deeplens.rebuildIndex', async () => {
        vscode.window.showInformationMessage('Rebuilding DeepLens index...');
        await lspClient.rebuildIndex(true);
    });

    // Register clear index cache command
    const clearCacheCommand = vscode.commands.registerCommand('deeplens.clearIndexCache', async () => {
        await lspClient.clearCache();
        vscode.window.showInformationMessage('DeepLens: Index cache cleared.');
    });

    // Show call hierarchy chain from CodeLens
    const showCallChainCommand = vscode.commands.registerCommand(
        'deeplens.showCallChain',
        async (uri: vscode.Uri, position: vscode.Position, symbolName?: string) => {
            let targetUri = uri;
            let targetPosition = position;

            if (!targetUri || !targetPosition) {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showWarningMessage(
                        'DeepLens: Please open a file and place cursor on a symbol to show call chain.',
                    );
                    return;
                }
                targetUri = activeEditor.document.uri;
                targetPosition = activeEditor.selection.active;
            }

            await showCallChain(targetUri, targetPosition, symbolName);
        },
    );

    context.subscriptions.push(searchCommand, rebuildCommand, clearCacheCommand, showCallChainCommand);

    // Status Bar Item
    const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusItem.name = 'DeepLens Index Status'; // Palette: Accessibility name
    statusItem.text = '$(database) DeepLens';
    statusItem.tooltip = 'DeepLens Index Status (Click for stats)';
    statusItem.accessibilityInformation = {
        label: 'DeepLens Index Status, click to show statistics',
        role: 'button',
    };
    statusItem.command = 'deeplens.showIndexStats';
    statusItem.show();
    context.subscriptions.push(statusItem);

    // Register show index stats command
    const showStatsCommand = vscode.commands.registerCommand('deeplens.showIndexStats', async () => {
        try {
            const stats = await lspClient.getIndexStats();
            if (!stats) {
                vscode.window.showErrorMessage('DeepLens: Could not retrieve index statistics.');
                return;
            }

            const sizeInMB = (stats.cacheSize / (1024 * 1024)).toFixed(2);

            interface IndexActionItem extends vscode.QuickPickItem {
                action?: 'copy' | 'rebuild' | 'clear' | 'settings';
            }

            const items: IndexActionItem[] = [
                {
                    label: `$(database) Index Status: ${stats.totalItems} items (${stats.totalFiles} files, ${stats.totalSymbols} symbols) • ${sizeInMB} MB`,
                    kind: vscode.QuickPickItemKind.Separator,
                },
                {
                    label: '$(copy) Copy Statistics to Clipboard',
                    description: 'Copy index status summary',
                    action: 'copy',
                },
                {
                    label: '$(refresh) Rebuild Index',
                    description: 'Force a full re-index of the workspace',
                    action: 'rebuild',
                },
                {
                    label: '$(trash) Clear Cache',
                    description: 'Clear the persistent index cache',
                    action: 'clear',
                },
                {
                    label: '$(settings-gear) Configure Settings',
                    description: 'Open DeepLens extension settings',
                    action: 'settings',
                },
            ];

            const selection = await vscode.window.showQuickPick(items, {
                placeHolder: 'DeepLens Index Statistics & Actions',
            });

            if (selection && selection.action) {
                if (selection.action === 'copy') {
                    const statsText = `DeepLens Stats: ${stats.totalItems} items (${stats.totalFiles} files, ${stats.totalSymbols} symbols) • ${sizeInMB} MB`;
                    await vscode.env.clipboard.writeText(statsText);
                    vscode.window.showInformationMessage('Index statistics copied to clipboard');
                } else if (selection.action === 'rebuild') {
                    await vscode.commands.executeCommand('deeplens.rebuildIndex');
                } else if (selection.action === 'clear') {
                    await vscode.commands.executeCommand('deeplens.clearIndexCache');
                } else if (selection.action === 'settings') {
                    await vscode.commands.executeCommand('workbench.action.openSettings', 'deeplens');
                }
            }
        } catch (error) {
            logger.error('Failed to show index stats or execute action', error);
        }
    });
    context.subscriptions.push(showStatsCommand);

    // Listen to progress to update status bar
    lspClient.onProgress.event((e) => {
        if (e.state === 'start') {
            statusItem.text = '$(sync~spin) DeepLens';
            statusItem.tooltip = 'DeepLens is indexing your workspace...';
            statusItem.accessibilityInformation = {
                label: 'DeepLens is indexing your workspace, click for stats',
                role: 'button',
            };
            statusItem.color = '#ff9900'; // Orange for indexing
        } else if (e.state === 'report') {
            const percentageText = typeof e.percentage === 'number' ? ` (${e.percentage}%)` : '';

            // Determine icon and color based on message content
            let icon = '$(sync~spin)';
            let color = '#ff9900'; // Default orange

            if (e.message?.includes('scanning') || e.message?.includes('Scanning')) {
                icon = '$(search)';
                color = '#007acc'; // Blue for scanning
            } else if (e.message?.includes('parsing') || e.message?.includes('Parsing')) {
                icon = '$(code)';
                color = '#7c4dff'; // Purple for parsing
            } else if (e.message?.includes('indexing') || e.message?.includes('Indexing')) {
                icon = '$(database)';
                color = '#00c853'; // Green for indexing
            } else if (e.message?.includes('symbols') || e.message?.includes('Symbols')) {
                icon = '$(symbol-parameter)';
                color = '#aa00ff'; // Dark purple for symbols
            }

            statusItem.text = `${icon} DeepLens${percentageText}`;
            if (e.message) {
                statusItem.tooltip = `DeepLens: ${e.message} (Click for stats)`;
                statusItem.accessibilityInformation = {
                    label: `DeepLens: ${e.message}${percentageText}, click for stats`,
                    role: 'button',
                };
            } else {
                statusItem.tooltip = `DeepLens indexing${percentageText} (Click for stats)`;
                statusItem.accessibilityInformation = {
                    label: `DeepLens indexing${percentageText}, click for stats`,
                    role: 'button',
                };
            }
            statusItem.color = color;
        } else if (e.state === 'end') {
            statusItem.text = '$(database) DeepLens';
            statusItem.tooltip = 'DeepLens Index Status (Click for stats)';
            statusItem.accessibilityInformation = {
                label: 'DeepLens Index Status, click to show statistics',
                role: 'button',
            };
            statusItem.color = '#cccccc'; // Gray for normal state
        }
    });

    // Register reference code lens provider for all supported languages
    const codeLensProvider = new ReferenceCodeLensProvider();
    const supportedLanguages = [
        { scheme: 'file', language: 'typescript' },
        { scheme: 'file', language: 'typescriptreact' },
        { scheme: 'file', language: 'javascript' },
        { scheme: 'file', language: 'javascriptreact' },
        { scheme: 'file', language: 'csharp' },
        { scheme: 'file', language: 'python' },
        { scheme: 'file', language: 'java' },
        { scheme: 'file', language: 'go' },
        { scheme: 'file', language: 'cpp' },
        { scheme: 'file', language: 'c' },
        { scheme: 'file', language: 'ruby' },
        { scheme: 'file', language: 'php' },
    ];

    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(supportedLanguages, codeLensProvider),
        codeLensProvider,
    );

    // Track document opens for activity
    if (config.isActivityTrackingEnabled()) {
        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor && activityTracker) {
                    const itemId = `file:${editor.document.uri.fsPath}`;
                    const item: SearchableItem = {
                        id: itemId,
                        name: path.basename(editor.document.uri.fsPath),
                        type: SearchItemType.FILE,
                        filePath: editor.document.uri.fsPath,
                        detail: 'Recently opened',
                    };
                    activityTracker.recordAccess(item);
                    lspClient.recordActivity(itemId);
                }
            }),
        );
    }

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('deeplens')) {
                config.reload(vscode.workspace.getConfiguration('deeplens'));

                // Reload codeLens provider config
                if (event.affectsConfiguration('deeplens.codeLens')) {
                    codeLensProvider.reloadConfig();
                }

                if (event.affectsConfiguration('deeplens.excludePatterns')) {
                    indexWorkspace();
                }
            }
        }),
    );

    // Initialize Git Service
    gitService = new GitService(async () => {
        await indexWorkspace(false);
    });
    context.subscriptions.push(gitService);
    await gitService.setupGitListener(context);
    // Index commands initially
    await commandIndexer.indexCommands();

    return {
        searchProvider,
        lspClient,
        commandIndexer,
    };
}

/**
 * Workspace indexing is now handled by the LSP server.
 * This wrapper remains for git events.
 */
async function indexWorkspace(force: boolean = false): Promise<void> {
    await lspClient.rebuildIndex(force);
}

/**
 * Extension deactivation
 */
export async function deactivate() {
    if (lspClient) {
        await lspClient.stop();
    }
    if (activityTracker) {
        await activityTracker.dispose();
    }
    if (gitService) {
        gitService.dispose();
    }
}
