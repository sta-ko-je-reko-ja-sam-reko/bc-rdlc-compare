import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ResolvedEnvironment, withTenant } from './environment';
import { describeBcError, HttpError, request } from './http';

export function helperAppPath(context: vscode.ExtensionContext): string {
    return path.join(context.extensionPath, 'resources', 'BCLPLayoutPreview.app');
}

function buildMultipartBody(fileName: string, contents: Buffer, boundary: string): Buffer {
    const header = Buffer.from(
        `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${fileName}"; filename="${fileName}"\r\n` +
            'Content-Type: application/octet-stream\r\n\r\n',
        'utf8',
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    return Buffer.concat([header, contents, footer]);
}

async function publishToOnPrem(
    environment: ResolvedEnvironment,
    authorization: string,
    appBytes: Buffer,
): Promise<void> {
    if (!environment.devBase) {
        throw new Error('No development endpoint is configured for this environment.');
    }

    const boundary = `----bclp${Date.now().toString(16)}`;
    const url = withTenant(
        environment,
        `${environment.devBase}/apps?SchemaUpdateMode=synchronize&DependencyPublishingOption=default`,
    );

    const response = await request({
        method: 'POST',
        url,
        headers: {
            Authorization: authorization,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: buildMultipartBody('BCLPLayoutPreview.app', appBytes, boundary),
        timeoutMs: 10 * 60 * 1000,
    });

    if (response.status < 200 || response.status >= 300) {
        throw new HttpError(response.status, url, describeBcError(response));
    }
}

async function publishToSaaS(
    environment: ResolvedEnvironment,
    authorization: string,
    appBytes: Buffer,
): Promise<void> {
    const automationBase = `${environment.apiRoot}/microsoft/automation/v2.0`;
    const companiesUrl = `${automationBase}/companies`;
    const companiesResponse = await request({
        method: 'GET',
        url: companiesUrl,
        headers: { Authorization: authorization, Accept: 'application/json' },
    });
    if (companiesResponse.status < 200 || companiesResponse.status >= 300) {
        throw new HttpError(companiesResponse.status, companiesUrl, describeBcError(companiesResponse));
    }

    const companies = companiesResponse.json<{ value: Array<{ id: string }> }>().value;
    if (companies.length === 0) {
        throw new Error('The automation API returned no companies for this environment.');
    }
    const companyId = companies[0].id;

    const uploadUrl = `${automationBase}/companies(${companyId})/extensionUpload(0)`;

    const patchResponse = await request({
        method: 'PATCH',
        url: `${uploadUrl}/content`,
        headers: {
            Authorization: authorization,
            'Content-Type': 'application/octet-stream',
            'If-Match': '*',
        },
        body: appBytes,
        timeoutMs: 10 * 60 * 1000,
    });
    if (patchResponse.status < 200 || patchResponse.status >= 300) {
        throw new HttpError(patchResponse.status, `${uploadUrl}/content`, describeBcError(patchResponse));
    }

    const commitUrl = `${uploadUrl}/Microsoft.NAV.upload`;
    const commitResponse = await request({
        method: 'POST',
        url: commitUrl,
        headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
            'If-Match': '*',
        },
        body: '{}',
        timeoutMs: 10 * 60 * 1000,
    });
    if (commitResponse.status < 200 || commitResponse.status >= 300) {
        throw new HttpError(commitResponse.status, commitUrl, describeBcError(commitResponse));
    }
}

/**
 * Publishes the bundled helper app to the environment. On SaaS the deployment is queued by the
 * automation API and can take a few minutes to become callable.
 */
export async function publishHelper(
    context: vscode.ExtensionContext,
    environment: ResolvedEnvironment,
    authorization: string,
): Promise<void> {
    const appPath = helperAppPath(context);
    if (!fs.existsSync(appPath)) {
        throw new Error(
            `The helper app is missing from the extension at ${appPath}. Build it with the AL compiler and copy it into resources/.`,
        );
    }

    const appBytes = await fs.promises.readFile(appPath);

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Publishing the layout preview helper to ${environment.label}…`,
            cancellable: false,
        },
        async () => {
            if (environment.saas) {
                try {
                    await publishToSaaS(environment, authorization, appBytes);
                } catch (error) {
                    const detail = error instanceof Error ? error.message : String(error);
                    throw new Error(
                        `Automatic publishing to ${environment.label} failed (${detail}). ` +
                            `Publish the helper once by hand instead — it is at ${appPath} — then run the comparison again. ` +
                            'The AL extension can publish it to this environment with its own launch configuration.',
                    );
                }
            } else {
                await publishToOnPrem(environment, authorization, appBytes);
            }
        },
    );
}
