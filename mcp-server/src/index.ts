#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { rebuildTooling, type RebuildOptions } from './build.js';

/**
 * This server does no Business Central work of its own. It hands jobs to the VS Code extension,
 * which owns the credentials and the viewer, and reports back what the extension did. Rendered
 * documents are never written to disk: they stay inside the extension and open in its webview.
 */

const STATE_DIRECTORY = '.layout-comp';
const LEGACY_STATE_DIRECTORY = '.rdlc-comp';

/**
 * Must resolve to the same directory the extension picks, or jobs are written where nothing is
 * watching. Both prefer the current name and fall back to the pre-rename one only while it is the
 * only directory present.
 */
function stateDirectory(): string {
    const current = path.join(os.homedir(), STATE_DIRECTORY);
    if (fs.existsSync(current)) {
        return current;
    }
    const legacy = path.join(os.homedir(), LEGACY_STATE_DIRECTORY);
    return fs.existsSync(legacy) ? legacy : current;
}

const JOBS_DIRECTORY = path.join(stateDirectory(), 'jobs');
// Generous, because the very first call against an environment may sit waiting for the user: VS Code
// prompts for credentials on premises, and for a Microsoft account on SaaS with no client secret
// configured. A tight timeout would abandon a job the user is still completing.
const LOOKUP_TIMEOUT_MS = 300_000;
const RENDER_TIMEOUT_MS = 600_000;

/** Which versions of the extension are on disk, newest last. */
function installedExtensionVersions(): string[] {
    const extensions = path.join(os.homedir(), '.vscode', 'extensions');
    try {
        return fs
            .readdirSync(extensions)
            .filter((name) => /bc-report-layout-preview-\d/.test(name))
            .map((name) => name.replace(/^.*bc-report-layout-preview-/, ''))
            .sort();
    } catch {
        return [];
    }
}

/**
 * A relayed tool can only fail three ways, and the advice differs completely. Look at the disk
 * rather than guessing, because "install it" and "reload the window" are not interchangeable.
 */
class ExtensionUnavailableError extends Error {
    constructor(operation: string, timeoutMs: number) {
        const versions = installedExtensionVersions();
        const seconds = Math.round(timeoutMs / 1000);

        const advice =
            versions.length === 0
                ? 'The extension is not installed. Run bc_rebuild_tooling — it builds and installs it ' +
                  'from this server, without needing the extension — then reload the VS Code window.'
                : `The extension is installed (${versions.join(', ')}) but is not answering. Most likely ` +
                  'the VS Code window has not been reloaded since it was installed: a new version does ' +
                  'not run until you do. Reload the window and try again. Failing that, a prompt may be ' +
                  'waiting in VS Code for credentials or a Microsoft account sign-in — answer it.';

        super(`No answer to "${operation}" within ${seconds}s. ${advice}`);
    }
}

interface JobResult {
    id: string;
    ok: boolean;
    data?: unknown;
    error?: string;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Drops results and jobs abandoned by an earlier session, so the folder cannot grow without bound. */
function sweepStale(): void {
    const cutoff = Date.now() - 60 * 60 * 1000;
    try {
        for (const name of fs.readdirSync(JOBS_DIRECTORY)) {
            const file = path.join(JOBS_DIRECTORY, name);
            if (fs.statSync(file).mtimeMs < cutoff) {
                fs.unlinkSync(file);
            }
        }
    } catch {
        // Best effort only.
    }
}

async function callExtension(op: string, params: Record<string, unknown> = {}, timeoutMs = LOOKUP_TIMEOUT_MS) {
    fs.mkdirSync(JOBS_DIRECTORY, { recursive: true });
    sweepStale();

    const id = randomUUID();
    const jobPath = path.join(JOBS_DIRECTORY, `${id}.job.json`);
    const resultPath = path.join(JOBS_DIRECTORY, `${id}.result.json`);

    // Write to a temporary name first so the extension never reads a half-written job.
    const stagingPath = `${jobPath}.tmp`;
    fs.writeFileSync(stagingPath, JSON.stringify({ id, op, params }), 'utf8');
    fs.renameSync(stagingPath, jobPath);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (fs.existsSync(resultPath)) {
            const result = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as JobResult;
            fs.unlinkSync(resultPath);
            if (!result.ok) {
                throw new Error(result.error ?? 'The extension reported a failure with no message.');
            }
            return result.data;
        }
        await delay(300);
    }

    try {
        fs.unlinkSync(jobPath);
    } catch {
        // The extension may have taken it; nothing to clean up.
    }
    throw new ExtensionUnavailableError(op, timeoutMs);
}

