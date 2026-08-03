# Makes /rdlc-comp and the MCP tools usable from any workspace on this machine.
#
# The skill and the MCP server both live in this repository, but Claude only loads project skills
# for the workspace that is open. Copying the skill to the personal folder and registering the
# server at user scope makes both available in every BC project.
#
#   .\install-skill.ps1
#
# Re-run after changing the skill or rebuilding the server.

$ErrorActionPreference = 'Stop'

$repo = $PSScriptRoot
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

# 1. the skill, so it is available outside this repository
$skillSource = Join-Path $repo '.claude\skills\rdlc-comp\SKILL.md'
if (-not (Test-Path $skillSource)) {
    throw "Skill not found at $skillSource. Run this from the repository root."
}

$skillTarget = Join-Path $env:USERPROFILE '.claude\skills\rdlc-comp'
New-Item -ItemType Directory -Force $skillTarget | Out-Null
Copy-Item $skillSource $skillTarget -Force
Write-Host "skill    -> $skillTarget\SKILL.md"

# 2. where this clone lives, so the skill can name the helper app and its version from anywhere
$configDir = Join-Path $env:USERPROFILE '.rdlc-comp'
New-Item -ItemType Directory -Force $configDir | Out-Null

$configPath = Join-Path $configDir 'config.json'
[System.IO.File]::WriteAllText($configPath, (@{ repoPath = $repo } | ConvertTo-Json), $utf8NoBom)
Write-Host "config   -> $configPath (repoPath = $repo)"

# 3. the MCP server, registered for every workspace
$serverEntry = Join-Path $repo 'mcp-server\out\index.js'
if (-not (Test-Path $serverEntry)) {
    Write-Host "mcp      -> not built. Run: cd mcp-server; npm install; npm run build" -ForegroundColor Yellow
} elseif (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Host "mcp      -> the 'claude' CLI is not on PATH. Register it by hand:" -ForegroundColor Yellow
    Write-Host "            claude mcp add --scope user bc-rdlc-compare -- node `"$serverEntry`""
} else {
    try { claude mcp remove --scope user bc-rdlc-compare 2>$null | Out-Null } catch { }
    claude mcp add --scope user bc-rdlc-compare -- node $serverEntry
    Write-Host "mcp      -> registered as 'bc-rdlc-compare' (user scope)"
}

# Credentials are NOT stored here. They live in the VS Code secret store, entered once per
# environment by the extension. A leftover credentials.json from an earlier version is unused.
$legacyCredentials = Join-Path $configDir 'credentials.json'
if (Test-Path $legacyCredentials) {
    Write-Host "note     -> $legacyCredentials is no longer used and can be deleted." -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Done. /rdlc-comp and the bc_* tools work in any workspace on this machine.'
Write-Host 'VS Code must be running with the extension enabled - it owns the credentials and the viewer.'
