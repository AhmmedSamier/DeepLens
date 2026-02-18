param(
    [string]$SonarToken
)

if (-not $SonarToken) {
    if ($env:SONAR_TOKEN) {
        $SonarToken = $env:SONAR_TOKEN
    } else {
        Write-Error "Please provide -SonarToken or set SONAR_TOKEN environment variable."
        exit 1
    }
}

Write-Host "Running language-server tests with coverage..." -ForegroundColor Cyan
Push-Location "language-server"
try {
    bun run test:coverage
} finally {
    Pop-Location
}

Write-Host "Running vscode-extension tests with coverage..." -ForegroundColor Cyan
Push-Location "vscode-extension"
try {
    bun run test:coverage
} finally {
    Pop-Location
}

Write-Host "Running SonarQube analysis..." -ForegroundColor Cyan
& sonar-scanner `
    -D"sonar.token=$SonarToken"

