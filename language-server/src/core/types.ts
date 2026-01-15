/**
 * Core type definitions for the search engine
 */

/**
 * Types of searchable items
 */
export enum SearchItemType {
    FILE = 'file',
    CLASS = 'class',
    INTERFACE = 'interface',
    ENUM = 'enum',
    FUNCTION = 'function',
    METHOD = 'method',
    PROPERTY = 'property',
    VARIABLE = 'variable',
    TEXT = 'text',
    COMMAND = 'command',
    ENDPOINT = 'endpoint',
}

/**
 * Search scope/filter types
 */
export enum SearchScope {
    EVERYTHING = 'everything',
    TYPES = 'types', // Classes, interfaces, enums
    SYMBOLS = 'symbols', // Methods and functions
    FILES = 'files', // File names only
    COMMANDS = 'commands', // VS Code commands
    PROPERTIES = 'properties', // Properties and variables
    TEXT = 'text', // Text content in files
    ENDPOINTS = 'endpoints', // ASP.NET endpoints
}

/**
 * Base searchable item interface
 */
export interface SearchableItem {
    /** Unique identifier */
    id: string;
    /** Display name */
    name: string;
    /** Item type */
    type: SearchItemType;
    /** File path */
    filePath: string;
    /** Relative file path for display and search */
    relativeFilePath?: string;
    /** Line number in file (optional for files) */
    line?: number;
    /** Column number (optional) */
    column?: number;
    /** Container name (e.g., class name for methods) */
    containerName?: string;
    /** Full qualified name */
    fullName?: string;
    /** Additional context (e.g., function signature) */
    detail?: string;
    /** Command ID (for commands) */
    commandId?: string;
}

/**
 * Search result with score
 */
export interface SearchResult {
    /** The matched item */
    item: SearchableItem;
    /** Match score (0-1, higher is better) */
    score: number;
    /** Matched portions for highlighting */
    highlights?: number[][];
    /** Search scope this result belongs to */
    scope: SearchScope;
}

/**
 * Search options
 */
export interface SearchOptions {
    /** Search query */
    query: string;
    /** Scope filter */
    scope: SearchScope;
    /** Maximum number of results */
    maxResults?: number;
    /** Enable CamelHumps matching */
    enableCamelHumps?: boolean;
    /** File patterns to exclude */
    excludePatterns?: string[];
    /** File extensions to include */
    fileExtensions?: string[];
}

/**
 * Index statistics
 */
export interface IndexStats {
    /** Total number of indexed items */
    totalItems: number;
    /** Number of files indexed */
    totalFiles: number;
    /** Number of types (classes, interfaces, enums) */
    totalTypes: number;
    /** Number of symbols (methods, functions, properties) */
    totalSymbols: number;
    /** Last update timestamp */
    lastUpdate: number;
    /** Indexing in progress */
    indexing: boolean;
    /** Size of the cache on disk in bytes */
    cacheSize: number;
}
