import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { forgetCredentials, getAuthorizationHeader } from './auth';
import {
    BcClient,
    EMPTY_GUID,
    HelperNotInstalledError,
    listCompanies,
    ObjectInfo,
    ReportLayoutInfo,
} from './bcClient';
import { forgetEnvironment, ResolvedEnvironment, resolveEnvironment } from './environment';
import { publishHelper } from './deployer';
import { startJobBridge } from './bridge';
import {
    compareVersions,
    findInstalledHelper,
    formatVersion,
    HelperAppInfo,
    InstalledExtension,
    resolveHelperIdentity,
} from './helperApp';
import { HttpError } from './http';
import { AlLaunchConfig, describeConfig, findLaunchConfigs } from './launchConfigs';
import { showComparison } from './preview';
import {
    buildFilterView,
    buildRequestPageXml,
    InferredReport,
    inferReport,
    layoutFormatFor,
} from './reportContext';

interface PreviewSettings {
    configName: string;
    configSource: string;
    companyId: string;
    companyName: string;
    reportId: number;
    tableId: number;
    tableCaption: string;
    filterText: string;
    requestPageOptions: string;
    baselineLayoutName: string;
    baselineApplicationId: string;
    layoutPath: string;
}

const LAST_RUN_KEY = 'bcLayoutPreview.lastRun';

/**
 * The environment of the run in progress. Error handling needs it to clear the right credentials,
 * and it cannot be recovered from stored state — which is empty on a freshly installed extension.
 */
let activeEnvironment: ResolvedEnvironment | undefined;

function settingsKey(layoutPath: string): string {
    return `bcLayoutPreview.settings.${layoutPath}`;
}

async function pickLaunchConfig(preferredName?: string): Promise<AlLaunchConfig | undefined> {
    const configs = await findLaunchConfigs();
    if (configs.length === 0) {
        vscode.window.showErrorMessage(
            'No AL configuration was found. Add a launch.json with an "al" configuration to the workspace.',
        );
        return undefined;
    }

    if (preferredName) {
        const match = configs.find((config) => config.name === preferredName);
        if (match) {
            return match;
        }
    }

    const picked = await vscode.window.showQuickPick(
        configs.map((config) => ({
            label: config.name,
            description: describeConfig(config),
            detail: vscode.workspace.asRelativePath(config.sourceFile),
            config,
        })),
        { title: 'Business Central environment', placeHolder: 'Select the launch configuration to render against' },
    );

    return picked?.config;
}

/**
 * Offers to republish when the environment carries an older build of the helper than this
 * extension bundles. Never blocks: an older helper still answers every call.
 */
function offerHelperUpdate(
    context: vscode.ExtensionContext,
    environment: ResolvedEnvironment,
    authorization: string,
    helper: HelperAppInfo,
    installed: InstalledExtension,
): void {
    if (compareVersions(formatVersion(installed), helper.version) >= 0) {
        return;
    }

    void vscode.window
        .showInformationMessage(
            `${helper.name} ${formatVersion(installed)} is published in ${environment.label}; this extension bundles ${helper.version}.`,
            'Update',
        )
        .then(async (answer) => {
            if (answer === 'Update') {
                try {
                    await publishHelper(context, environment, authorization);
                } catch (error) {
                    await reportError(error, context);
                }
            }
        });
}

