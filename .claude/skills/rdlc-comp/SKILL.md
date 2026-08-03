---
name: rdlc-comp
description: Compare a Business Central report layout against what is published in an environment, driven by a free-form description instead of VS Code prompts. Use for "/rdlc-comp <anything>", "compare this layout", "render this report with my changes", "diff the layout against dev". Works in any BC workspace, on premises or SaaS, for Microsoft, partner or custom reports.
---

# rdlc-comp

The user describes what they want compared in plain language. Resolve every unknown yourself, call
the helper's API directly, and show them the result. Do **not** send them to VS Code commands — the
whole point is avoiding those.

**This skill normally runs in an unrelated BC workspace**, not in its own repository. Anything it
needs about itself comes from `%USERPROFILE%\.rdlc-comp\config.json`:

```json
{ "repoPath": "C:\\...\\bc-rdlc-compare" }
```

That is where the helper app and its `app.json` live — use it whenever you need the `.app` path or
the current helper version. If the file is missing, the user has not run `install-skill.ps1` from
the clone; say so, and fall back to naming the app without a path.

Example input:

> `/rdlc-comp unstaged changes on the released production order report with default layout, filter
> released after 01.01.2026 and the custom boolean set to true, on dev env`

## Resolve, in this order

Ask only about things you genuinely cannot determine. State what you assumed.

### 1. The candidate layout — a local file

| The user said | Do |
|---|---|
| "unstaged changes", "my changes" | `git status --porcelain` → modified `*.rdlc`, `*.rdl`, `*.docx` |
| a report or file name | search the workspace for the layout file |
| nothing identifiable | list layouts in the workspace and ask |

If more than one matches, list them and ask. Never guess between two changed layouts.

### 2. The environment

Read every `**/.vscode/launch.json` (JSONC — it will contain comments). Match the user's words
against configuration names and `environmentName`: "dev", "prod copy", "container", "sandbox". One
obvious match, use it. Two plausible matches, ask.

`environmentType: OnPrem` (or a `server` field) means on premises; `Sandbox`/`Production` means
SaaS. This decides authentication — see *Calling the API*.

### 3. Check the helper is installed — before doing any more work

As soon as the environment and credentials are known, and **before** resolving reports, fields or
filters, confirm the helper is there. Everything downstream depends on it, and finding out late
wastes the user's time.

```
GET {root}/api/microsoft/automation/v2.0/companies({id})/extensions
```

Match on `displayName` equal to the app name in `bc-app/app.json` — **name only**, ignoring publisher
and version, since both change. If the automation API is not readable, fall back to probing the
route: `GET {api}/reportLayouts?$top=1`, where **404** means not installed.

**If it is missing**, stop and tell the user plainly, with the actual path and version:

> The layout preview helper is not installed in *&lt;environment&gt;*. Publish
> `{repoPath}\bc-app\<the .app file>` first — publish it from VS Code with the AL extension, or
> upload it in the admin centre for a SaaS production environment. Then ask me again.

