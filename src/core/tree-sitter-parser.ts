import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as Parser from 'web-tree-sitter';
import { SearchItemType, SearchableItem } from './types';

interface TreeSitterNode {
    type: string;
    text: string;
    startPosition: { row: number; column: number };
    childCount: number;
    child: (i: number) => TreeSitterNode | null;
    childForFieldName: (name: string) => TreeSitterNode | null;
    children: TreeSitterNode[];
}

interface TreeSitterLib {
    init: () => Promise<void>;
    Language: {
        load: (path: string) => Promise<unknown>;
    };
}

export class TreeSitterParser {
    private parser:
        | {
            setLanguage: (lang: unknown) => void;
            parse: (content: string) => { rootNode: unknown; delete: () => void };
        }
        | undefined;
    private languages: Map<string, unknown> = new Map();
    private isInitialized: boolean = false;
    private extensionPath: string;

    constructor(extensionPath: string) {
        this.extensionPath = extensionPath;
    }

    /**
     * Initialize the parser and load languages
     */
    async init(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        const lib = Parser as unknown as TreeSitterLib;
        const ParserClass = Parser as unknown as new () => NonNullable<TreeSitterParser['parser']>;
        await lib.init();
        this.parser = new ParserClass();

        // Load languages from node_modules
        const languageMap = [
            { id: 'typescript', pkg: 'tree-sitter-typescript', wasm: 'tree-sitter-typescript.wasm' },
            { id: 'typescriptreact', pkg: 'tree-sitter-typescript', wasm: 'tree-sitter-tsx.wasm' },
            { id: 'javascript', pkg: 'tree-sitter-javascript', wasm: 'tree-sitter-javascript.wasm' },
            { id: 'javascriptreact', pkg: 'tree-sitter-typescript', wasm: 'tree-sitter-tsx.wasm' },
            { id: 'csharp', pkg: 'tree-sitter-c-sharp', wasm: 'tree-sitter-c_sharp.wasm' },
            { id: 'python', pkg: 'tree-sitter-python', wasm: 'tree-sitter-python.wasm' },
            { id: 'java', pkg: 'tree-sitter-java', wasm: 'tree-sitter-java.wasm' },
            { id: 'go', pkg: 'tree-sitter-go', wasm: 'tree-sitter-go.wasm' },
            { id: 'cpp', pkg: 'tree-sitter-cpp', wasm: 'tree-sitter-cpp.wasm' },
            { id: 'c', pkg: 'tree-sitter-c', wasm: 'tree-sitter-c.wasm' },
            { id: 'ruby', pkg: 'tree-sitter-ruby', wasm: 'tree-sitter-ruby.wasm' },
            { id: 'php', pkg: 'tree-sitter-php', wasm: 'tree-sitter-php.wasm' },
        ];

        for (const lang of languageMap) {
            await this.loadLanguageFromModule(lang.id, lang.pkg, lang.wasm);
        }

        this.isInitialized = true;
    }

    private async loadLanguageFromModule(langId: string, packageName: string, wasmFile: string): Promise<void> {
        try {
            // Locate the WASM file in node_modules
            const pkgPath = path.dirname(require.resolve(`${packageName}/package.json`));
            let wasmPath = path.join(pkgPath, wasmFile);

            // Handle cases where WASM might be in a different subfolder or named differently
            if (!fs.existsSync(wasmPath)) {
                // Try a few common locations
                const alternates = [
                    path.join(pkgPath, 'out', wasmFile),
                    path.join(pkgPath, 'dist', wasmFile),
                    path.join(pkgPath, wasmFile.replace('_', '-')), // c_sharp vs c-sharp
                ];
                for (const alt of alternates) {
                    if (fs.existsSync(alt)) {
                        wasmPath = alt;
                        break;
                    }
                }
            }

            if (fs.existsSync(wasmPath)) {
                const lib = Parser as unknown as TreeSitterLib;
                const lang = await lib.Language.load(wasmPath);
                this.languages.set(langId, lang);
            } else {
                console.warn(`WASM file not found for ${langId} at ${wasmPath}`);
            }
        } catch (error) {
            console.debug(`Module resolution failed for ${langId}:`, error);
        }
    }

    /**
     * Parse a file and extract symbols
     */
    async parseFile(fileUri: vscode.Uri): Promise<SearchableItem[]> {
        if (!this.isInitialized || !this.parser) {
            return [];
        }

        const langId = this.getLanguageId(fileUri.fsPath);
        const lang = this.languages.get(langId);
        if (!lang) {
            return [];
        }

        try {
            this.parser.setLanguage(lang);
            const content = fs.readFileSync(fileUri.fsPath, 'utf8');
            const tree = this.parser.parse(content);
            const items: SearchableItem[] = [];

            this.extractSymbols(tree.rootNode as unknown as TreeSitterNode, fileUri.fsPath, items, langId);

            tree.delete();
            return items;
        } catch (error) {
            console.error(`Error tree-sitter parsing ${fileUri.fsPath}:`, error);
            return [];
        }
    }