async function ensureHelper(
    context: vscode.ExtensionContext,
    environment: ResolvedEnvironment,
    authorization: string,
    client: BcClient,
    companyId: string,
    helper: HelperAppInfo,
): Promise<boolean> {
    let installed: InstalledExtension | undefined;
    let registryReadable = true;
    try {
        installed = await findInstalledHelper(environment, authorization, companyId, helper);
    } catch {
        registryReadable = false;
    }

    if (registryReadable) {
        if (installed?.isInstalled) {
            offerHelperUpdate(context, environment, authorization, helper, installed);
            return true;
        }
    } else if (await client.isHelperInstalled()) {
        return true;
    }

    const autoInstall = vscode.workspace
        .getConfiguration('bcLayoutPreview')
        .get<boolean>('autoInstallHelper', true);

    if (!autoInstall) {
        vscode.window.showErrorMessage(
            `"${helper.name}" is not installed in this environment. Run "BC Layout Preview: Install or Update Helper App".`,
        );
        return false;
    }

    const answer = await vscode.window.showInformationMessage(
        `"${helper.name}" is not installed in ${environment.label}. Publish it now? It is a small, generic app that renders reports on the server; no project code is changed.`,
        { modal: true },
        'Publish',
    );
    if (answer !== 'Publish') {
        return false;
    }

    await publishHelper(context, environment, authorization);

    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (await client.isHelperInstalled()) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    vscode.window.showWarningMessage(
        'The helper was uploaded but is not answering yet. On SaaS the install is queued and can take a few minutes; try again shortly.',
    );
    return false;
}

/**
 * Resolves a dataitem's table name, as written in AL, to the table id the renderer needs.
 */
async function resolveTableByName(client: BcClient, tableName: string): Promise<ObjectInfo | undefined> {
    try {
        const tables = await client.searchTables(tableName);
        return tables.find((table) => table.objectName.toLowerCase() === tableName.toLowerCase());
    } catch {
        return undefined;
    }
}