Give the real path from `config.json` and the real file name from `bc-app\`, not a placeholder. If
there is no `.app` in `bc-app\`, it has not been compiled — say that instead.

Do not attempt to publish it yourself. On premises that needs the dev endpoint; on SaaS production
it is not allowed at all.

**If it is older than `bc-app/app.json`**, say so and name the version installed. An older helper
still renders, so continue — but `bcFields` only exists from **1.0.0.9**, so if the filter needs a
field lookup and the installed version predates it, the user must update before that will work.

### 4. The report id and its main dataitem

- **Source in the workspace** — find the AL object whose `rendering` section names the layout file;
  read its id and its first `dataitem(Name; Table)`.
- **No source** (Microsoft or a partner app) — the user must name the report, or give its id. Report
  ids for standard reports are well known; confirm your assumption in the message rather than
  silently proceeding.
- Resolve the dataitem table name to an id through `bcObjects`.

### 5. The filter

Turn the description into a BC view string. Field names come from `bcFields`, which exposes every
field of a table including ones whose source you cannot see:

```
GET {api}/bcFields?$filter=tableNo eq 5405 and typeName eq 'Boolean'
```

That is how "some custom boolean field" becomes a real field name. If several candidates match,
show them with their captions and ask which.

Dates: BC filter syntax, not the user's locale — `>01.01.2026` may need to be `>2026-01-01`
depending on the server. Prefer the unambiguous form.

Result shape: `WHERE(Status=FILTER(Released),Starting Date=FILTER(>2026-01-01))`

### 6. The baseline

Default is the environment's currently selected layout — send an empty `layoutName`. If the user
named a specific published layout, look it up in `reportLayouts` and pass its `name` and
`applicationId`.

### 7. Request page options

Only if the report needs them. These are the request page *control* names, not dataitem fields, and
they cannot be discovered from the server — ask, or read them from the AL source when available.

## Calling the API

Base URL:

- **On premises** — `{server}:{odataPort}/{instance}/api/RepLayoutPreview/layoutPreview/v1.0/companies({id})`,
  plus `?tenant={tenant}` on **every** call. Omitting the tenant on a multitenant server fails as
  401, not 400.
- **SaaS** — `https://api.businesscentral.dynamics.com/v2.0/{tenant}/{environment}/api/RepLayoutPreview/layoutPreview/v1.0/companies({id})`

Company ids come from `{root}/api/v2.0/companies`.

### Credentials

Never ask the user to type a password into the chat. Read them from
`$env:USERPROFILE\.rdlc-comp\credentials.json`, which sits outside every repository:

```jsonc
{
  "replay28": { "user": "admin", "password": "…" },
  "BE-terna_DEV": { "clientId": "…", "clientSecret": "…" }
}
```

Keyed by launch configuration name, `environmentName`, or server host. If the entry is missing, tell
the user exactly what to add and stop — do not prompt for the secret in conversation.

On premises use `Basic base64(user:password)`. On SaaS request a token from
`https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` with
`scope=https://api.businesscentral.dynamics.com/.default`, or use
`az account get-access-token --resource https://api.businesscentral.dynamics.com` if the user has
the Azure CLI signed in and no secret is stored.

### The render sequence

Twice — once for the baseline, once for the candidate. Everything is PowerShell; no VS Code commands.

```
POST   layoutPreviewRequests                        { reportId, tableId, layoutName, applicationId,
                                                      layoutFormat, filterView, requestPageXml }
POST   layoutPreviewRequests({id})/Microsoft.NAV.setLayout   { "content": "<base64>" }   ← candidate only
POST   layoutPreviewRequests({id})/Microsoft.NAV.render      {}
POST   layoutPreviewRequests({id})/Microsoft.NAV.getPdf      {}   → { "value": "<base64 pdf>" }
DELETE layoutPreviewRequests({id})
```

Bound actions need `If-Match: *`. Always `DELETE`, including after a failure.

A failed render returns **HTTP 400** carrying BC's own message — surface it verbatim; it is usually
precise (a missing mandatory request page option, an invalid filter field, a missing font).

A 404 on any of these means the helper vanished between the pre-flight check and the render — say so
rather than reporting a render failure.

## Show the result

Write both PDFs to a scratch folder with names that say which is which — `published.pdf`,
`workspace.pdf` — and open them. Then tell the user, in one short paragraph:

- which environment, company, report and filter were used, and anything you assumed
- page counts, and whether they differ
- file sizes, as a crude signal that the layouts produced different output

If the user asks what changed and the difference is not obvious from the documents, offer the VS
Code extension's **Difference** view for a visual blend — that is the one thing this skill cannot do
in the terminal.

## Report honestly

Say which environment you hit and what you assumed. If you could not resolve something and picked a
default, say which default. If a render failed, give BC's message rather than a paraphrase.