    private getLanguageId(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        switch (ext) {
            case '.ts':
                return 'typescript';
            case '.tsx':
                return 'typescriptreact';
            case '.js':
                return 'javascript';
            case '.jsx':
                return 'javascriptreact';
            case '.cs':
                return 'csharp';
            case '.py':
                return 'python';
            case '.java':
                return 'java';
            case '.go':
                return 'go';
            case '.cpp':
            case '.cc':
            case '.cxx':
            case '.hpp':
                return 'cpp';
            case '.c':
            case '.h':
                return 'c';
            case '.rb':
                return 'ruby';
            case '.php':
                return 'php';
            default:
                return '';
        }
    }

    private extractSymbols(
        node: TreeSitterNode,
        filePath: string,
        items: SearchableItem[],
        langId: string,
        containerName?: string,
    ): void {
        const type = this.getSearchItemType(node.type, langId);
        let currentContainer = containerName;

        if (type) {
            const nameNode = this.getNameNode(node);
            if (nameNode) {
                const name = nameNode.text;
                const fullName = containerName ? `${containerName}.${name}` : name;

                items.push({
                    id: `ts:${filePath}:${fullName}:${node.startPosition.row}`,
                    name: name,
                    type: type,
                    filePath: filePath,
                    line: node.startPosition.row,
                    column: node.startPosition.column,
                    containerName: containerName,
                    fullName: fullName,
                });

                // If it's a type (class/interface/enum), it becomes the container for children
                if (
                    type === SearchItemType.CLASS ||
                    type === SearchItemType.INTERFACE ||
                    type === SearchItemType.ENUM
                ) {
                    currentContainer = fullName;
                }
            }
        }

        for (let i = 0; i < node.childCount; i++) {
            this.extractSymbols(node.child(i) as TreeSitterNode, filePath, items, langId, currentContainer);
        }
    }

    private getSearchItemType(nodeType: string, langId: string): SearchItemType | undefined {
        // Classes & Types
        if (nodeType.match(/class_declaration|class_definition|^class$/)) {
            return SearchItemType.CLASS;
        }
        if (nodeType.match(/interface_declaration|interface_definition|^interface$/)) {
            return SearchItemType.INTERFACE;
        }
        if (nodeType.match(/enum_declaration|enum_definition|^enum$/)) {
            return SearchItemType.ENUM;
        }
        if (nodeType.match(/struct_declaration|struct_definition|^struct$/)) {
            return SearchItemType.CLASS;
        }
        if (nodeType.match(/trait_declaration|trait_definition|^trait$/)) {
            return SearchItemType.INTERFACE;
        }

        // Functions & Methods
        if (nodeType.match(/method_declaration|method_definition|^method$/)) {
            return SearchItemType.METHOD;
        }
        if (nodeType.match(/function_declaration|function_definition|^function$/)) {
            return SearchItemType.FUNCTION;
        }

        return this.getLanguageSpecificItemType(nodeType, langId);
    }

    private getLanguageSpecificItemType(nodeType: string, langId: string): SearchItemType | undefined {
        switch (langId) {
            case 'python':
                if (nodeType === 'function_definition') {
                    return SearchItemType.FUNCTION;
                }
                break;
            case 'go':
                return this.getGoItemType(nodeType);
            case 'ruby':
                if (nodeType === 'method' || nodeType === 'singleton_method') {
                    return SearchItemType.METHOD;
                }
                break;
        }

        // Fallback for common properties and variables
        if (nodeType.match(/property_declaration|property_definition/)) {
            return SearchItemType.PROPERTY;
        }
        if (nodeType.match(/variable_declaration|variable_declarator/)) {
            return SearchItemType.VARIABLE;
        }

        return undefined;
    }

    private getGoItemType(nodeType: string): SearchItemType | undefined {
        if (nodeType === 'method_declaration') {
            return SearchItemType.METHOD;
        }
        if (nodeType === 'function_declaration') {
            return SearchItemType.FUNCTION;
        }
        if (nodeType === 'type_declaration') {
            return SearchItemType.CLASS;
        }
        return undefined;
    }

    private getNameNode(node: TreeSitterNode): TreeSitterNode | null {
        // Tree-sitter usually has an 'identifier' or 'name' child for declarations
        return (
            node.childForFieldName('name') || node.children.find((c: TreeSitterNode) => c.type === 'identifier') || null
        );
    }
}
