import * as fs from 'fs';
import * as path from 'path';

/**
 * Log levels for the logging service
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NONE = 4,
}

/**
 * Logger interface for different output targets
 */
interface LogOutput {
    write(level: LogLevel, message: string): void;
}

/**
 * Console logger implementation
 */
class ConsoleLogger implements LogOutput {
    write(level: LogLevel, message: string): void {
        const timestamp = new Date().toISOString();
        const levelStr = LogLevel[level];
        const formattedMessage = `[${timestamp}] [${levelStr}] ${message}`;

        switch (level) {
            case LogLevel.ERROR:
                console.error(formattedMessage);
                break;
            case LogLevel.WARN:
                console.warn(formattedMessage);
                break;
            default:
                console.log(formattedMessage);
        }
    }
}

/**
 * File logger implementation
 */
class FileLogger implements LogOutput {
    constructor(private filePath: string) {}

    write(level: LogLevel, message: string): void {
        const timestamp = new Date().toISOString();
        const levelStr = LogLevel[level];
        const formattedMessage = `[${timestamp}] [${levelStr}] ${message}\n`;

        try {
            fs.appendFileSync(this.filePath, formattedMessage);
        } catch (error) {
            // Silently fail if we can't write to file
            console.error(`Failed to write to log file: ${error}`);
        }
    }
}

/**
 * LSP Connection logger implementation (for language server)
 */
class ConnectionLogger implements LogOutput {
    constructor(private connection: { console: { log: (msg: string) => void; error: (msg: string) => void } }) {}

    write(level: LogLevel, message: string): void {
        const levelStr = LogLevel[level];
        const formattedMessage = `[${levelStr}] ${message}`;

        if (level >= LogLevel.ERROR) {
            this.connection.console.error(formattedMessage);
        } else {
            this.connection.console.log(formattedMessage);
        }
    }
}

/**
 * Unified logging service for DeepLens
 * Supports multiple output targets and log levels
 */
export class Logger {
    private static instance: Logger;
    private outputs: LogOutput[] = [];
    private minLevel: LogLevel = LogLevel.INFO;

    private constructor() {}

    /**
     * Get the singleton logger instance
     */
    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * Set the minimum log level
     */
    setLevel(level: LogLevel): void {
        this.minLevel = level;
    }

    /**
     * Add console output
     */
    addConsoleOutput(): void {
        this.outputs.push(new ConsoleLogger());
    }

    /**
     * Add file output
     */
    addFileOutput(filePath: string): void {
        // Ensure directory exists
        const dir = path.dirname(filePath);
        try {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            this.outputs.push(new FileLogger(filePath));
        } catch (error) {
            console.error(`Failed to create file logger: ${error}`);
        }
    }

    /**
     * Add LSP connection output
     */
    addConnectionOutput(connection: { console: { log: (msg: string) => void; error: (msg: string) => void } }): void {
        this.outputs.push(new ConnectionLogger(connection));
    }

    /**
     * Clear all outputs
     */
    clearOutputs(): void {
        this.outputs = [];
    }

    /**
     * Log a debug message
     */
    debug(message: string): void {
        this.log(LogLevel.DEBUG, message);
    }

    /**
     * Log an info message
     */
    info(message: string): void {
        this.log(LogLevel.INFO, message);
    }

    /**
     * Log a warning message
     */
    warn(message: string): void {
        this.log(LogLevel.WARN, message);
    }

    /**
     * Log an error message
     */
    error(message: string, error?: Error): void {
        let fullMessage = message;
        if (error) {
            fullMessage += ` - ${error.message}`;
            if (error.stack) {
                fullMessage += `\n${error.stack}`;
            }
        }
        this.log(LogLevel.ERROR, fullMessage);
    }

    /**
     * Internal log method
     */
    private log(level: LogLevel, message: string): void {
        if (level < this.minLevel) {
            return;
        }

        for (const output of this.outputs) {
            try {
                output.write(level, message);
            } catch (error) {
                // Silently fail if output fails
            }
        }
    }
}

/**
 * Create a scoped logger with a prefix
 */
export function createLogger(scope: string): {
    debug: (msg: string) => void;
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string, err?: Error) => void;
} {
    const logger = Logger.getInstance();
    return {
        debug: (msg: string) => logger.debug(`[${scope}] ${msg}`),
        info: (msg: string) => logger.info(`[${scope}] ${msg}`),
        warn: (msg: string) => logger.warn(`[${scope}] ${msg}`),
        error: (msg: string, err?: Error) => logger.error(`[${scope}] ${msg}`, err),
    };
}
