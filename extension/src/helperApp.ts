import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ResolvedEnvironment, withTenant } from './environment';
import { describeBcError, HttpError, request } from './http';

export interface HelperAppInfo {
    name: string;
    publisher: string;
    version: string;
    apiPublisher: string;
    apiGroup: string;
    apiVersion: string;
}

const FALLBACK_HELPER: HelperAppInfo = {
    name: 'BC Report Layout Preview',
    publisher: 'matr',
    version: '0.0.0.0',
    apiPublisher: 'RepLayoutPreview',
    apiGroup: 'layoutPreview',
    apiVersion: 'v1.0',
};

export interface InstalledExtension {
    id: string;
    displayName: string;
    publisher: string;
    versionMajor: number;
    versionMinor: number;
    versionBuild: number;
    versionRevision: number;
    isInstalled: boolean;
}

/**
 * Reads the identity of the helper app bundled with this extension. The file is generated at build
 * time from the AL app.json, so the two can never drift apart.
 */
export function bundledHelper(context: vscode.ExtensionContext): HelperAppInfo {
    const infoPath = path.join(context.extensionPath, 'resources', 'helper-info.json');
    if (!fs.existsSync(infoPath)) {
        return FALLBACK_HELPER;
    }
    return { ...FALLBACK_HELPER, ...(JSON.parse(fs.readFileSync(infoPath, 'utf8')) as Partial<HelperAppInfo>) };
}

/**
 * The helper identity actually used at run time: the values generated from the AL project at build
 * time, with any non-empty user setting taking precedence. Settings exist so that a renamed or
 * re-routed helper can be pointed at without rebuilding the extension.
 */
export function resolveHelperIdentity(context: vscode.ExtensionContext): HelperAppInfo {
    const bundled = bundledHelper(context);
    const settings = vscode.workspace.getConfiguration('bcLayoutPreview');
    const override = (key: string, fallback: string): string => {
        const value = settings.get<string>(key, '');
        return value && value.trim() ? value.trim() : fallback;
    };

    return {
        name: override('helper.appName', bundled.name),
        publisher: bundled.publisher,
        version: bundled.version,
        apiPublisher: override('helper.apiPublisher', bundled.apiPublisher),
        apiGroup: override('helper.apiGroup', bundled.apiGroup),
        apiVersion: override('helper.apiVersion', bundled.apiVersion),
    };
}

export function formatVersion(extension: InstalledExtension): string {
    return `${extension.versionMajor}.${extension.versionMinor}.${extension.versionBuild}.${extension.versionRevision}`;
}

/**
 * Compares two dotted version strings. Returns a negative number when left is older than right.
 */
export function compareVersions(left: string, right: string): number {
    const leftParts = left.split('.').map((part) => Number(part) || 0);
    const rightParts = right.split('.').map((part) => Number(part) || 0);
    for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
        const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
        if (difference !== 0) {
            return difference;
        }
    }
    return 0;
}

/**
 * Finds the helper among the apps installed in the environment, matching on the app name alone.
 * Publisher and version are deliberately ignored: any build of the app, whoever published it and
 * whatever version it carries, is the app.
 */
export async function findInstalledHelper(
    environment: ResolvedEnvironment,
    authorization: string,
    companyId: string,
    helper: HelperAppInfo,
): Promise<InstalledExtension | undefined> {
    const url = withTenant(
        environment,
        `${environment.apiRoot}/microsoft/automation/v2.0/companies(${companyId})/extensions`,
    );

    const response = await request({
        method: 'GET',
        url,
        headers: { Authorization: authorization, Accept: 'application/json' },
    });

    if (response.status < 200 || response.status >= 300) {
        throw new HttpError(response.status, url, describeBcError(response));
    }

    const extensions = response.json<{ value: InstalledExtension[] }>().value;
    const wantedName = helper.name.trim().toLowerCase();

    return extensions.find((candidate) => (candidate.displayName ?? '').trim().toLowerCase() === wantedName);
}
