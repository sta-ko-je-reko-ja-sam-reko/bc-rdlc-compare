# BC Report Layout Preview

A VS Code extension that renders a Business Central report twice — once with a layout published in
the environment, once with the layout file in the workspace — and shows both PDFs side by side.
Both come from BC's own renderer via `Report.SaveAs`.

Two halves, and a change to one usually means rebuilding both:

| Path | What |
|---|---|
| `bc-app/` | AL helper. Publisher `matr`, namespace `RepLayoutPreview`, objects **74750-74759**, API route `/api/RepLayoutPreview/layoutPreview/v1.0/` |
| `extension/` | TypeScript. Extension identity `matr.bc-report-layout-preview` |

This is **matr's own product**, not client work. No client's name, abbreviation or server hostname
may appear anywhere — not in namespaces, example report ids, or UI placeholder text. This repository
is public, so the rule covers commit messages and documentation as much as code.

## The release loop

Order matters. `npm run build` copies the newest `.app` out of `bc-app/`, so the AL is always built
first.

1. Bump `version` in `bc-app/app.json` — if any AL changed
2. Delete `bc-app/*.app`, compile as `Publisher_Name_Version.app`
3. Bump `version` in `extension/package.json` — always, or `--force` installs silently do nothing
4. `npm run build` — regenerates `resources/` and `resources/helper-info.json`
5. `npx @vscode/vsce package --allow-missing-repository --skip-license`
6. `code --install-extension <vsix> --force`
7. Reload the VS Code window, then update the app in BC

The `/release` skill does all of this.

### Traps in that loop

- **Never write `package.json` or `app.json` with PowerShell `Set-Content -Encoding utf8`.** It adds
  a BOM and `vsce` fails with "not a valid JSON file". Use
  `[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding $false))`.
- **The extension publishes the `.app` bundled inside its own VSIX**, at `extension/resources/`,
  never the one in `bc-app/`. Changing the AL has no effect on any environment until the extension
  is rebuilt, repackaged and reinstalled.
- **Changing `publisher` in `extension/package.json` forks the extension identity.** VS Code installs
  the new one *alongside* the old, both register the same commands, the old one may win, and stored
  credentials and settings are lost because they are per-identity. Uninstall the old id explicitly.
- **Changing `publisher`, `name` or object ids in `bc-app`** means uninstalling the app in BC first —
  BC will not upgrade across those. Version-only changes upgrade in place.

## Hard constraints

These cost hours to find. Treat a change that violates one as a defect.

- **A `[TryFunction]` cannot contain a database write.** The render path inserts a scratch
  `Tenant Report Layout` row, so it cannot be wrapped for error capture — render failures surface as
  HTTP 400 carrying BC's message. `Codeunit.Run()` is the only construct that catches *and* writes;
  reintroducing a codeunit for that is a deliberate trade, not a cleanup.
- **The helper is matched by app name alone.** Publisher and version are read but never compared —
  both change in practice.
- **App name and API route are generated from `bc-app` at build time** by `scripts/copy-assets.js`
  into `resources/helper-info.json`. Never hardcode either in TypeScript; the constants in
  `helperApp.ts` are fallbacks for a missing file, nothing more.
- **The extension addresses BC objects only by API route**, never by object id. Renumbering the AL
  must not require a TypeScript change.
- **Multitenant on-premises servers need `tenant=` on every call**, including the dev-endpoint
  publish. Omitting it fails as **401**, which reads as bad credentials and is not.
- **BC containers ship without Segoe UI.** Uploading an RDLC that names it fails validation until
  `Add-FontsToBcContainer` has run.

## Conventions

**AL** — no inline `//` comments; `/// <summary>` on global procedures only, describing behaviour;
`_` prefix on procedure parameters; labels as `var` `Label` variables; full names, no abbreviations.
The API surface is **API pages, not codeunits** — that is a design decision, not an accident.

**TypeScript** — `strict`, no `any` where it can be avoided. Errors must carry the URL that failed:
a bare status code cost three rounds of guessing whether a 401 came from the API or the dev endpoint.
Never claim in a message that something was done unless the code path guarantees it.

## Testing

Smoke test, works on any environment: report **101** (Customer - List), table **18**, no filter, no
request page options, **Default layout**. It needs no custom objects and no mandatory options.

Verified end to end against an on-premises multitenant BC 27 container. **Not verified on SaaS** —
Entra authentication and the automation-API upload have never run. Do not describe them as working.

## Before reporting work finished

1. Both halves compile — `alc.exe` for `bc-app`, `npm run build` for `extension`.
2. Version bumped in whichever half changed.
3. No client name, abbreviation or server hostname anywhere — grep the repository for whichever
   client you are working for. Only `media/pdfjs` may contain unrelated matches.
4. No hardcoded API route or app name in TypeScript outside the `helperApp.ts` fallbacks.
5. `README.md` updated if setup, behaviour or troubleshooting changed.
