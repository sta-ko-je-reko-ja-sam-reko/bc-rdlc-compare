import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const utf8NoBom = (value: string) => value;

/**
 * `shell: true` concatenates the command and its arguments without escaping, so anything
 * containing a space — "Microsoft VS Code", the repository path — has to be quoted here.
 */
const quote = (value: string) => (/[\s&()[\]{}^=;!'+,`~]/.test(value) ? `"${value}"` : value);

function shellRun(file: string, args: string[], cwd?: string) {
    return run(quote(file), args.map(quote), {
        cwd,
        shell: true,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
    });
}

export interface RebuildOptions {
    skipHelper?: boolean;
    bumpHelperVersion?: boolean;
    bumpExtensionVersion?: boolean;
}

export interface RebuildResult {
    repoPath: string;
    helperVersion?: string;
    helperApp?: string;
    extensionVersion: string;
    vsix: string;
    installed: boolean;
    reloadRequired: true;
    notes: string[];
}

/** Where the clone lives, recorded by install-skill.ps1. */
export function readRepoPath(): string {
    const configPath = path.join(os.homedir(), '.rdlc-comp', 'config.json');
    if (!fs.existsSync(configPath)) {
        throw new Error(
            `${configPath} is missing. Run install-skill.ps1 from the bc-rdlc-compare clone so the tools know where it is.`,
        );
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { repoPath?: string };
    if (!config.repoPath || !fs.existsSync(config.repoPath)) {
        throw new Error(`repoPath in ${configPath} does not exist: ${config.repoPath}`);
    }
    return config.repoPath;
}

function findAlc(): string {
    const extensions = path.join(os.homedir(), '.vscode', 'extensions');
    const candidates = fs
        .readdirSync(extensions)
        .filter((name) => name.startsWith('ms-dynamics-smb.al-'))
        .map((name) => path.join(extensions, name, 'bin', 'win32', 'alc.exe'))
        .filter((candidate) => fs.existsSync(candidate))
        .sort();
    if (candidates.length === 0) {
        throw new Error('alc.exe not found. Install the AL Language extension, or pass skipHelper.');
    }
    return candidates[candidates.length - 1];
}

function findCodeCli(): string {
    const local = path.join(
        process.env['LOCALAPPDATA'] ?? '',
        'Programs',
        'Microsoft VS Code',
        'bin',
        'code.cmd',
    );
    return fs.existsSync(local) ? local : 'code';
}

/** Reads, bumps the last segment of, and rewrites a version — without a BOM, which breaks vsce. */
function bumpJsonVersion(file: string): string {
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    const manifest = JSON.parse(text) as { version: string };
    const parts = manifest.version.split('.');
    parts[parts.length - 1] = String(Number(parts[parts.length - 1] ?? 0) + 1);
    const next = parts.join('.');
    fs.writeFileSync(file, utf8NoBom(text.replace(`"version": "${manifest.version}"`, `"version": "${next}"`)), {
        encoding: 'utf8',
    });
    return next;
}

function readJsonVersion(file: string): string {
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    return (JSON.parse(text) as { version: string }).version;
}

/**
 * Builds the helper app and the extension, then installs the extension.
 * The order is fixed: `npm run build` bundles the newest .app from bc-app, so the AL goes first.
 */
export async function rebuildTooling(options: RebuildOptions = {}): Promise<RebuildResult> {
    const repoPath = readRepoPath();
    const notes: string[] = [];
    const helperDir = path.join(repoPath, 'bc-app');
    const extensionDir = path.join(repoPath, 'extension');

    let helperVersion: string | undefined;
    let helperApp: string | undefined;

    if (!options.skipHelper) {
        const manifest = path.join(helperDir, 'app.json');
        helperVersion = options.bumpHelperVersion ? bumpJsonVersion(manifest) : readJsonVersion(manifest);

        const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8').replace(/^﻿/, '')) as {
            publisher: string;
            name: string;
            version: string;
        };
        helperApp = `${parsed.publisher}_${parsed.name}_${parsed.version}.app`;

        for (const stale of fs.readdirSync(helperDir).filter((n) => n.toLowerCase().endsWith('.app'))) {
            fs.unlinkSync(path.join(helperDir, stale));
        }

        await run(findAlc(), [
            `/project:${helperDir}`,
            `/packagecachepath:${path.join(helperDir, '.alpackages')}`,
            `/out:${path.join(helperDir, helperApp)}`,
        ]);

        if (!fs.existsSync(path.join(helperDir, helperApp))) {
            throw new Error('The AL compiler produced no .app. Check that symbols are downloaded.');
        }
        notes.push(`compiled ${helperApp}`);
    } else {
        notes.push('helper not rebuilt; the extension will bundle whatever .app is already in bc-app');
    }

    const extensionManifest = path.join(extensionDir, 'package.json');
    const extensionVersion =
        options.bumpExtensionVersion === false
            ? readJsonVersion(extensionManifest)
            : bumpJsonVersion(extensionManifest);

    if (options.bumpExtensionVersion === false) {
        notes.push('extension version not bumped; a --force install of an unchanged version may keep the old code');
    }

    await shellRun('npm', ['run', 'build'], extensionDir);
    await shellRun(
        'npx',
        ['--yes', '@vscode/vsce', 'package', '--allow-missing-repository', '--skip-license'],
        extensionDir,
    );

    const vsix = path.join(extensionDir, `bc-report-layout-preview-${extensionVersion}.vsix`);
    if (!fs.existsSync(vsix)) {
        throw new Error(`Packaging produced no ${path.basename(vsix)}.`);
    }

    await shellRun(findCodeCli(), ['--install-extension', vsix, '--force']);

    return {
        repoPath,
        helperVersion,
        helperApp,
        extensionVersion,
        vsix,
        installed: true,
        reloadRequired: true,
        notes,
    };
}
