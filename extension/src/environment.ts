import * as vscode from 'vscode';
import { AlLaunchConfig, isSaaS } from './launchConfigs';

export interface ResolvedEnvironment {
    key: string;
    label: string;
    saas: boolean;
    tenant: string;
    environmentName?: string;
    /** Root of the server or environment, for example http://host:7048/BC */
    root: string;
    /** Root of the API surface, for example http://host:7048/BC/api */
    apiRoot: string;
    devBase?: string;
}

const STORAGE_PREFIX = 'bcLayoutPreview.env.';

function storageKey(config: AlLaunchConfig): string {
    return `${STORAGE_PREFIX}${config.sourceFile}::${config.name}`;
}

function trimTrailingSlash(value: string): string {
    return value.replace(/\/+$/, '');
}

function defaultOnPremRoot(config: AlLaunchConfig): string {
    const server = trimTrailingSlash(config.server ?? 'http://localhost');
    const hasExplicitPort = /:\d+$/.test(server.replace(/^https?:\/\//, ''));
    const base = hasExplicitPort ? server : `${server}:7048`;
    return `${base}/${config.serverInstance ?? 'BC'}`;
}

function defaultOnPremDevBase(config: AlLaunchConfig): string {
    const server = trimTrailingSlash(config.server ?? 'http://localhost');
    const stripped = server.replace(/:\d+$/, '');
    const port = config.port ?? 7049;
    return `${stripped}:${port}/${config.serverInstance ?? 'BC'}/dev`;
}

interface StoredEnvironment {
    root: string;
    devBase?: string;
    tenant?: string;
}

/**
 * Turns a launch.json configuration into concrete endpoints, asking once per environment for
 * anything that cannot be derived reliably and remembering the answer.
 */
export async function resolveEnvironment(
    context: vscode.ExtensionContext,
    config: AlLaunchConfig,
): Promise<ResolvedEnvironment | undefined> {
    const key = storageKey(config);
    const stored = context.globalState.get<StoredEnvironment>(key);

    if (isSaaS(config)) {
        let tenant = stored?.tenant || config.tenant || '';
        if (!tenant) {
            const entered = await vscode.window.showInputBox({
                title: `Tenant for "${config.name}"`,
                prompt: 'Entra tenant id or domain, for example contoso.onmicrosoft.com',
                ignoreFocusOut: true,
            });
            if (!entered) {
                return undefined;
            }
            tenant = entered.trim();
        }

        const environmentName = config.environmentName ?? 'Production';
        const root = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${encodeURIComponent(environmentName)}`;

        await context.globalState.update(key, { root, tenant });

        return {
            key,
            label: `${config.name} (SaaS · ${environmentName})`,
            saas: true,
            tenant,
            environmentName,
            root,
            apiRoot: `${root}/api`,
        };
    }

    let root = stored?.root;
    let devBase = stored?.devBase;

    if (!root) {
        const entered = await vscode.window.showInputBox({
            title: `Server URL for "${config.name}"`,
            prompt: 'Base URL of the server instance, without a trailing endpoint. The API is reached at <this>/api.',
            value: defaultOnPremRoot(config),
            ignoreFocusOut: true,
        });
        if (!entered) {
            return undefined;
        }
        root = trimTrailingSlash(entered.trim());
    }

    if (!devBase) {
        const entered = await vscode.window.showInputBox({
            title: `Development endpoint for "${config.name}"`,
            prompt: 'Used once, to publish the helper app. This is the endpoint the AL extension publishes to.',
            value: defaultOnPremDevBase(config),
            ignoreFocusOut: true,
        });
        if (!entered) {
            return undefined;
        }
        devBase = trimTrailingSlash(entered.trim());
    }

    await context.globalState.update(key, { root, devBase });

    return {
        key,
        label: `${config.name} (OnPrem)`,
        saas: false,
        tenant: config.tenant ?? 'default',
        root,
        apiRoot: `${root}/api`,
        devBase,
    };
}

export async function forgetEnvironment(context: vscode.ExtensionContext, config: AlLaunchConfig): Promise<void> {
    await context.globalState.update(storageKey(config), undefined);
    await context.globalState.update(`${storageKey(config)}.helperInstalled`, undefined);
}

/**
 * Adds the tenant to a URL. Multitenant on-premises servers cannot resolve credentials without it
 * and answer 401; single-tenant servers accept it harmlessly. SaaS carries the tenant in the path.
 */
export function withTenant(environment: ResolvedEnvironment, url: string): string {
    if (environment.saas || !environment.tenant) {
        return url;
    }
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}tenant=${encodeURIComponent(environment.tenant)}`;
}

