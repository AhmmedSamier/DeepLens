import * as vscode from 'vscode';

export class LoggingService {
    private outputChannel: vscode.OutputChannel;
    private static instance: LoggingService;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('DeepLens');
    }

    public static getInstance(): LoggingService {
        if (!LoggingService.instance) {
            LoggingService.instance = new LoggingService();
        }
        return LoggingService.instance;
    }

    public log(message: string): void {
        const timestamp = new Date().toLocaleTimeString();
        this.outputChannel.appendLine(`[${timestamp}] [INFO] ${message}`);
    }

    public error(message: string, error?: any): void {
        const timestamp = new Date().toLocaleTimeString();
        let errorMsg = message;
        if (error) {
            errorMsg += error instanceof Error ? ` - ${error.message}` : ` - ${String(error)}`;
        }
        this.outputChannel.appendLine(`[${timestamp}] [ERROR] ${errorMsg}`);
        if (error instanceof Error && error.stack) {
            this.outputChannel.appendLine(error.stack);
        }
        // Also show to user
        vscode.window.showErrorMessage(`DeepLens Error: ${message}`);
    }

    public warn(message: string): void {
        const timestamp = new Date().toLocaleTimeString();
        this.outputChannel.appendLine(`[${timestamp}] [WARN] ${message}`);
    }

    public show(): void {
        this.outputChannel.show();
    }
}

export const logger = LoggingService.getInstance();
