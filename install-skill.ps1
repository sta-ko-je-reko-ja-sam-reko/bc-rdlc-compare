# Makes /rdlc-comp usable from any workspace on this machine.
#
# The skill itself lives in this repository, but Claude only loads project skills for the workspace
# that is open. Copying it to the personal skills folder makes it available in every BC project,
# and recording where this clone lives lets it find the helper app from anywhere.
#
#   .\install-skill.ps1
#
# Re-run it after changing the skill, to refresh the personal copy.

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

# 2. where this clone lives, so the skill can find the helper app and its version
$configDir = Join-Path $env:USERPROFILE '.rdlc-comp'
New-Item -ItemType Directory -Force $configDir | Out-Null

$configPath = Join-Path $configDir 'config.json'
$config = @{ repoPath = $repo } | ConvertTo-Json
[System.IO.File]::WriteAllText($configPath, $config, $utf8NoBom)
Write-Host "config   -> $configPath (repoPath = $repo)"

# 3. a credentials template, only if there is not one already
$credentialsPath = Join-Path $configDir 'credentials.json'
if (Test-Path $credentialsPath) {
    Write-Host "creds    -> $credentialsPath (left alone)"
} else {
    $template = @'
{
  "_comment": "One entry per environment, keyed by its launch configuration name, its environmentName, or its server host. On-premises entries use user/password. SaaS entries use clientId/clientSecret, or leave both empty to sign in with the Azure CLI.",

  "<launch config name of an on-prem server or container>": {
    "user": "",
    "password": ""
  },

  "<launch config name or environmentName of a SaaS environment>": {
    "clientId": "",
    "clientSecret": ""
  }
}
'@
    [System.IO.File]::WriteAllText($credentialsPath, $template, $utf8NoBom)
    Write-Host "creds    -> $credentialsPath (template written - fill it in)"
}

Write-Host ''
Write-Host 'Done. /rdlc-comp is now available in any workspace on this machine.'
Write-Host 'Remaining per environment: fill in credentials.json, and publish the helper app.'
