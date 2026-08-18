# Makes /layout-comp and the MCP tools usable from any workspace on this machine.
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
$skillSource = Join-Path $repo '.claude\skills\layout-comp\SKILL.md'
if (-not (Test-Path $skillSource)) {
    throw "Skill not found at $skillSource. Run this from the repository root."
}

$skillTarget = Join-Path $env:USERPROFILE '.claude\skills\layout-comp'
New-Item -ItemType Directory -Force $skillTarget | Out-Null
Copy-Item $skillSource $skillTarget -Force
Write-Host "skill    -> $skillTarget\SKILL.md"

# The skill was called rdlc-comp until it learned to preview Word layouts. Left in place, the old
# copy is still offered as a second, identical command, so remove it - but only if it is the copy
# this script made and nothing has been added beside it.
$legacySkill = Join-Path $env:USERPROFILE '.claude\skills\rdlc-comp'
if (Test-Path $legacySkill) {
    $contents = @(Get-ChildItem $legacySkill -Force)
    if ($contents.Count -eq 1 -and $contents[0].Name -eq 'SKILL.md') {
        Remove-Item $legacySkill -Recurse -Force
        Write-Host "skill    -> removed the superseded $legacySkill"
    } else {
        Write-Host "note     -> $legacySkill also defines a command and was left alone; delete it by hand." -ForegroundColor Yellow
    }
}

# 2. where this clone lives, so the skill can name the helper app and its version from anywhere
$configDir = Join-Path $env:USERPROFILE '.layout-comp'
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
$legacyConfigDir = Join-Path $env:USERPROFILE '.rdlc-comp'
if (Test-Path $legacyConfigDir) {
    Write-Host "note     -> $legacyConfigDir is superseded by $configDir and can be deleted." -ForegroundColor Yellow
    if (Test-Path (Join-Path $legacyConfigDir 'credentials.json')) {
        Write-Host '            its credentials.json was never read by anything; delete it too.' -ForegroundColor Yellow
    }
}

Write-Host ''
Write-Host 'Done. /layout-comp and the bc_* tools work in any workspace on this machine.'
Write-Host 'VS Code must be running with the extension enabled - it owns the credentials and the viewer.'
