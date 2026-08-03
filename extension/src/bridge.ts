import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { getAuthorizationHeader } from './auth';
import { BcClient, EMPTY_GUID, listCompanies } from './bcClient';
import { publishHelper } from './deployer';
import { resolveEnvironment } from './environment';
import { findInstalledHelper, formatVersion, resolveHelperIdentity } from './helperApp';
import { describeConfig, findLaunchConfigs } from './launchConfigs';
import { showComparison } from './preview';
import { buildFilterView, buildRequestPageXml, layoutFormatFor } from './reportContext';

/**
 * A local job queue that lets the MCP server drive this extension.
 *
 * The MCP server runs in its own process and cannot open a webview, so it writes a job here and the
 * extension performs the work and shows its own viewer. Credentials never leave the extension: they
 * stay in the VS Code secret store, and the job files carry only parameters.
 */

interface Job {
    id: string;
    op: string;
    params?: Record<string, unknown>;
}

interface CompareParams {
    configName: string;
    company?: string;
    reportId: number;
    tableId: number;
    layoutPath: string;
    filterText?: string;
    requestPageOptions?: string;
    baselineLayoutName?: string;
    baselineApplicationId?: string;
}

export function jobsDirectory(): string {
    return path.join(os.homedir(), '.rdlc-comp', 'jobs');
}

async function openEnvironment(context: vscode.ExtensionContext, configName: string, companyName?: string) {
    const configs = await findLaunchConfigs();
    const config = configs.find((candidate) => candidate.name === configName);
    if (!config) {
        throw new Error(
            `No launch configuration named "${configName}". Available: ${configs.map((c) => c.name).join(', ') || 'none'}`,
        );
    }

    const environment = await resolveEnvironment(context, config);
    if (!environment) {
        throw new Error(`Setup for "${configName}" was cancelled.`);
    }

    const authorization = await getAuthorizationHeader(context, environment);
    if (!authorization) {
        throw new Error(`Authentication for "${configName}" was cancelled.`);
    }

    const companies = await listCompanies(environment, authorization);
    if (companies.length === 0) {
        throw new Error('The environment returned no companies.');
    }

    const company = companyName
        ? companies.find((entry) => entry.name.toLowerCase() === companyName.toLowerCase())
        : companies[0];
    if (!company) {
        throw new Error(`No company named "${companyName}". Available: ${companies.map((c) => c.name).join(', ')}`);
    }

    const helper = resolveHelperIdentity(context);
    const client = new BcClient(environment, authorization, company.id, helper);
    return { environment, authorization, company, helper, client };
}

async function runCompare(context: vscode.ExtensionContext, params: CompareParams) {
    if (!fs.existsSync(params.layoutPath)) {
        throw new Error(`Layout file not found: ${params.layoutPath}`);
    }

    const { environment, company, client } = await openEnvironment(context, params.configName, params.company);
    const layoutFormat = layoutFormatFor(params.layoutPath);
    const filterView = buildFilterView(params.filterText ?? '');
    const requestPageXml = buildRequestPageXml(params.reportId, params.requestPageOptions ?? '');
    const layoutBytes = await fs.promises.readFile(params.layoutPath);

    const shared = {
        reportId: params.reportId,
        tableId: params.tableId,
        filterView,
        requestPageXml,
    };

    const beforePdf = await client.renderRegisteredLayout({
        ...shared,
        layoutName: params.baselineLayoutName ?? '',
        applicationId: params.baselineApplicationId || EMPTY_GUID,
    });

    const afterPdf = await client.renderSuppliedLayout(
        { ...shared, layoutName: '', applicationId: EMPTY_GUID, layoutFormat },
        layoutBytes,
    );

    await showComparison(context, {
        title: `Report ${params.reportId} · ${path.basename(params.layoutPath)}`,
        subtitle: `${environment.label} · ${company.name} · table ${params.tableId} ${filterView || '(no filter)'}`,
        beforeLabel: params.baselineLayoutName ? `Published: ${params.baselineLayoutName}` : 'Published: default layout',
        afterLabel: `Workspace: ${path.basename(params.layoutPath)}`,
        beforePdf,
        afterPdf,
    });

    return {
        shown: true,
        environment: environment.label,
        company: company.name,
        filterView,
        publishedBytes: beforePdf.length,
        workspaceBytes: afterPdf.length,
    };
}

