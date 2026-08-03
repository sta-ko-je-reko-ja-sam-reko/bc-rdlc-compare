import * as vscode from 'vscode';

export interface ComparisonDocuments {
    title: string;
    subtitle: string;
    beforeLabel: string;
    afterLabel: string;
    beforePdf: Buffer;
    afterPdf: Buffer;
}

let currentPanel: vscode.WebviewPanel | undefined;

function nonce(): string {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function writeTempPdf(context: vscode.ExtensionContext, name: string, contents: Buffer): Promise<vscode.Uri> {
    const directory = context.globalStorageUri;
    await vscode.workspace.fs.createDirectory(directory);
    const target = vscode.Uri.joinPath(directory, name);
    await vscode.workspace.fs.writeFile(target, contents);
    return target;
}

function renderHtml(
    webview: vscode.Webview,
    context: vscode.ExtensionContext,
    documents: ComparisonDocuments,
    beforeUri: vscode.Uri,
    afterUri: vscode.Uri,
): string {
    const media = (...segments: string[]) =>
        webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', ...segments));

    const scriptNonce = nonce();
    const csp = [
        "default-src 'none'",
        `img-src ${webview.cspSource} data: blob:`,
        `script-src 'nonce-${scriptNonce}' ${webview.cspSource} 'unsafe-eval'`,
        `style-src ${webview.cspSource} 'unsafe-inline'`,
        `worker-src ${webview.cspSource} blob:`,
        `font-src ${webview.cspSource}`,
        `connect-src ${webview.cspSource} blob: data:`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${media('viewer.css')}">
<title>${documents.title}</title>
</head>
<body>
<header class="toolbar">
  <div class="titles">
    <strong>${documents.title}</strong>
    <span class="subtitle">${documents.subtitle}</span>
  </div>
  <div class="controls">
    <div class="segmented" role="group" aria-label="View mode">
      <button data-mode="side" class="active">Side by side</button>
      <button data-mode="difference">Difference</button>
      <button data-mode="before">Environment only</button>
      <button data-mode="after">Workspace only</button>
    </div>
    <div class="pager">
      <button id="prev" title="Previous page">&#8249;</button>
      <span id="pageLabel">1 / 1</span>
      <button id="next" title="Next page">&#8250;</button>
    </div>
    <div class="zoom">
      <button id="zoomOut" title="Zoom out">&minus;</button>
      <span id="zoomLabel">100%</span>
      <button id="zoomIn" title="Zoom in">+</button>
      <button id="fitWidth" title="Fit the page width to the pane">Fit</button>
    </div>
  </div>
</header>
<div id="status" class="status">Loading…</div>
<main id="stage" class="stage mode-side">
  <section class="pane" id="paneBefore">
    <h2>${documents.beforeLabel}</h2>
    <div class="canvasWrap"><canvas id="canvasBefore"></canvas></div>
  </section>
  <section class="pane" id="paneAfter">
    <h2>${documents.afterLabel}</h2>
    <div class="canvasWrap"><canvas id="canvasAfter"></canvas></div>
  </section>
</main>
<script nonce="${scriptNonce}" type="module">
  window.__bclp = {
    pdfjs: "${media('pdfjs', 'pdf.min.mjs')}",
    worker: "${media('pdfjs', 'pdf.worker.min.mjs')}",
    before: "${webview.asWebviewUri(beforeUri)}",
    after: "${webview.asWebviewUri(afterUri)}"
  };
</script>
<script nonce="${scriptNonce}" type="module" src="${media('viewer.js')}"></script>
</body>
</html>`;
}

/**
 * Opens, or reuses, the comparison panel and displays the two rendered documents.
 */
export async function showComparison(
    context: vscode.ExtensionContext,
    documents: ComparisonDocuments,
): Promise<void> {
    const beforeUri = await writeTempPdf(context, 'preview-environment.pdf', documents.beforePdf);
    const afterUri = await writeTempPdf(context, 'preview-workspace.pdf', documents.afterPdf);

    if (!currentPanel) {
        currentPanel = vscode.window.createWebviewPanel(
            'bcLayoutPreview.comparison',
            documents.title,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'media'),
                    context.globalStorageUri,
                ],
            },
        );
        currentPanel.onDidDispose(() => {
            currentPanel = undefined;
        });
    }

    currentPanel.title = documents.title;
    currentPanel.webview.html = renderHtml(currentPanel.webview, context, documents, beforeUri, afterUri);
    currentPanel.reveal(vscode.ViewColumn.Beside, true);
}
