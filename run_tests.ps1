# Test runner for DeepLens project
# This script runs only the language-server tests, excluding VS Code extension tests

Write-Host "Running Language Server tests..." -ForegroundColor Cyan
Set-Location language-server
bun test
