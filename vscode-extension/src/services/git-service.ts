import * as vscode from 'vscode';
import { logger } from './logging-service';

export interface GitRepository {
    rootUri: vscode.Uri;
    state: {
        HEAD?: {
            commit?: string;
            name?: string;
        };
        onDidChange: (cb: () => void) => vscode.Disposable;
    };
}

export interface GitAPI {
    repositories: GitRepository[];
    onDidOpenRepository: (cb: (repo: GitRepository) => void) => vscode.Disposable;
}

export class GitService {
    private gitChangeDebounce: NodeJS.Timeout | undefined;
    private onRepoChange: () => Promise<void>;

    constructor(onRepoChange: () => Promise<void>) {
        this.onRepoChange = onRepoChange;
    }

    public async setupGitListener(context: vscode.ExtensionContext): Promise<void> {
        try {
            const gitExtension = vscode.extensions.getExtension('vscode.git');

            if (!gitExtension) {
                logger.log('Git extension not found - skipping git change detection');
                return;
            }

            if (!gitExtension.isActive) {
                await gitExtension.activate();
            }

            const gitApi = gitExtension.exports?.getAPI?.(1) as GitAPI | undefined;

            if (!gitApi || typeof gitApi !== 'object') {
                logger.error('Failed to get git API object');
                return;
            }

            logger.log('Git API obtained successfully');

            gitApi.repositories.forEach((repo) => this.setupRepositoryListener(repo));
            context.subscriptions.push(gitApi.onDidOpenRepository((repo) => this.setupRepositoryListener(repo)));

            logger.log(`Git listener setup complete. Monitoring ${gitApi.repositories.length} repositories.`);
        } catch (error) {
            logger.error('Error setting up git listener', error);
        }
    }

    private setupRepositoryListener(repository: GitRepository): void {
        if (!repository || typeof repository !== 'object') return;

        let lastHead = repository.state.HEAD?.commit || repository.state.HEAD?.name;
        logger.log(`Monitoring repository at ${repository.rootUri.fsPath} (Initial HEAD: ${lastHead})`);

        repository.state.onDidChange(() => {
            const currentHead = repository.state.HEAD?.commit || repository.state.HEAD?.name;

            if (currentHead !== lastHead) {
                logger.log(`Git detected HEAD change in ${repository.rootUri.fsPath}: ${lastHead} -> ${currentHead}`);
                lastHead = currentHead;

                if (this.gitChangeDebounce) {
                    clearTimeout(this.gitChangeDebounce);
                }

                this.gitChangeDebounce = setTimeout(async () => {
                    logger.log(
                        `[Git Event] Head moved from ${lastHead} to ${currentHead}. Triggering full workspace refresh.`,
                    );
                    await this.onRepoChange();
                    logger.log('[Git Event] Workspace refresh finished.');
                }, 3000);
            }
        });
    }

    public dispose(): void {
        if (this.gitChangeDebounce) {
            clearTimeout(this.gitChangeDebounce);
        }
    }
}
