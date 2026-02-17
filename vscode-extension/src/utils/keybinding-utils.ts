import * as process from 'process';

/**
 * Format keybinding string into a cleaner, symbol-based representation
 * e.g., "Ctrl+Shift+T" -> "⌃⇧T" on macOS
 * e.g., "Ctrl+Shift+T" -> "Ctrl+Shift+T" on Windows/Linux
 *
 * @param shortcut The keybinding string
 * @param platform Optional platform override (for testing)
 */
export function formatKeybinding(shortcut: string, platform?: string): string {
    if (!shortcut) {
        return '';
    }

    const currentPlatform = platform || process.platform;
    const isMac = currentPlatform === 'darwin';

    if (isMac) {
        return shortcut
            .replace(/\bCtrl\b/g, '⌃')
            .replace(/\bShift\b/g, '⇧')
            .replace(/\bAlt\b/g, '⌥')
            .replace(/\bCmd\b/g, '⌘')
            .replace(/\bEnter\b/g, '⏎')
            .replace(/\+/g, '')
            .trim();
    }

    // For Windows/Linux, return as is (text-based is standard)
    // Just ensure Cmd is replaced by Ctrl if present (though usually Cmd implies Mac)
    return shortcut
        .replace(/\bCmd\b/g, 'Ctrl')
        .trim();
}
