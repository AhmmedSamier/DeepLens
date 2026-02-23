Param()

$ErrorActionPreference = 'Stop'

# Determine root directory (directory of this script)
$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Create output directory
$benchmarkDir = Join-Path $rootDir 'benchmark-results'
if (-not (Test-Path $benchmarkDir)) {
    New-Item -ItemType Directory -Path $benchmarkDir | Out-Null
}

# Define paths
$lsDir = Join-Path $rootDir 'language-server'
$vscodeDir = Join-Path $rootDir 'vscode-extension'

# Track failures
$exitCode = 0

Write-Host '=== Running Language Server Benchmarks ==='
Push-Location $lsDir

$env:BENCHMARK_OUTPUT = Join-Path $benchmarkDir 'language-server.json'
bun run benchmark
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Language Server Benchmarks failed!'
    $exitCode = 1
}

Write-Host 'Running Memory Benchmark...'
$env:BENCHMARK_OUTPUT = Join-Path $benchmarkDir 'language-server-memory.json'
bun run benchmark:memory
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Language Server Memory Benchmark failed!'
    $exitCode = 1
}

Pop-Location

Write-Host '=== Running VS Code Extension Benchmarks ==='
Push-Location $vscodeDir

$env:BENCHMARK_OUTPUT = Join-Path $benchmarkDir 'vscode-extension.json'

Write-Host 'Running directly...'
bun run benchmark
if ($LASTEXITCODE -ne 0) {
    Write-Host 'VS Code Extension Benchmarks failed!'
    $exitCode = 1
}

Pop-Location

Write-Host '=== Generating Report ==='
Push-Location $rootDir

$env:BENCHMARK_DIR = 'benchmark-results'
$env:REPORT_OUTPUT = 'benchmark_report.md'
bun run scripts/generate_report.ts
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Report generation failed!'
    $exitCode = 1
}

Pop-Location

Write-Host 'Done.'
exit $exitCode
