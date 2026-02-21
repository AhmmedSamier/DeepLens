import * as fs from 'node:fs';
import * as path from 'node:path';
import { SearchItemType, SearchableItem } from './types';

/**
 * Simple interface for logging to allow decoupling from vscode
 */
export interface Logger {
    appendLine(message: string): void;
}

interface TreeSitterNode {
    type: string;
    text: string;
    startPosition: { row: number; column: number };
    childCount: number;
    child: (i: number) => TreeSitterNode | null;
    childForFieldName: (name: string) => TreeSitterNode | null;
    children: TreeSitterNode[];
    parent: TreeSitterNode | null;
}

interface TreeSitterLib {
    init: (options?: { locateFile?: () => string }) => Promise<void>;
    Language: {
        load: (path: string) => Promise<unknown>;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Parser?: any;
}

export class TreeSitterParser {
    private isInitialized: boolean = false;
    private readonly languages: Map<string, unknown> = new Map();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private ParserClass: any = undefined;
    private lib: TreeSitterLib | undefined = undefined;
    private parserCache: Map<string, unknown> = new Map();
    private readonly extensionPath: string = '';
    private readonly logger: Logger | undefined = undefined;

    constructor(extensionPath: string, logger?: Logger) {
        this.extensionPath = extensionPath;
        this.logger = logger;
    }

    private log(message: string): void {
        this.logger?.appendLine(`[TreeSitter] ${message}`);
    }

    /**
     * Initialize the parser and load languages
     */
    async init(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        // Load using require to stay as close to Node.js defaults as possible for this external module
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const libraryModule = require('web-tree-sitter');
            this.lib = libraryModule as TreeSitterLib;
            this.ParserClass = this.lib;

            if (this.lib.Parser) {
                this.ParserClass = this.lib.Parser;
            }

            this.log('Initializing web-tree-sitter WASM...');
            const wasmPath = path.normalize(
                path.resolve(this.extensionPath, 'dist', 'parsers', 'web-tree-sitter.wasm'),
            );

            if (!(await this.fileExists(wasmPath))) {
                this.log(`ERROR: WASM file MISSING at: ${wasmPath}`);
            }

            // Standard initialization for web-tree-sitter in Node context
            await this.ParserClass.init({
                locateFile: () => wasmPath,
            });

            this.log('Web-tree-sitter WASM initialized.');
        } catch (e) {
            this.log(`ERROR: TreeSitter initialization failed: ${e}`);
            throw e;
        }

        if (!this.ParserClass || typeof this.ParserClass !== 'function') {
            this.log('ERROR: Parser class not found or invalid.');
            throw new Error('Parser class not found');
        }

        this.isInitialized = true;
    }

    private static readonly LANGUAGE_MAP: Record<string, string> = {
        typescript: 'tree-sitter-typescript.wasm',
        typescriptreact: 'tree-sitter-tsx.wasm',
        javascript: 'tree-sitter-javascript.wasm',
        javascriptreact: 'tree-sitter-tsx.wasm',
        csharp: 'tree-sitter-c_sharp.wasm',
        python: 'tree-sitter-python.wasm',
        java: 'tree-sitter-java.wasm',
        go: 'tree-sitter-go.wasm',
        cpp: 'tree-sitter-cpp.wasm',
        c: 'tree-sitter-c.wasm',
        ruby: 'tree-sitter-ruby.wasm',
        php: 'tree-sitter-php.wasm',
    };

    private async loadLanguage(langId: string, wasmFile: string): Promise<boolean> {
        try {
            const wasmPath = path.join(this.extensionPath, 'dist', 'parsers', wasmFile);

            if (await this.fileExists(wasmPath)) {
                this.log(`Loading language ${langId} from ${wasmFile}...`);
                // Ensure this.lib is not null before using it
                if (!this.lib) {
                    this.log(`ERROR: TreeSitter library not initialized when trying to load ${langId}`);
                    return false;
                }
                // Use plain absolute path string - do NOT use file:// URLs on Windows for this library
                const absoluteWasmPath = path.normalize(wasmPath);
                const lang = await this.lib.Language.load(absoluteWasmPath);
                this.languages.set(langId, lang);
                this.log(`Successfully loaded ${langId}`);
                return true;
            } else {
                this.log(`WARNING: WASM file not found for ${langId} at ${wasmPath}`);
                return false;
            }
        } catch (error) {
            this.log(`ERROR: Failed to load ${langId}: ${error}`);
            return false;
        }
    }

