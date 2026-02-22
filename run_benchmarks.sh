#!/bin/bash

# Create output directory
mkdir -p benchmark-results

# Define paths
ROOT_DIR=$(pwd)
LS_DIR="$ROOT_DIR/language-server"
VSCODE_DIR="$ROOT_DIR/vscode-extension"

# Track failures
EXIT_CODE=0

echo "=== Running Language Server Benchmarks ==="
cd "$LS_DIR"
export BENCHMARK_OUTPUT="$ROOT_DIR/benchmark-results/language-server.json"
if ! bun run benchmark; then
    echo "Language Server Benchmarks failed!"
    EXIT_CODE=1
fi

echo "Running Memory Benchmark..."
export BENCHMARK_OUTPUT="$ROOT_DIR/benchmark-results/language-server-memory.json"
if ! bun run benchmark:memory; then
    echo "Language Server Memory Benchmark failed!"
    EXIT_CODE=1
fi

echo "=== Running VS Code Extension Benchmarks ==="
cd "$VSCODE_DIR"
export BENCHMARK_OUTPUT="$ROOT_DIR/benchmark-results/vscode-extension.json"

if command -v xvfb-run >/dev/null 2>&1; then
    echo "Running with xvfb-run..."
    if ! xvfb-run -a bun run benchmark; then
        echo "VS Code Extension Benchmarks failed!"
        EXIT_CODE=1
    fi
else
    echo "Running directly..."
    if ! bun run benchmark; then
        echo "VS Code Extension Benchmarks failed!"
        EXIT_CODE=1
    fi
fi

echo "=== Generating Report ==="
cd "$ROOT_DIR"
export BENCHMARK_DIR="benchmark-results"
export REPORT_OUTPUT="benchmark_report.md"
if ! bun run scripts/generate_report.ts; then
    echo "Report generation failed!"
    EXIT_CODE=1
fi

echo "Done."
exit $EXIT_CODE
