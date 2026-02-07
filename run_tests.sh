#!/usr/bin/env bash
# Test runner for DeepLens project
# This script runs only the language-server tests, excluding VS Code extension tests

echo "Running Language Server tests..."
cd language-server && bun test