    /**
     * Parse a file and extract symbols
     */
    async parseFile(filePath: string): Promise<SearchableItem[]> {
        if (!this.isInitialized || !this.ParserClass) {
            return [];
        }

        const langId = this.getLanguageId(filePath);
        const lang = await this.ensureLanguageLoaded(langId);

        if (!lang) {
            return [];
        }

        try {
            this.logDebugStart(langId, filePath);

            const parser = this.getOrCreateParser(langId, lang);
            const content = await fs.promises.readFile(filePath, 'utf8');
            const tree = parser.parse(content);
            const items: SearchableItem[] = [];

            this.extractSymbols(tree.rootNode as unknown as TreeSitterNode, filePath, items, langId);

            this.logDebugEnd(langId, filePath, items, tree);

            tree.delete();
            return items;
        } catch (error) {
            this.log(`Error tree-sitter parsing ${filePath}: ${error}`);
            return [];
        }
    }

    private getOrCreateParser(
        langId: string,
        lang: unknown,
    ): { setLanguage: (lang: unknown) => void; parse: (content: string) => { rootNode: unknown; delete: () => void } } {
        const cached = this.parserCache.get(langId);
        if (cached) {
            return cached as {
                setLanguage: (lang: unknown) => void;
                parse: (content: string) => { rootNode: unknown; delete: () => void };
            };
        }

        const parser = new this.ParserClass() as {
            setLanguage: (language: unknown) => void;
            parse: (content: string) => { rootNode: unknown; delete: () => void };
        };
        parser.setLanguage(lang);
        this.parserCache.set(langId, parser);
        return parser;
    }

    private async ensureLanguageLoaded(langId: string): Promise<unknown> {
        let lang = this.languages.get(langId);
        if (!lang) {
            // Lazy load language
            const wasmFile = TreeSitterParser.LANGUAGE_MAP[langId];
            if (wasmFile) {
                const loaded = await this.loadLanguage(langId, wasmFile);
                if (loaded) {
                    lang = this.languages.get(langId);
                }
            }
        }
        return lang;
    }

    private logDebugStart(langId: string, filePath: string) {
        if (langId === 'csharp') {
            this.log(`Starting C# parse: ${filePath}`);
        }
    }