async function collectSettings(
    context: vscode.ExtensionContext,
    client: BcClient,
    layoutUri: vscode.Uri,
    config: AlLaunchConfig,
    company: { id: string; name: string },
    previous: PreviewSettings | undefined,
): Promise<PreviewSettings | undefined> {
    const layoutPath = layoutUri.fsPath;

    let inferred: InferredReport | undefined;
    if (previous?.reportId === undefined || previous?.tableId === undefined) {
        inferred = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: 'Looking for the report that uses this layout…' },
            () => inferReport(layoutUri),
        );
    }

    let reportId = previous?.reportId ?? inferred?.reportId;

    const reportIdText = await vscode.window.showInputBox({
        title: 'Report id',
        prompt: inferred
            ? 'The report the layout belongs to. Detected from the AL source in the workspace.'
            : 'The report the layout belongs to.',
        value: reportId ? String(reportId) : '',
        ignoreFocusOut: true,
        validateInput: (value) => (/^\d+$/.test(value.trim()) ? undefined : 'Enter a numeric report id.'),
    });
    if (!reportIdText) {
        return undefined;
    }
    reportId = Number(reportIdText.trim());

    let tableId = previous?.tableId;
    let tableCaption = previous?.tableCaption ?? '';

    if (tableId === undefined && inferred?.dataItemTable) {
        const resolved = await resolveTableByName(client, inferred.dataItemTable);
        if (resolved) {
            tableId = resolved.objectId;
            tableCaption = resolved.objectCaption;
        }
    }

    const keepTable =
        tableId === undefined
            ? undefined
            : await vscode.window.showQuickPick(
                  [
                      { label: `Keep ${tableCaption} (${tableId})`, keep: true },
                      { label: 'Choose a different table', keep: false },
                  ],
                  { title: 'Main dataitem table' },
              );
    if (tableId !== undefined && !keepTable) {
        return undefined;
    }

    if (tableId === undefined || keepTable?.keep === false) {
        const search = await vscode.window.showInputBox({
            title: 'Main dataitem table',
            prompt: 'Part of the table name, for example Item, Sales Header, Customer. Leave empty to enter a table number instead.',
            ignoreFocusOut: true,
        });
        if (search === undefined) {
            return undefined;
        }

        if (search.trim() === '') {
            const numberText = await vscode.window.showInputBox({
                title: 'Main dataitem table number',
                ignoreFocusOut: true,
                validateInput: (value) => (/^\d+$/.test(value.trim()) ? undefined : 'Enter a numeric table id.'),
            });
            if (!numberText) {
                return undefined;
            }
            tableId = Number(numberText.trim());
            tableCaption = `Table ${tableId}`;
        } else {
            const tables = await client.searchTables(search.trim());
            if (tables.length === 0) {
                vscode.window.showErrorMessage(`No table matches "${search}".`);
                return undefined;
            }
            const pickedTable = await vscode.window.showQuickPick(
                tables.map((table) => ({
                    label: table.objectCaption,
                    description: `${table.objectId}`,
                    detail: table.objectName,
                    table,
                })),
                { title: 'Main dataitem table', placeHolder: 'The table the report iterates' },
            );
            if (!pickedTable) {
                return undefined;
            }
            tableId = pickedTable.table.objectId;
            tableCaption = pickedTable.table.objectCaption;
        }
    }

    const filterText = await vscode.window.showInputBox({
        title: `Filter on ${tableCaption}`,
        prompt: 'field=filter pairs separated by semicolons. Leave empty to print every record.',
        value: previous?.filterText ?? '',
        placeHolder: 'No.=10000..50000',
        ignoreFocusOut: true,
    });
    if (filterText === undefined) {
        return undefined;
    }

    const requestPageOptions = await vscode.window.showInputBox({
        title: 'Request page options',
        prompt: 'Optional. name=value pairs separated by semicolons, using the request page field names from the AL source.',
        value: previous?.requestPageOptions ?? '',
        ignoreFocusOut: true,
        placeHolder: 'ShowDetails=1;LocationCode=MAIN',
    });
    if (requestPageOptions === undefined) {
        return undefined;
    }

    const layouts = await client.getReportLayouts(reportId);
    const baselineOptions: Array<vscode.QuickPickItem & { layout?: ReportLayoutInfo }> = layouts.map((layout) => ({
        label: layout.caption || layout.name,
        description: layout.layoutFormat,
        detail: layout.description || layout.name,
        layout,
    }));
    baselineOptions.unshift({
        label: 'Default layout',
        description: 'whatever the environment currently selects',
        detail: 'Renders without overriding the layout selection.',
    });

    const pickedBaseline = await vscode.window.showQuickPick(baselineOptions, {
        title: `Compare against which published layout of report ${reportId}?`,
    });
    if (!pickedBaseline) {
        return undefined;
    }

    const settings: PreviewSettings = {
        configName: config.name,
        configSource: config.sourceFile,
        companyId: company.id,
        companyName: company.name,
        reportId,
        tableId,
        tableCaption,
        filterText,
        requestPageOptions,
        baselineLayoutName: pickedBaseline.layout?.name ?? '',
        baselineApplicationId: pickedBaseline.layout?.applicationId ?? EMPTY_GUID,
        layoutPath,
    };

    await context.workspaceState.update(settingsKey(layoutPath), settings);
    await context.workspaceState.update(LAST_RUN_KEY, settings);
    return settings;
}

