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

        // Load languages
        await this.loadLanguage('typescript', 'tree-sitter-typescript.wasm');
        await this.loadLanguage('typescriptreact', 'tree-sitter-tsx.wasm');
        await this.loadLanguage('javascript', 'tree-sitter-typescript.wasm');
        await this.loadLanguage('javascriptreact', 'tree-sitter-tsx.wasm');
        await this.loadLanguage('csharp', 'tree-sitter-c_sharp.wasm');

        this.isInitialized = true;
    }

    private async loadLanguage(langId: string, wasmFile: string): Promise<void> {
        try {
            // First try the source path (for development)
            let wasmPath = path.join(this.extensionPath, 'src', 'parsers', wasmFile);

            // If not found, try the dist path (for production)
            if (!fs.existsSync(wasmPath)) {
                wasmPath = path.join(this.extensionPath, 'dist', 'parsers', wasmFile);
            }

            if (fs.existsSync(wasmPath)) {
                const lib = Parser as unknown as TreeSitterLib;
                const lang = await lib.Language.load(wasmPath);
                this.languages.set(langId, lang);
            }
        } catch (error) {
            console.error(`Failed to load Tree-sitter language ${langId}:`, error);
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
        // Common types
        if (nodeType.includes('class_declaration')) {
            return SearchItemType.CLASS;
        }
        if (nodeType.includes('interface_declaration')) {
            return SearchItemType.INTERFACE;
        }
        if (nodeType.includes('enum_declaration')) {
            return SearchItemType.ENUM;
        }

        return langId === 'csharp' ? this.getCSharpItemType(nodeType) : this.getTSJSItemType(nodeType);
    }

    private getCSharpItemType(nodeType: string): SearchItemType | undefined {
        if (nodeType === 'method_declaration') {
            return SearchItemType.METHOD;
        }
        if (nodeType === 'property_declaration') {
            return SearchItemType.PROPERTY;
        }
        if (nodeType === 'variable_declaration') {
            return SearchItemType.VARIABLE;
        }
        return undefined;
    }

    private getTSJSItemType(nodeType: string): SearchItemType | undefined {
        if (nodeType === 'method_definition') {
            return SearchItemType.METHOD;
        }
        if (nodeType === 'function_declaration') {
            return SearchItemType.FUNCTION;
        }
        if (nodeType === 'property_definition') {
            return SearchItemType.PROPERTY;
        }
        if (nodeType === 'variable_declarator') {
            return SearchItemType.VARIABLE;
        }
        return undefined;
    }

    private getNameNode(node: TreeSitterNode): TreeSitterNode | null {
        // Tree-sitter usually has an 'identifier' or 'name' child for declarations
        return (
            node.childForFieldName('name') ||
            node.children.find((c: TreeSitterNode) => c.type === 'identifier') ||
            null
        );
    }
}