    private logDebugEnd(langId: string, filePath: string, items: SearchableItem[], tree: { rootNode: unknown }) {
        if (langId === 'csharp') {
            const endpoints = items.filter((i) => i.type === SearchItemType.ENDPOINT);
            this.log(`Finished C# parse: ${filePath}. Items: ${items.length}, Endpoints: ${endpoints.length}`);
            if (endpoints.length > 0) {
                endpoints.forEach((e) => this.log(`  - Found Endpoint: ${e.name}`));
            } else if (items.length === 0) {
                const rootNode = tree.rootNode as TreeSitterNode;
                this.log(`Parsed ${filePath} (CSHARP) - Found 0 items. Root node type: ${rootNode.type}`);
            }
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

        // C# Endpoint detection
        if (langId === 'csharp') {
            this.detectCSharpEndpoint(node, filePath, items, containerName);
        }

        const children = node.children;
        if (children) {
            for (const child of children) {
                this.extractSymbols(child, filePath, items, langId, currentContainer);
            }
        }
    }

    /**
     * Specialized detection for ASP.NET Endpoints
     */
    private detectCSharpEndpoint(
        node: TreeSitterNode,
        filePath: string,
        items: SearchableItem[],
        containerName?: string,
    ): void {
        this.detectControllerAction(node, filePath, items, containerName);
        this.detectMinimalApi(node, filePath, items);
    }

    private detectControllerAction(
        node: TreeSitterNode,
        filePath: string,
        items: SearchableItem[],
        containerName?: string,
    ): void {
        if (node.type !== 'method_declaration') return;

        const { method, route } = this.scanAttributes(node);

        if (method || route) {
            this.processEndpointMethod(node, method || 'GET', route || '', filePath, items, containerName);
        }
    }

    private scanAttributes(node: TreeSitterNode): { method: string | null; route: string | null } {
        const results: { method: string | null; route: string | null } = { method: null, route: null };
        this.findAttributeListsRecursive(node, results);
        return results;
    }

    private findAttributeListsRecursive(
        node: TreeSitterNode,
        results: { method: string | null; route: string | null },
        isRoot: boolean = true,
    ): void {
        const type = node.type.toLowerCase();

        // Stop if we hit something that clearly isn't an attribute prefix (like a body or another member)
        if (
            !isRoot &&
            (type.includes('body') || type === 'block' || type === 'parameter_list' || type.includes('declaration'))
        ) {
            return;
        }

        if (type.includes('attribute_list')) {
            this.processAttributeList(node, results);
        }

        // Recursively search children for attribute lists
        const children = node.children;
        if (children) {
            for (const child of children) {
                this.findAttributeListsRecursive(child, results, false);
            }
        }
    }

    private processAttributeList(node: TreeSitterNode, results: { method: string | null; route: string | null }): void {
        const children = node.children;
        if (children) {
            for (const child of children) {
                if (!child.type.includes('attribute')) continue;

                const info = this.getHttpAttributeInfo(child);
                if (!info) continue;

                if (info.method !== 'ROUTE') {
                    results.method = info.method;
                }
                const attrRoute = this.extractAttributeRoute(child);
                if (attrRoute) {
                    results.route = attrRoute;
                }
            }
        }
    }

    private processEndpointMethod(
        node: TreeSitterNode,
        method: string,
        localRoute: string,
        filePath: string,
        items: SearchableItem[],
        containerName?: string,
    ): void {
        const nameNode = this.getNameNode(node);
        if (!nameNode) return;

        const methodName = nameNode.text;
        let finalRoute = localRoute;

        const controllerRoute = this.getControllerRoutePrefix(node);
        const containerPrefix = containerName ? `${containerName}.` : '';

        if (controllerRoute) {
            const controllerTokenValue = containerName ? containerName.replace(/Controller$/, '') : '';
            const resolvedPrefix = controllerRoute.replace('[controller]', controllerTokenValue);

            finalRoute = this.combineRoutes(resolvedPrefix, finalRoute);
        }

        items.push({
            id: `endpoint:${filePath}:${containerPrefix}${methodName}:${node.startPosition.row}`,
            name: finalRoute ? `[${method}] ${finalRoute}` : `[${method}] ${methodName}`,
            type: SearchItemType.ENDPOINT,
            filePath: filePath,
            line: node.startPosition.row,
            column: node.startPosition.column,
            containerName: containerName,
            fullName: `${containerPrefix}${methodName}`,
            detail: finalRoute
                ? `ASP.NET Endpoint: ${method} ${finalRoute}`
                : `ASP.NET Controller Action: ${methodName}`,
        });
    }

    private combineRoutes(prefix: string, suffix: string): string {
        if (!suffix) return prefix;
        if (!prefix) return suffix;
        const cleanPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
        const cleanSuffix = suffix.startsWith('/') ? suffix.slice(1) : suffix;
        return `${cleanPrefix}/${cleanSuffix}`;
    }

    private getControllerRoutePrefix(methodNode: TreeSitterNode): string | null {
        // Walk up to find the class declaration
        let parent = this.getParent(methodNode);
        while (
            parent &&
            !parent.type.toLowerCase().includes('class_declaration') &&
            parent.type !== 'compilation_unit'
        ) {
            parent = this.getParent(parent);
        }

        if (parent?.type.toLowerCase().includes('class_declaration')) {
            const results: { method: string | null; route: string | null } = { method: null, route: null };
            this.findAttributeListsRecursive(parent, results, true);
            return results.route;
        }
        return null;
    }

    private getHttpAttributeInfo(attr: TreeSitterNode): { method: string } | null {
        const text = attr.text;
        // Case-insensitive check for common Http attributes
        const lowerText = text.toLowerCase();
        if (lowerText.includes('httpget')) return { method: 'GET' };
        if (lowerText.includes('httppost')) return { method: 'POST' };
        if (lowerText.includes('httpput')) return { method: 'PUT' };
        if (lowerText.includes('httpdelete')) return { method: 'DELETE' };
        if (lowerText.includes('httppatch')) return { method: 'PATCH' };
        if (lowerText.includes('httphead')) return { method: 'HEAD' };
        if (lowerText.includes('httpoptions')) return { method: 'OPTIONS' };
        if (lowerText.includes('route')) return { method: 'ROUTE' };
        return null;
    }

    private extractAttributeRoute(attr: TreeSitterNode): string {
        // Look for string literals anywhere in the attribute node (usually in the argument list)
        return this.findFirstStringLiteral(attr) || '';
    }

    private findFirstStringLiteral(node: TreeSitterNode): string | null {
        if (node.type === 'string_literal' || node.type === 'verbatim_string_literal') {
            return this.cleanCSharpString(node.text);
        }

        const children = node.children;
        if (children) {
            for (const child of children) {
                const found = this.findFirstStringLiteral(child);
                if (found) return found;
            }
        }
        return null;
    }

    private cleanCSharpString(text: string): string {
        let start = 0;
        // Skip opening quotes and prefixes like @ or $
        while (start < text.length && '"@$'.includes(text[start])) {
            start++;
        }
        let end = text.length;
        // Skip closing quotes
        while (end > start && '"'.includes(text[end - 1])) {
            end--;
        }
        return text.slice(start, end);
    }

    private detectMinimalApi(node: TreeSitterNode, filePath: string, items: SearchableItem[]): void {
        if (node.type !== 'invocation_expression') return;

        const text = node.text;
        // Minimal API Map methods: app.MapGet, app.MapPost, etc.
        const mapMatch = /\.Map(Get|Post|Put|Delete|Patch)\s*\(/.exec(text);
        if (!mapMatch) return;

        const httpMethod = mapMatch[1].toUpperCase();
        const args = this.findChildByType(node, 'argument_list');
        // args has opening '(', then arguments separated by commas, then ')'
        // Minimal API pattern: MapGet("/route", handler) - route is usually first arg
        if (!args || args.childCount < 2) return;

        // In tree-sitter, child(0) is '(', child(1) is the first argument
        const firstArg = args.child(1);
        if (!firstArg) return;

        const route = this.cleanCSharpString(firstArg.text);
        if (!route) return;

        items.push({
            id: `endpoint:${filePath}:${route}:${node.startPosition.row}`,
            name: `[${httpMethod}] ${route}`,
            type: SearchItemType.ENDPOINT,
            filePath: filePath,
            line: node.startPosition.row,
            column: node.startPosition.column,
            fullName: route,
            detail: `ASP.NET Minimal API: ${httpMethod} ${route}`,
        });
    }

    private findChildByType(node: TreeSitterNode, type: string): TreeSitterNode | null {
        const children = node.children;
        if (children) {
            for (const child of children) {
                if (child.type === type) return child;
            }
        }
        return null;
    }

    private filterChildrenByType(node: TreeSitterNode, type: string): TreeSitterNode[] {
        const results: TreeSitterNode[] = [];
        const children = node.children;
        if (children) {
            for (const child of children) {
                if (child.type === type) results.push(child);
            }
        }
        return results;
    }

    private getParent(node: TreeSitterNode): TreeSitterNode | null {
        return node.parent;
    }

    private getSearchItemType(nodeType: string, langId: string): SearchItemType | undefined {
        // Classes & Types
        if (/class_declaration|class_definition|^class$/.test(nodeType)) {
            return SearchItemType.CLASS;
        }
        if (/interface_declaration|interface_definition|^interface$/.test(nodeType)) {
            return SearchItemType.INTERFACE;
        }
        if (/enum_declaration|enum_definition|^enum$/.test(nodeType)) {
            return SearchItemType.ENUM;
        }
        if (/struct_declaration|struct_definition|^struct$/.test(nodeType)) {
            return SearchItemType.CLASS;
        }
        if (/trait_declaration|trait_definition|^trait$/.test(nodeType)) {
            return SearchItemType.INTERFACE;
        }

        // Functions & Methods
        if (/method_declaration|method_definition|^method$/.test(nodeType)) {
            return SearchItemType.METHOD;
        }
        if (/function_declaration|function_definition|^function$/.test(nodeType)) {
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
        if (/property_declaration|property_definition/.test(nodeType)) {
            return SearchItemType.PROPERTY;
        }
        if (/variable_declaration|variable_declarator/.test(nodeType)) {
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
        const nameChild = node.childForFieldName('name');
        if (nameChild) return nameChild;

        const children = node.children;
        if (children) {
            for (const child of children) {
                if (child.type === 'identifier') return child;
            }
        }
        return null;
    }

    private async fileExists(path: string): Promise<boolean> {
        try {
            await fs.promises.access(path, fs.constants.F_OK);
            return true;
        } catch {
            return false;
        }
    }
}
