#!/bin/bash

# Exit on error
set -e

# Create output directory
mkdir -p benchmark-results

# Define paths
ROOT_DIR=$(pwd)
LS_DIR="$ROOT_DIR/language-server"
VSCODE_DIR="$ROOT_DIR/vscode-extension"

echo "=== Running Language Server Benchmarks ==="
cd "$LS_DIR"
export BENCHMARK_OUTPUT="$ROOT_DIR/benchmark-results/language-server.json"
bun run benchmark

echo "=== Running VS Code Extension Benchmarks ==="
cd "$VSCODE_DIR"
export BENCHMARK_OUTPUT="$ROOT_DIR/benchmark-results/vscode-extension.json"

if command -v xvfb-run >/dev/null 2>&1; then
    echo "Running with xvfb-run..."
    xvfb-run -a bun run benchmark
else
    echo "Running directly..."
    bun run benchmark
fi

echo "=== Generating Report ==="
cd "$ROOT_DIR"
export BENCHMARK_DIR="benchmark-results"
export REPORT_OUTPUT="benchmark_report.md"
bun run scripts/generate_report.ts

echo "Done."
