import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as path from 'path';

// Find the .vsix file in the current directory (which should be vscode-extension)
const currentDir = process.cwd();
const files = fs.readdirSync(currentDir);
const vsixFile = files.find(f => f.endsWith('.vsix'));

if (!vsixFile) {
    console.error('No VSIX file found in the current directory!');
    process.exit(1);
}

const vsixPath = path.join(currentDir, vsixFile);
console.log(`Found VSIX: ${vsixPath}`);

try {
    const zip = new AdmZip(vsixPath);
    const entries = zip.getEntries();
    let updated = false;

    for (const entry of entries) {
        // Check if the entry is in the bin directory
        // The path in the zip usually starts with 'extension/'
        const entryName = entry.entryName;

        // We are looking for binaries in extension/dist/bin/ or extension/bin/
        // Depending on how vsce packages it. Based on copy-artifacts.ts, it copies to dist/bin.
        // vsce normally puts everything under 'extension/' root folder in the zip.

        if (entryName.match(/^extension\/dist\/bin\//) && !entry.isDirectory) {
            // Skip .exe, .dll, .txt, etc. if we only want to target unix binaries
            // But rg.exe on Windows doesn't hurt to have 755 (it's ignored usually)
            // However, to be precise, let's target specific files or exclude extensions.

            const ext = path.extname(entryName).toLowerCase();
            if (ext === '.exe' || ext === '.dll') {
                continue;
            }

            console.log(`Setting executable permission for: ${entryName}`);

            // Unix permissions are stored in the top 16 bits of the external file attribute
            // 0o755 = rwxr-xr-x
            // 0o100000 = regular file
            // Total mode = 0o100755
            const mode = 0o100755;

            // attr = (mode << 16) | (existing_dos_attr)
            // Preserve the lower 16 bits (DOS attributes) just in case
            const newAttr = (mode << 16) | (entry.header.attr & 0xFFFF);

            entry.header.attr = newAttr;

            // Ensure platform is set to Unix (3) in the "version made by" field
            // The upper byte is the OS code (3 = Unix), lower byte is zip spec version (e.g. 20 = 2.0)
            entry.header.made = 0x0314;

            updated = true;
        }
    }

    if (updated) {
        console.log('Writing updated VSIX...');
        zip.writeZip(vsixPath);
        console.log('VSIX permissions updated successfully.');
    } else {
        console.log('No binaries found to update.');
    }

} catch (err) {
    console.error('Error updating VSIX permissions:', err);
    process.exit(1);
}