async function handle(context: vscode.ExtensionContext, job: Job): Promise<unknown> {
    const params = (job.params ?? {}) as Record<string, string>;

    switch (job.op) {
        case 'ping':
            return { ok: true, extension: 'bc-report-layout-preview' };

        case 'listEnvironments': {
            const configs = await findLaunchConfigs();
            return configs.map((config) => ({
                name: config.name,
                kind: describeConfig(config),
                environmentName: config.environmentName,
                server: config.server,
                tenant: config.tenant,
                sourceFile: config.sourceFile,
            }));
        }

        case 'checkHelper': {
            const { environment, authorization, company, helper } = await openEnvironment(
                context,
                params['configName'],
                params['company'],
            );
            const installed = await findInstalledHelper(environment, authorization, company.id, helper);
            return {
                installed: Boolean(installed?.isInstalled),
                installedVersion: installed ? formatVersion(installed) : undefined,
                bundledVersion: helper.version,
                appName: helper.name,
                environment: environment.label,
            };
        }

        case 'publishHelper': {
            const { environment, authorization, company, helper, client } = await openEnvironment(
                context,
                params['configName'],
                params['company'],
            );

            await publishHelper(context, environment, authorization);

            // On SaaS the install is queued, so wait for the API to start answering.
            for (let attempt = 0; attempt < 20; attempt += 1) {
                if (await client.isHelperInstalled()) {
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 3000));
            }

            const installed = await findInstalledHelper(environment, authorization, company.id, helper);
            return {
                published: true,
                answering: await client.isHelperInstalled(),
                installedVersion: installed ? formatVersion(installed) : undefined,
                bundledVersion: helper.version,
                environment: environment.label,
            };
        }

        case 'listReportLayouts': {
            const { client } = await openEnvironment(context, params['configName'], params['company']);
            return client.getReportLayouts(Number(params['reportId']));
        }

        case 'searchTables': {
            const { client } = await openEnvironment(context, params['configName'], params['company']);
            return client.searchTables(String(params['search'] ?? ''));
        }

        case 'searchFields': {
            const { client } = await openEnvironment(context, params['configName'], params['company']);
            return client.searchFields(Number(params['tableNo']), params['typeName']);
        }

        case 'compare':
            return runCompare(context, job.params as unknown as CompareParams);

        default:
            throw new Error(`Unknown operation "${job.op}".`);
    }
}

export function startJobBridge(context: vscode.ExtensionContext): vscode.Disposable {
    const directory = jobsDirectory();
    fs.mkdirSync(directory, { recursive: true });

    let busy = false;

    const timer = setInterval(async () => {
        if (busy) {
            return;
        }
        let pending: string[];
        try {
            pending = fs.readdirSync(directory).filter((name) => name.endsWith('.job.json'));
        } catch {
            return;
        }
        if (pending.length === 0) {
            return;
        }

        busy = true;
        for (const name of pending) {
            const jobPath = path.join(directory, name);
            let job: Job | undefined;
            try {
                job = JSON.parse(fs.readFileSync(jobPath, 'utf8')) as Job;
            } catch {
                // A half-written file; it will be complete on the next tick.
                continue;
            }

            try {
                fs.unlinkSync(jobPath);
            } catch {
                continue;
            }

            let result: { id: string; ok: boolean; data?: unknown; error?: string };
            try {
                result = { id: job.id, ok: true, data: await handle(context, job) };
            } catch (error) {
                result = { id: job.id, ok: false, error: error instanceof Error ? error.message : String(error) };
            }

            try {
                fs.writeFileSync(path.join(directory, `${job.id}.result.json`), JSON.stringify(result), 'utf8');
            } catch {
                // Nothing useful to do; the caller will time out.
            }
        }
        busy = false;
    }, 400);

    return new vscode.Disposable(() => clearInterval(timer));
}
