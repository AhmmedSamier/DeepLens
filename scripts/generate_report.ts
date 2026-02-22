import * as fs from 'node:fs';
import * as path from 'node:path';

const benchmarkDir = process.env.BENCHMARK_DIR || 'benchmark-results';
const outputFile = process.env.REPORT_OUTPUT || 'benchmark_report.md';

function formatDuration(ms: number): string {
    if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`;
    if (ms < 1000) return `${ms.toFixed(2)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

function formatMb(value: unknown): string {
    if (typeof value === 'number') return value.toFixed(2);
    if (typeof value === 'string') return value;
    return '';
}

function generateTable(title: string, data: any[]): string {
    if (!data || data.length === 0) return `\n### ${title}\n\nNo data available.\n`;

    let markdown = `\n### ${title}\n\n`;
    markdown += `| Benchmark | Average Time | Total Time |\n`;
    markdown += `| :--- | :---: | :---: |\n`;

    for (const item of data) {
        markdown += `| ${item.name} | ${formatDuration(item.avgMs)} | ${formatDuration(item.totalMs)} |\n`;
    }

    return markdown;
}

function generateMemoryTable(title: string, data: any[]): string {
    if (!data || data.length === 0) return `\n### ${title} (Memory)\n\nNo data available.\n`;

    let markdown = `\n### ${title} (Memory)\n\n`;
    markdown += `| Stage | RSS (MB) | Heap Total (MB) | Heap Used (MB) | External (MB) | Extra |\n`;
    markdown += `| :--- | ---: | ---: | ---: | ---: | :--- |\n`;

    for (const item of data) {
        const memory = item.memory || {};
        const extra = item.extra || {};

        const rss = formatMb(memory.rss ?? memory.rssMb ?? memory.rssMB);
        const heapTotal = formatMb(memory.heapTotal ?? memory.heapTotalMb ?? memory.heapTotalMB);
        const heapUsed = formatMb(memory.heapUsed ?? memory.heapUsedMb ?? memory.heapUsedMB);
        const external = formatMb(memory.external ?? memory.externalMb ?? memory.externalMB);

        let extraDisplay = '';
        if (extra && typeof extra === 'object' && Object.keys(extra).length > 0) {
            extraDisplay = Object.entries(extra)
                .map(([key, value]) => `${key}: ${String(value)}`)
                .join('<br>');
        }

        markdown += `| ${item.name} | ${rss} | ${heapTotal} | ${heapUsed} | ${external} | ${extraDisplay} |\n`;
    }

    return markdown;
}

async function main() {
    const reportParts: string[] = [];
    reportParts.push(`# DeepLens Benchmark Report\n`);
    reportParts.push(`Generated on: ${new Date().toISOString()}\n`);

    // Language Server
    const lsPath = path.join(benchmarkDir, 'language-server.json');
    if (fs.existsSync(lsPath)) {
        try {
            const lsData = JSON.parse(fs.readFileSync(lsPath, 'utf8'));
            reportParts.push(generateTable('Language Server', lsData));
        } catch (e) {
            console.error(`Error reading ${lsPath}:`, e);
            reportParts.push(`\n### Language Server\n\nError reading data.\n`);
        }
    } else {
        reportParts.push(`\n### Language Server\n\nNo benchmark results found at ${lsPath}.\n`);
    }

    // VS Code Extension
    const vscodePath = path.join(benchmarkDir, 'vscode-extension.json');
    if (fs.existsSync(vscodePath)) {
        try {
            const vscodeData = JSON.parse(fs.readFileSync(vscodePath, 'utf8'));
            reportParts.push(generateTable('VS Code Extension', vscodeData));
        } catch (e) {
            console.error(`Error reading ${vscodePath}:`, e);
            reportParts.push(`\n### VS Code Extension\n\nError reading data.\n`);
        }
    } else {
        reportParts.push(`\n### VS Code Extension\n\nNo benchmark results found at ${vscodePath}.\n`);
    }

    const lsMemoryPath = path.join(benchmarkDir, 'language-server-memory.json');
    if (fs.existsSync(lsMemoryPath)) {
        try {
            const lsMemoryData = JSON.parse(fs.readFileSync(lsMemoryPath, 'utf8'));
            reportParts.push(generateMemoryTable('Language Server', lsMemoryData));
        } catch (e) {
            console.error(`Error reading ${lsMemoryPath}:`, e);
            reportParts.push(`\n### Language Server (Memory)\n\nError reading data.\n`);
        }
    } else {
        reportParts.push(`\n### Language Server (Memory)\n\nNo memory benchmark results found at ${lsMemoryPath}.\n`);
    }

    const vscodeMemoryPath = path.join(benchmarkDir, 'vscode-extension-memory.json');
    if (fs.existsSync(vscodeMemoryPath)) {
        try {
            const vscodeMemoryData = JSON.parse(fs.readFileSync(vscodeMemoryPath, 'utf8'));
            reportParts.push(generateMemoryTable('VS Code Extension', vscodeMemoryData));
        } catch (e) {
            console.error(`Error reading ${vscodeMemoryPath}:`, e);
            reportParts.push(`\n### VS Code Extension (Memory)\n\nError reading data.\n`);
        }
    } else {
        reportParts.push(
            `\n### VS Code Extension (Memory)\n\nNo memory benchmark results found at ${vscodeMemoryPath}.\n`,
        );
    }

    const finalReport = reportParts.join('');

    fs.writeFileSync(outputFile, finalReport);
    console.log(finalReport); // Output to stdout
    console.log(`\nReport saved to ${outputFile}`);
}

main().catch(console.error);