async function runComparison(
    context: vscode.ExtensionContext,
    layoutUri: vscode.Uri,
    reuseSettings: boolean,
): Promise<void> {
    const layoutPath = layoutUri.fsPath;
    const layoutFormat = layoutFormatFor(layoutPath);
    const previous = context.workspaceState.get<PreviewSettings>(settingsKey(layoutPath));

    const config = await pickLaunchConfig(reuseSettings ? previous?.configName : undefined);
    if (!config) {
        return;
    }

    const environment = await resolveEnvironment(context, config);
    if (!environment) {
        return;
    }

    activeEnvironment = environment;

    const authorization = await getAuthorizationHeader(context, environment);
    if (!authorization) {
        return;
    }

    let company =
        reuseSettings && previous?.companyId
            ? { id: previous.companyId, name: previous.companyName }
            : undefined;

    if (!company) {
        const companies = await listCompanies(environment, authorization);
        if (companies.length === 0) {
            vscode.window.showErrorMessage('The environment returned no companies.');
            return;
        }
        if (companies.length === 1) {
            company = companies[0];
        } else {
            const picked = await vscode.window.showQuickPick(
                companies.map((entry) => ({ label: entry.name, entry })),
                { title: 'Company' },
            );
            if (!picked) {
                return;
            }
            company = picked.entry;
        }
    }

    const helper = resolveHelperIdentity(context);
    const client = new BcClient(environment, authorization, company.id, helper);

    if (!(await ensureHelper(context, environment, authorization, client, company.id, helper))) {
        return;
    }

    const settings =
        reuseSettings && previous
            ? { ...previous, companyId: company.id, companyName: company.name }
            : await collectSettings(context, client, layoutUri, config, company, previous);
    if (!settings) {
        return;
    }

    const filterView = buildFilterView(settings.filterText);
    const requestPageXml = buildRequestPageXml(settings.reportId, settings.requestPageOptions);
    const layoutBytes = await fs.promises.readFile(layoutPath);

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Rendering report ${settings.reportId} in ${environment.label}`,
            cancellable: false,
        },
        async (progress) => {
            progress.report({ message: 'published layout…' });
            const beforePdf = await client.renderRegisteredLayout({
                reportId: settings.reportId,
                tableId: settings.tableId,
                layoutName: settings.baselineLayoutName,
                applicationId: settings.baselineApplicationId || EMPTY_GUID,
                filterView,
                requestPageXml,
            });

            progress.report({ message: 'workspace layout…' });
            const afterPdf = await client.renderSuppliedLayout(
                {
                    reportId: settings.reportId,
                    tableId: settings.tableId,
                    layoutName: '',
                    applicationId: EMPTY_GUID,
                    layoutFormat,
                    filterView,
                    requestPageXml,
                },
                layoutBytes,
            );

            await showComparison(context, {
                title: `Report ${settings.reportId} · ${path.basename(layoutPath)}`,
                subtitle: `${environment.label} · ${settings.companyName} · ${settings.tableCaption} ${filterView || '(no filter)'}`,
                beforeLabel: settings.baselineLayoutName
                    ? `Published: ${settings.baselineLayoutName}`
                    : 'Published: default layout',
                afterLabel: `Workspace: ${path.basename(layoutPath)}`,
                beforePdf,
                afterPdf,
            });
        },
    );

    await context.workspaceState.update(LAST_RUN_KEY, settings);
}

const LAYOUT_EXTENSIONS = ['.rdlc', '.rdl', '.docx', '.xlsx'];

function isLayoutFile(uri: vscode.Uri): boolean {
    return LAYOUT_EXTENSIONS.includes(path.extname(uri.fsPath).toLowerCase());
}

function tabUri(tab: vscode.Tab): vscode.Uri | undefined {
    const input = tab.input as { uri?: vscode.Uri } | undefined;
    return input?.uri;
}

/**
 * Finds the layout to compare. The command is usable from the explorer, from an editor tab, or
 * from the palette with focus anywhere — in the last case it offers the layouts that are open,
 * then any layout in the workspace.
 */
async function resolveLayoutUri(argument: vscode.Uri | undefined): Promise<vscode.Uri | undefined> {
    if (argument) {
        return argument;
    }

    const active = vscode.window.activeTextEditor?.document.uri;
    if (active && isLayoutFile(active)) {
        return active;
    }

    const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
    const activeTabUri = activeTab ? tabUri(activeTab) : undefined;
    if (activeTabUri && isLayoutFile(activeTabUri)) {
        return activeTabUri;
    }

    const openLayouts: vscode.Uri[] = [];
    const seen = new Set<string>();
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            const uri = tabUri(tab);
            if (!uri || !isLayoutFile(uri)) {
                continue;
            }
            const key = uri.fsPath.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                openLayouts.push(uri);
            }
        }
    }

    if (openLayouts.length === 1) {
        return openLayouts[0];
    }

    if (openLayouts.length > 1) {
        return pickLayout(openLayouts, 'Open report layouts', 'The cursor is not in a layout — choose one');
    }

    const workspaceLayouts = await vscode.workspace.findFiles(
        '**/*.{rdlc,rdl,docx,xlsx}',
        '**/node_modules/**',
        300,
    );

    if (workspaceLayouts.length === 0) {
        vscode.window.showErrorMessage(
            'No report layout found. Open an .rdlc, .rdl, .docx or .xlsx layout, or run the command from the explorer.',
        );
        return undefined;
    }

    if (workspaceLayouts.length === 1) {
        return workspaceLayouts[0];
    }

    return pickLayout(workspaceLayouts, 'Report layouts in the workspace', 'Nothing is open — choose a layout');
}

async function pickLayout(
    layouts: vscode.Uri[],
    title: string,
    placeHolder: string,
): Promise<vscode.Uri | undefined> {
    const picked = await vscode.window.showQuickPick(
        layouts.map((uri) => ({
            label: path.basename(uri.fsPath),
            detail: vscode.workspace.asRelativePath(uri),
            uri,
        })),
        { title, placeHolder },
    );
    return picked?.uri;
}

async function reportError(error: unknown, context: vscode.ExtensionContext): Promise<void> {
    if (error instanceof HelperNotInstalledError) {
        vscode.window.showErrorMessage(error.message);
        return;
    }

    if (error instanceof HttpError && error.status === 401) {
        if (activeEnvironment) {
            await forgetCredentials(context, activeEnvironment);
            vscode.window.showErrorMessage(
                `Business Central rejected the credentials at ${error.url}. They have been cleared; run the command again.`,
            );
        } else {
            vscode.window.showErrorMessage(
                `Business Central rejected the credentials at ${error.url}. Run "BC Layout Preview: Reset Saved Environment Settings" and try again.`,
            );
        }
        return;
    }

    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`BC Layout Preview: ${message}`);
}

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        startJobBridge(context),
        vscode.commands.registerCommand('bcLayoutPreview.compareLayout', async (argument?: vscode.Uri) => {
            const layoutUri = await resolveLayoutUri(argument);
            if (!layoutUri) {
                return;
            }
            try {
                await runComparison(context, layoutUri, false);
            } catch (error) {
                await reportError(error, context);
            }
        }),

        vscode.commands.registerCommand('bcLayoutPreview.rerun', async () => {
            const lastRun = context.workspaceState.get<PreviewSettings>(LAST_RUN_KEY);
            if (!lastRun) {
                vscode.window.showInformationMessage('Nothing has been compared in this workspace yet.');
                return;
            }
            try {
                await runComparison(context, vscode.Uri.file(lastRun.layoutPath), true);
            } catch (error) {
                await reportError(error, context);
            }
        }),

        vscode.commands.registerCommand('bcLayoutPreview.resetEnvironment', async () => {
            const config = await pickLaunchConfig();
            if (!config) {
                return;
            }
            const environment = await resolveEnvironment(context, config);
            if (environment) {
                await forgetCredentials(context, environment);
            }
            await forgetEnvironment(context, config);
            vscode.window.showInformationMessage(`Saved settings for "${config.name}" were cleared.`);
        }),

        vscode.commands.registerCommand('bcLayoutPreview.installHelper', async () => {
            try {
                const config = await pickLaunchConfig();
                if (!config) {
                    return;
                }
                const environment = await resolveEnvironment(context, config);
                if (!environment) {
                    return;
                }
                activeEnvironment = environment;
                const authorization = await getAuthorizationHeader(context, environment);
                if (!authorization) {
                    return;
                }
                await publishHelper(context, environment, authorization);
                vscode.window.showInformationMessage(`Helper published to ${environment.label}.`);
            } catch (error) {
                await reportError(error, context);
            }
        }),
    );
}

export function deactivate(): void {
    // Nothing to dispose beyond the subscriptions registered during activation.
}
