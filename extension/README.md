# BC Report Layout Preview

Renders a Business Central report twice — once with a layout already published in the environment,
once with the layout file open in your workspace — and shows both PDFs side by side. Both are
produced by Business Central's own renderer, so what you compare is what **Save as PDF** in the
client would give you.

## Commands

| Command | What it does |
|---|---|
| **BC Layout Preview: Compare Layout with Environment** | Full run, asking for everything it needs. |
| **BC Layout Preview: Re-run Last Comparison** | Repeats the last run with no prompts. |
| **BC Layout Preview: Install or Update Helper App** | Publishes the server-side helper by hand. |
| **BC Layout Preview: Reset Saved Environment Settings** | Clears stored URLs and credentials. |

## Viewer modes

- **Side by side** — published layout left, workspace layout right.
- **Difference** — the two pages stacked with a difference blend. Identical output is black; anything
  that moved or changed lights up.
- **Environment only** / **Workspace only**.

See the repository README for architecture, build instructions and limitations.
