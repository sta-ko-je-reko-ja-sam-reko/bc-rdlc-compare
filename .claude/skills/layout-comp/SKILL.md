---
name: layout-comp
description: Compare a Business Central report layout against what is published in an environment, driven by a free-form description instead of VS Code prompts. Use for "/layout-comp <anything>", "compare this layout", "render this report with my changes", "diff the layout against dev". Handles RDLC and Word layouts. Works in any BC workspace, on premises or SaaS, for Microsoft, partner or custom reports.
---

# layout-comp

The user describes what they want compared in plain language. Your job is to turn that into
arguments for the `bc_*` tools. The tools do the work and open the result in the extension's own
side-by-side viewer — **nothing is written to disk and no PDF is downloaded**.

Example input:

> `/layout-comp unstaged changes on the released production order report with default layout, filter
> released after 01.01.2026 and the custom boolean set to true, on dev env`

## How the pieces fit

The MCP server does no Business Central work itself. It relays jobs to the VS Code extension, which
holds the credentials and owns the viewer. So:

- **VS Code must be open with the extension enabled.** If a tool reports no answer, that is the
  cause — not a Business Central problem. The error says which of the two it is, because it looks at
  the disk:
  - *not installed* → run **`bc_rebuild_tooling`**, which builds and installs it from this server
    without needing the extension, then have the user reload the VS Code window
  - *installed but silent* → the window has not been reloaded since it was installed, or a prompt is
    waiting in it

  `bc_rebuild_tooling` is the bootstrap for a machine that has the repository but has never built
  the extension. It needs AL symbols downloaded for `bc-app` first, otherwise the helper compile
  fails.
- **Never ask for a password or a client secret.** The extension prompts for credentials itself,
  once per environment, and stores them in the VS Code secret store.

**The first call against a new environment may pause**, because the extension is showing a prompt in
the VS Code window: a user name and password on premises, or a Microsoft account sign-in on SaaS
where no `saas.clientId`/`clientSecret` is configured. Tell the user to look at the VS Code window
and answer it. Nothing is wrong; the tool waits several minutes for exactly this.

On SaaS with no client secret this delegated sign-in is the normal path and needs no Entra app. If
it comes back **`AADSTS65001`**, the tenant has not consented VS Code's client id for the Business
Central API — that is when service-to-service credentials are needed, and the README documents the
registration.

## Resolve, in this order

Ask only about what you genuinely cannot determine, and say what you assumed.

### 1. The environment

`bc_list_environments` returns every launch configuration in the open workspace. Match the user's
words against the names — "dev", "prod copy", "container", "sandbox". One obvious match, use it;
two plausible ones, ask. Everything downstream takes this `configName`.

### 2. The helper

`bc_check_helper`. If it is missing, **offer to publish it** — `bc_publish_helper` installs the
version bundled with the extension. Ask first: it changes the environment.

Two cases where you cannot: a **SaaS production** environment, which must go through the admin
centre, and an environment the user has no rights to publish in. In both, name the `.app` instead —
`repoPath` in `%USERPROFILE%\.layout-comp\config.json` points at the clone and the file is in its
`bc-app\` folder.

If the installed version is older than the bundled one, say so and continue: an older helper still
renders, but `bc_search_fields` needs **1.0.0.9** or later, so offer `bc_publish_helper` when the
filter needs a field lookup.

### 3. The candidate layout — a local file

| The user said | Do |
|---|---|
| "unstaged changes", "my changes" | `git status --porcelain` → modified `*.rdlc`, `*.rdl`, `*.docx` |
| an `.xlsx` | not comparable — both sides render to PDF and BC cannot save a report to PDF with an Excel layout |
| a report or file name | search the workspace for the layout file |
| nothing identifiable | list the workspace's layouts and ask |

Never guess between two changed layouts. `bc_compare_layout` needs an absolute path.

### 4. The report and its main dataitem

- **Source in the workspace** — find the AL object whose `rendering` section names the layout file;
  read its id and its first `dataitem(Name; Table)`, then resolve the table with `bc_search_tables`.
- **No source** (Microsoft or a partner app) — the user must name the report or give its id. State
  the id you assumed rather than proceeding silently.

### 5. The filter

`bc_search_fields` lists every field of a table, including ones whose source you cannot read — pass
`typeName` to narrow it, e.g. `Boolean` for "some custom flag". If several candidates match, show
them with their captions and ask.

Pass the result as `filterText`: `field=filter` pairs separated by semicolons, e.g.
`Status=Released;Starting Date=>2026-01-01`. Prefer unambiguous date forms; the server's locale is
not yours.

### 6. The baseline

Omit `baselineLayoutName` for the environment's current selection. If the user named a published
layout, find it with `bc_list_report_layouts` and pass its `name` and `applicationId`.

### 7. Request page options

Only if the report needs them. These are request page *control* names, not dataitem fields, and
cannot be discovered from the server — read them from the AL source, or ask.

## Then compare

Call `bc_compare_layout`. The viewer opens in VS Code with **Side by side**, **Difference**, and
single-pane modes. Tell the user briefly:

- which environment, company, report and filter were used, and anything you assumed
- that the viewer is open, and that **Difference** is the mode for spotting moved or overlapping
  content
- the two document sizes the tool reports, as a crude signal that the layouts differ at all

## Report honestly

Name the environment you hit and any default you picked. If a render failed, give Business Central's
message rather than a paraphrase — it is usually precise about a missing request page option, an
invalid filter field, or a missing font.