const TOOLS = [
    {
        name: 'bc_list_environments',
        description:
            'List the Business Central environments available in the open VS Code workspace, read from every launch.json. Call this first — every other tool takes a configName from here.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'bc_check_helper',
        description:
            'Check whether the layout preview helper app is installed in an environment, and compare its version against the one bundled with the extension. Call before comparing; renders fail without it.',
        inputSchema: {
            type: 'object',
            properties: {
                configName: { type: 'string', description: 'Launch configuration name.' },
                company: { type: 'string', description: 'Company name. Defaults to the first company.' },
            },
            required: ['configName'],
            additionalProperties: false,
        },
    },
    {
        name: 'bc_rebuild_tooling',
        description:
            "Rebuild and reinstall the tooling itself: compile the AL helper app, then build, package and install the VS Code extension. Runs in this server's own process, not through the extension, so it works even when the extension is broken. The user must reload the VS Code window afterwards. Use after changing the extension's TypeScript or the helper's AL.",
        inputSchema: {
            type: 'object',
            properties: {
                skipHelper: {
                    type: 'boolean',
                    description: 'Skip the AL compile and bundle whatever .app is already in bc-app. Default false.',
                },
                bumpHelperVersion: {
                    type: 'boolean',
                    description: 'Increment the helper version. Do this when the AL changed, so BC will upgrade it. Default false.',
                },
                bumpExtensionVersion: {
                    type: 'boolean',
                    description: 'Increment the extension version. Default true — a forced install of an unchanged version can silently keep the old code.',
                },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'bc_publish_helper',
        description:
            "Publish the helper app bundled with the VS Code extension to an environment. Use when bc_check_helper reports it missing, or to force the bundled version over an older installed one. Not possible for a SaaS production environment — that needs the admin centre.",
        inputSchema: {
            type: 'object',
            properties: {
                configName: { type: 'string' },
                company: { type: 'string' },
            },
            required: ['configName'],
            additionalProperties: false,
        },
    },
    {
        name: 'bc_search_tables',
        description:
            'Find tables by part of their caption, to resolve a report main dataitem to a table id.',
        inputSchema: {
            type: 'object',
            properties: {
                configName: { type: 'string' },
                company: { type: 'string' },
                search: { type: 'string', description: 'Part of the table caption, e.g. "Production Order".' },
            },
            required: ['configName', 'search'],
            additionalProperties: false,
        },
    },
    {
        name: 'bc_search_fields',
        description:
            'List the fields of a table, including tables whose AL source is not available such as a partner app or Microsoft. Use it to turn a described filter ("some custom boolean flag") into a real field name.',
        inputSchema: {
            type: 'object',
            properties: {
                configName: { type: 'string' },
                company: { type: 'string' },
                tableNo: { type: 'number', description: 'Table id.' },
                typeName: { type: 'string', description: 'Optional type filter, e.g. "Boolean", "Date", "Option".' },
            },
            required: ['configName', 'tableNo'],
            additionalProperties: false,
        },
    },
    {
        name: 'bc_list_report_layouts',
        description: 'List the layouts published for a report, to choose a baseline to compare against.',
        inputSchema: {
            type: 'object',
            properties: {
                configName: { type: 'string' },
                company: { type: 'string' },
                reportId: { type: 'number' },
            },
            required: ['configName', 'reportId'],
            additionalProperties: false,
        },
    },
    {
        name: 'bc_compare_layout',
        description:
            "Render a report twice — once with the layout published in the environment, once with a layout file from disk — and open both in the extension's side-by-side viewer, which also offers a difference blend. Nothing is written to disk.",
        inputSchema: {
            type: 'object',
            properties: {
                configName: { type: 'string', description: 'Launch configuration name.' },
                company: { type: 'string', description: 'Company name. Defaults to the first company.' },
                reportId: { type: 'number', description: 'The report to render.' },
                tableId: { type: 'number', description: 'Table id of the report main dataitem.' },
                layoutPath: { type: 'string', description: 'Absolute path to the .rdlc/.rdl/.docx to compare.' },
                filterText: {
                    type: 'string',
                    description: 'field=filter pairs separated by semicolons, e.g. "No.=1000..2000;Status=Released". Empty prints every record.',
                },
                requestPageOptions: {
                    type: 'string',
                    description: 'name=value pairs for request page controls that are not dataitem fields, e.g. "NoOfCopies=2".',
                },
                baselineLayoutName: {
                    type: 'string',
                    description: 'Published layout to compare against. Omit for the environment default selection.',
                },
                baselineApplicationId: { type: 'string', description: 'Application id of that layout.' },
            },
            required: ['configName', 'reportId', 'tableId', 'layoutPath'],
            additionalProperties: false,
        },
    },
] as const;

const server = new Server(
    { name: 'bc-layout-compare', version: '0.1.0' },
    { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS as unknown as [] }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    const operations: Record<string, { op: string; timeout: number }> = {
        bc_list_environments: { op: 'listEnvironments', timeout: LOOKUP_TIMEOUT_MS },
        bc_check_helper: { op: 'checkHelper', timeout: LOOKUP_TIMEOUT_MS },
        bc_publish_helper: { op: 'publishHelper', timeout: RENDER_TIMEOUT_MS },
        bc_search_tables: { op: 'searchTables', timeout: LOOKUP_TIMEOUT_MS },
        bc_search_fields: { op: 'searchFields', timeout: LOOKUP_TIMEOUT_MS },
        bc_list_report_layouts: { op: 'listReportLayouts', timeout: LOOKUP_TIMEOUT_MS },
        bc_compare_layout: { op: 'compare', timeout: RENDER_TIMEOUT_MS },
    };

    // Handled here rather than by the extension: it cannot reinstall itself.
    if (name === 'bc_rebuild_tooling') {
        try {
            const result = await rebuildTooling(args as RebuildOptions);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            const output = (error as { stderr?: string; stdout?: string } | undefined) ?? {};
            return {
                isError: true,
                content: [
                    { type: 'text', text: [detail, output.stdout, output.stderr].filter(Boolean).join('\n\n') },
                ],
            };
        }
    }

    const operation = operations[name];
    if (!operation) {
        return { isError: true, content: [{ type: 'text', text: `Unknown tool "${name}".` }] };
    }

    try {
        const data = await callExtension(operation.op, args, operation.timeout);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
        return {
            isError: true,
            content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        };
    }
});

await server.connect(new StdioServerTransport());
