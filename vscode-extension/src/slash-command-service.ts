import * as vscode from 'vscode';
import { SearchScope } from '../../language-server/src/core/types';

export interface SlashCommand {
    id: string;
    name: string;
    shortName: string;
    description: string;
    aliases: string[];
    category: SlashCommandCategory;
    scope: SearchScope;
    icon: string;
    keyboardShortcut?: string;
    example?: string;
}

export enum SlashCommandCategory {
    SEARCH = 'Search',
    NAVIGATION = 'Navigation',
    FILES = 'Files',
    REFACTORING = 'Refactoring',
    ACTIONS = 'Actions',
}

export class SlashCommandService {
    private readonly commands: Map<string, SlashCommand> = new Map();
    private readonly categoryGroups: Map<SlashCommandCategory, SlashCommand[]> = new Map();
    private recentlyUsed: string[] = [];

    constructor() {
        this.initializeCommands();
        this.categoryGroups = this.initializeGroups();
        this.loadRecentCommands();
    }

    private initializeCommands(): void {
        const commands: SlashCommand[] = [
            {
                id: '/all',
                name: '/all',
                shortName: 'all',
                description: 'Search everywhere across all scopes',
                aliases: ['/a'],
                category: SlashCommandCategory.SEARCH,
                scope: SearchScope.EVERYTHING,
                icon: 'search',
                keyboardShortcut: 'Ctrl+T',
                example: '/all UserService',
            },
            {
                id: '/t',
                name: '/t',
                shortName: 't',
                description: 'Find classes, interfaces, and types',
                aliases: ['/classes', '/types', '/type', '/c'],
                category: SlashCommandCategory.SEARCH,
                scope: SearchScope.TYPES,
                icon: 'symbol-class',
                keyboardShortcut: 'Ctrl+Shift+T',
                example: '/t User',
            },
            {
                id: '/s',
                name: '/s',
                shortName: 's',
                description: 'Find methods, functions, and variables',
                aliases: ['/symbols', '/symbol', '#'],
                category: SlashCommandCategory.SEARCH,
                scope: SearchScope.SYMBOLS,
                icon: 'symbol-method',
                keyboardShortcut: 'Ctrl+Shift+O',
                example: '/s getUsers',
            },
            {
                id: '/f',
                name: '/f',
                shortName: 'f',
                description: 'Find files by name or path',
                aliases: ['/files', '/file'],
                category: SlashCommandCategory.FILES,
                scope: SearchScope.FILES,
                icon: 'file',
                keyboardShortcut: 'Ctrl+Shift+F',
                example: '/f UserService.ts',
            },
            {
                id: '/txt',
                name: '/txt',
                shortName: 'txt',
                description: 'Search text content across files',
                aliases: ['/text', '/find', '/grep'],
                category: SlashCommandCategory.SEARCH,
                scope: SearchScope.TEXT,
                icon: 'whole-word',
                keyboardShortcut: 'Ctrl+Shift+G',
                example: '/txt "async function"',
            },
            {
                id: '/e',
                name: '/e',
                shortName: 'e',
                description: 'Find API endpoints and routes',
                aliases: ['/endpoints', '/endpoint', '/routes', '/api'],
                category: SlashCommandCategory.SEARCH,
                scope: SearchScope.ENDPOINTS,
                icon: 'globe',
                example: '/e /api/users',
            },
            {
                id: '/o',
                name: '/o',
                shortName: 'o',
                description: 'Search in currently open files',
                aliases: ['/open', '/opened'],
                category: SlashCommandCategory.NAVIGATION,
                scope: SearchScope.OPEN,
                icon: 'book',
                example: '/o search',
            },
            {
                id: '/m',
                name: '/m',
                shortName: 'm',
                description: 'Search in modified or untracked files',
                aliases: ['/modified', '/mod', '/git', '/changed'],
                category: SlashCommandCategory.FILES,
                scope: SearchScope.MODIFIED,
                icon: 'git-merge',
                example: '/m service',
            },
            {
                id: '/p',
                name: '/p',
                shortName: 'p',
                description: 'Find properties and fields',
                aliases: ['/properties', '/prop', '/field'],
                category: SlashCommandCategory.SEARCH,
                scope: SearchScope.PROPERTIES,
                icon: 'symbol-property',
                example: '/p userId',
            },
            {
                id: '/cmd',
                name: '/cmd',
                shortName: 'cmd',
                description: 'Search and execute VS Code commands',
                aliases: ['/commands', '/action', '/run', '>'],
                category: SlashCommandCategory.ACTIONS,
                scope: SearchScope.COMMANDS,
                icon: 'run',
                keyboardShortcut: 'Ctrl+Shift+P',
                example: '/cmd "format document"',
            },
        ];

        for (const cmd of commands) {
            this.commands.set(cmd.name.toLowerCase(), cmd);
            this.commands.set(cmd.id, cmd);
            for (const alias of cmd.aliases) {
                this.commands.set(alias.toLowerCase(), cmd);
            }
        }
    }

    private initializeGroups(): Map<SlashCommandCategory, SlashCommand[]> {
        const grouped = new Map<SlashCommandCategory, SlashCommand[]>();
        const uniqueCommands = new Set<string>();

        for (const cmd of this.commands.values()) {
            if (!uniqueCommands.has(cmd.name)) {
                let group = grouped.get(cmd.category);
                if (!group) {
                    group = [];
                    grouped.set(cmd.category, group);
                }
                group.push(cmd);
                uniqueCommands.add(cmd.name);
            }
        }

        return grouped;
    }

