import * as vscode from 'vscode';
import * as path from 'path';

export class FileIconProvider {
    private static readonly extMap = new Map<string, string>([
        ['.ts', 'file-code'],
        ['.tsx', 'file-code'],
        ['.js', 'file-code'],
        ['.jsx', 'file-code'],
        ['.json', 'json'],
        ['.md', 'markdown'],
        ['.html', 'file-code'],
        ['.css', 'file-code'],
        ['.zip', 'file-zip'],
        ['.tar', 'file-zip'],
        ['.gz', 'file-zip'],
        ['.pdf', 'file-pdf'],
        ['.png', 'file-media'],
        ['.jpg', 'file-media'],
        ['.jpeg', 'file-media'],
        ['.gif', 'file-media'],
        ['.svg', 'file-media'],
        ['.mp4', 'file-media'],
        ['.mp3', 'file-media'],
        ['.wav', 'file-media'],
        ['.py', 'file-code'],
        ['.go', 'file-code'],
        ['.java', 'file-code'],
        ['.c', 'file-code'],
        ['.cpp', 'file-code'],
        ['.h', 'file-code'],
        ['.hpp', 'file-code'],
        ['.cs', 'file-code'],
        ['.rb', 'file-code'],
        ['.php', 'file-code'],
    ]);

    private static readonly fileMap = new Map<string, string>([
        ['package.json', 'json'],
        ['tsconfig.json', 'json'],
        ['readme.md', 'markdown'],
    ]);

    public static getIcon(filePath: string): vscode.ThemeIcon {
        const basename = path.basename(filePath).toLowerCase();

        if (this.fileMap.has(basename)) {
            return new vscode.ThemeIcon(this.fileMap.get(basename)!);
        }

        const ext = path.extname(basename);
        if (this.extMap.has(ext)) {
            return new vscode.ThemeIcon(this.extMap.get(ext)!);
        }

        return new vscode.ThemeIcon('file');
    }
}
