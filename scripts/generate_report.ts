import * as fs from 'fs';
import * as path from 'path';

const benchmarkDir = process.env.BENCHMARK_DIR || 'benchmark-results';
const outputFile = process.env.REPORT_OUTPUT || 'benchmark_report.md';

function formatDuration(ms: number): string {
    if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`;
    if (ms < 1000) return `${ms.toFixed(2)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
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

    const finalReport = reportParts.join('');

    fs.writeFileSync(outputFile, finalReport);
    console.log(finalReport); // Output to stdout
    console.log(`\nReport saved to ${outputFile}`);
}

main().catch(console.error);