    private loadRecentCommands(): void {
        const context = vscode.workspace.getConfiguration('deeplens');
        const recent = context.get<string[]>('recentSlashCommands', []);
        this.recentlyUsed = recent;
    }

    private async saveRecentCommands(): Promise<void> {
        const context = vscode.workspace.getConfiguration('deeplens');
        await context.update('recentSlashCommands', this.recentlyUsed, vscode.ConfigurationTarget.Global);
    }

    private recordUsage(commandName: string): void {
        const normalized = commandName.toLowerCase();
        this.recentlyUsed = this.recentlyUsed.filter((cmd) => cmd !== normalized);
        this.recentlyUsed.unshift(normalized);
        this.recentlyUsed = this.recentlyUsed.slice(0, 10);
        this.saveRecentCommands();
    }

    getCommands(query?: string): SlashCommand[] {
        if (!query) {
            return Array.from(new Set(Array.from(this.commands.values()).map((c) => c.name)))
                .map((name) => this.commands.get(name))
                .filter((cmd): cmd is SlashCommand => cmd !== undefined);
        }

        const lowerQuery = query.toLowerCase();
        const trimmedQuery = lowerQuery.replace(/^[/#>]/, '');
        const results: SlashCommand[] = [];
        const seen = new Set<string>();

        for (const cmd of this.commands.values()) {
            if (seen.has(cmd.name)) continue;

            const exactMatch = cmd.name === lowerQuery;
            const startsWithMatch = cmd.name.startsWith(lowerQuery);
            const aliasMatch = cmd.aliases.some(
                (alias) => alias.toLowerCase() === lowerQuery || alias.toLowerCase().startsWith(lowerQuery),
            );
            const descriptionMatch = cmd.description.toLowerCase().includes(trimmedQuery);
            const shortNameMatch = cmd.shortName.toLowerCase().startsWith(trimmedQuery);

            if (exactMatch || startsWithMatch || aliasMatch || descriptionMatch || shortNameMatch) {
                results.push(cmd);
                seen.add(cmd.name);
            }
        }

        this.sortResults(results, lowerQuery);
        return results;
    }

    getRecentCommands(): SlashCommand[] {
        const recent: SlashCommand[] = [];
        const seen = new Set<string>();

        for (const name of this.recentlyUsed) {
            const cmd = this.commands.get(name);
            if (cmd && !seen.has(cmd.name)) {
                recent.push(cmd);
                seen.add(cmd.name);
            }
        }

        return recent;
    }

    getCommandsByCategory(category: SlashCommandCategory): SlashCommand[] {
        return this.categoryGroups.get(category) || [];
    }

    getAllCategories(): SlashCommandCategory[] {
        return Array.from(this.categoryGroups.keys());
    }

    getCommand(commandOrAlias: string): SlashCommand | undefined {
        const normalized = commandOrAlias.toLowerCase();
        return this.commands.get(normalized);
    }

    executeCommand(commandName: string): void {
        this.recordUsage(commandName);
    }

    private sortResults(results: SlashCommand[], query: string): void {
        const lowerQuery = query.toLowerCase();

        results.sort((a, b) => {
            const aExact = a.name === lowerQuery;
            const bExact = b.name === lowerQuery;

            if (aExact && !bExact) return -1;
            if (!aExact && bExact) return 1;

            const aRecent = this.recentlyUsed.includes(a.name.toLowerCase());
            const bRecent = this.recentlyUsed.includes(b.name.toLowerCase());

            if (aRecent && !bRecent) return -1;
            if (!aRecent && bRecent) return 1;

            const aStartsWith = a.name.startsWith(lowerQuery);
            const bStartsWith = b.name.startsWith(lowerQuery);

            if (aStartsWith && !bStartsWith) return -1;
            if (!aStartsWith && bStartsWith) return 1;

            return a.name.localeCompare(b.name);
        });
    }

    formatCommandForDisplay(cmd: SlashCommand): string {
        const primaryAlias = cmd.aliases[0] || cmd.name;
        const shortcuts = cmd.keyboardShortcut ? ` [${cmd.keyboardShortcut}]` : '';
        return `${primaryAlias}: ${cmd.description}${shortcuts}`;
    }

    getPrimaryAlias(cmd: SlashCommand): string {
        return cmd.name;
    }

    getAliasesForDisplay(cmd: SlashCommand): string[] {
        const primaryAlias = this.getPrimaryAlias(cmd);
        const aliases = [primaryAlias, cmd.name, ...cmd.aliases];
        const seen = new Set<string>();

        return aliases.filter((alias) => {
            const normalized = alias.toLowerCase();
            if (seen.has(normalized)) {
                return false;
            }
            seen.add(normalized);
            return true;
        });
    }

    getCategoryIcon(category: SlashCommandCategory): string {
        switch (category) {
            case SlashCommandCategory.SEARCH:
                return 'search';
            case SlashCommandCategory.NAVIGATION:
                return 'arrow-right';
            case SlashCommandCategory.FILES:
                return 'file';
            case SlashCommandCategory.REFACTORING:
                return 'wand';
            case SlashCommandCategory.ACTIONS:
                return 'run';
            default:
                return 'circle-outline';
        }
    }
}
