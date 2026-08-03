const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function copy(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    console.log(`copied ${path.relative(root, to)}`);
}

const pdfjsBuild = path.join(root, 'node_modules', 'pdfjs-dist', 'build');
const pdfjsTargets = ['pdf.min.mjs', 'pdf.worker.min.mjs'];
let missingPdfjs = false;

for (const name of pdfjsTargets) {
    const source = path.join(pdfjsBuild, name);
    if (!fs.existsSync(source)) {
        console.warn(`WARNING: ${name} not found in pdfjs-dist. Run npm install first.`);
        missingPdfjs = true;
        continue;
    }
    copy(source, path.join(root, 'media', 'pdfjs', name));
}

// Take the most recently built .app, whatever it is called. alc.exe and the AL extension use
// different naming, and hard-coding one of them silently bundles a stale helper.
const helperDir = path.resolve(root, '..', 'bc-app');
const builtApps = fs.existsSync(helperDir)
    ? fs
          .readdirSync(helperDir)
          .filter((name) => name.toLowerCase().endsWith('.app'))
          .map((name) => ({ name, mtime: fs.statSync(path.join(helperDir, name)).mtimeMs }))
          .sort((left, right) => right.mtime - left.mtime)
    : [];

if (builtApps.length > 0) {
    copy(path.join(helperDir, builtApps[0].name), path.join(root, 'resources', 'BCLPLayoutPreview.app'));
    console.log(`  helper source: ${builtApps[0].name}`);
    if (builtApps.length > 1) {
        console.warn(
            `WARNING: ${builtApps.length} .app files in bc-app; used the newest. Delete the stale ones to avoid confusion.`,
        );
    }
} else {
    console.warn(
        'WARNING: no .app found in ../bc-app. Build the helper before packaging the extension.',
    );
}

// The extension identifies the helper the way Business Central does, by publisher and name.
// Taking them from app.json at build time keeps the two definitions from drifting apart.
const helperManifest = path.resolve(root, '..', 'bc-app', 'app.json');
const helperApiPage = path.resolve(root, '..', 'bc-app', 'src', 'LayoutPreviewApi.Page.al');

function readApiProperty(source, property, fallback) {
    const match = new RegExp(`${property}\\s*=\\s*'([^']*)'`, 'i').exec(source);
    return match ? match[1] : fallback;
}

if (fs.existsSync(helperManifest)) {
    const manifest = JSON.parse(fs.readFileSync(helperManifest, 'utf8'));
    const pageSource = fs.existsSync(helperApiPage) ? fs.readFileSync(helperApiPage, 'utf8') : '';

    const info = {
        name: manifest.name,
        publisher: manifest.publisher,
        version: manifest.version,
        apiPublisher: readApiProperty(pageSource, 'APIPublisher', 'RepLayoutPreview'),
        apiGroup: readApiProperty(pageSource, 'APIGroup', 'layoutPreview'),
        apiVersion: readApiProperty(pageSource, 'APIVersion', 'v1.0'),
    };

    const target = path.join(root, 'resources', 'helper-info.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(info, null, 2));
    console.log(
        `wrote resources/helper-info.json (name "${info.name}", route /${info.apiPublisher}/${info.apiGroup}/${info.apiVersion})`,
    );
} else {
    console.warn('WARNING: ../bc-app/app.json not found; the helper identity cannot be generated.');
}

if (missingPdfjs) {
    process.exitCode = 1;
}
