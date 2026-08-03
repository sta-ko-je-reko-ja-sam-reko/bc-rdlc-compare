---
name: release
description: Build, package and install a new version of the helper app and the VS Code extension. Use whenever AL or TypeScript has changed and the result needs to reach VS Code or a Business Central environment — "rebuild", "reinstall", "ship it", "new version".
---

# Release

Builds both halves in the only order that works, and installs the result. Run from the repository
root.

## 1. Decide what changed

| Changed | Bump |
|---|---|
| Anything under `bc-app/src` or `bc-app/app.json` | `bc-app/app.json` **and** `extension/package.json` |
| Only `extension/` | `extension/package.json` |

Always bump `extension/package.json` — `--force` installs of an unchanged version appear to succeed
but leave the old code running.

Write both files with `[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding $false))`.
**`Set-Content -Encoding utf8` adds a BOM and breaks `vsce`.**

## 2. Build the helper — always before the extension

```powershell
$proj = "<repo>\bc-app"
Get-ChildItem $proj -Filter "*.app" | Remove-Item -Force
$m   = Get-Content "$proj\app.json" -Raw | ConvertFrom-Json
$out = "{0}_{1}_{2}.app" -f $m.publisher, $m.name, $m.version
$alc = (Get-ChildItem "$env:USERPROFILE\.vscode\extensions\ms-dynamics-smb.al-*\bin\win32\alc.exe" |
        Select-Object -Last 1).FullName
& $alc "/project:$proj" "/packagecachepath:$proj\.alpackages" "/out:$proj\$out"
```

Deleting the old `.app` first matters: the packaging step takes the *newest* `.app` in `bc-app\`, and
a leftover makes it ambiguous.

If symbols are missing, run *AL: Download Symbols* against a matching-version environment first.

## 3. Build, package and install the extension

```powershell
cd "<repo>\extension"
npm run build     # copies pdf.js + the newest .app, regenerates resources/helper-info.json
npx --yes @vscode/vsce package --allow-missing-repository --skip-license
& "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd" `
    --install-extension "<repo>\extension\bc-report-layout-preview-<version>.vsix" --force
```

Check the build output names the `.app` you just compiled:

```
helper source: matr_BC Report Layout Preview_1.0.0.8.app
wrote resources/helper-info.json (name "…", route /RepLayoutPreview/layoutPreview/v1.0)
```

If it names an older file, step 2 did not run or the delete was skipped.

## 4. Tell the user what they must do

Neither can be done for them:

- **Reload the VS Code window** — the new extension is not active until they do.
- **Update the app in Business Central** — via the extension's update prompt, *Install or Update
  Helper App*, or by hand.

If `publisher`, `name` or object ids changed in `bc-app`, the app must be **uninstalled** in BC
first; BC will not upgrade across those.

## 5. Verify

Report the versions actually produced, not the ones intended. If several extension identities may be
installed, check which is live:

```powershell
& "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd" --list-extensions
```

Two ids matching `bc-report-layout-preview` means an old identity is still registered and may be
answering instead of the new one. Uninstall it by id.
