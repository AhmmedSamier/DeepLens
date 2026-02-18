import * as Fuzzysort from 'fuzzysort';
import * as vscode from 'vscode';
import { Config } from '../../language-server/src/core/config';
import { SearchableItem, SearchItemType, SearchResult, SearchScope } from '../../language-server/src/core/types';

interface PreparedCommand {
    item: SearchableItem;
    preparedName: Fuzzysort.Prepared;
    preparedDetail: Fuzzysort.Prepared | null;
}

/**
 * Indexes VS Code commands for search
 */
export class CommandIndexer {
    private config: Config;
    private commandItems: SearchableItem[] = [];
    private preparedItems: PreparedCommand[] = [];

    constructor(config: Config) {
        this.config = config;
    }

    /**
     * Index all available VS Code commands
     */
    async indexCommands(): Promise<void> {
        this.commandItems = [];
        this.preparedItems = [];

        try {
            // Get all available commands
            const commands = await vscode.commands.getCommands(true);

            for (const commandId of commands) {
                // Skip internal commands (those starting with _)
                if (commandId.startsWith('_')) {
                    continue;
                }

                // Create a readable title from command ID
                const title = this.commandIdToTitle(commandId);
                const item: SearchableItem = {
                    id: `command:${commandId}`,
                    name: title,
                    type: SearchItemType.COMMAND,
                    filePath: '', // Commands don't have files
                    detail: commandId,
                    fullName: `${title} (${commandId})`,
                    commandId, // Store the actual command ID for execution
                };

                this.commandItems.push(item);
                this.preparedItems.push({
                    item,
                    preparedName: Fuzzysort.prepare(item.name),
                    preparedDetail: Fuzzysort.prepare(commandId),
                });
            }

            console.log(`Indexed ${this.commandItems.length} commands`);
        } catch (error) {
            console.error('Failed to index commands:', error);
        }
    }

    /**
     * Search commands using fuzzy matching
     */
    search(query: string, limit: number = 20): SearchResult[] {
        if (!query) return [];

        const results = Fuzzysort.go(query, this.preparedItems, {
            keys: ['preparedName', 'preparedDetail'],
            limit: limit,
            threshold: -10000,
        });

        return results.map(r => ({
            item: r.obj.item,
            score: r.score,
            scope: SearchScope.COMMANDS,
        }));
    }

    /**
     * Convert command ID to human-readable title
     * e.g., "workbench.action.files.save" -> "Files Save"
     */
    private commandIdToTitle(commandId: string): string {
        // Remove common prefixes
        const title = commandId
            .replace(/^workbench\.action\./, '')
            .replace(/^editor\.action\./, '')
            .replace(/^vscode\./, '');

        // Split by dots and capitalize
        const parts = title.split('.');
        return parts
            .map((part) => {
                // Split camelCase
                const words = part.replace(/([A-Z])/g, ' $1').trim();
                // Capitalize first letter of each word
                return words.charAt(0).toUpperCase() + words.slice(1);
            })
            .join(' ');
    }

    /**
     * Get all indexed commands
     */
    getCommands(): SearchableItem[] {
        return this.commandItems;
    }

    /**
     * Execute a command by ID
     */
    async executeCommand(commandId: string): Promise<void> {
        try {
            await vscode.commands.executeCommand(commandId);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to execute command: ${commandId}`);
            console.error(`Command execution failed:`, error);
        }
    }
}
