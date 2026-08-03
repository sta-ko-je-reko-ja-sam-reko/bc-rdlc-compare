import * as vscode from 'vscode';
import { ResolvedEnvironment } from './environment';
import { request } from './http';

const SECRET_PREFIX = 'bcLayoutPreview.credentials.';

interface StoredCredentials {
    user: string;
    password: string;
}

async function readOnPremCredentials(
    context: vscode.ExtensionContext,
    environment: ResolvedEnvironment,
): Promise<StoredCredentials | undefined> {
    const secretKey = `${SECRET_PREFIX}${environment.key}`;
    const existing = await context.secrets.get(secretKey);
    if (existing) {
        return JSON.parse(existing) as StoredCredentials;
    }

    const user = await vscode.window.showInputBox({
        title: `User name for ${environment.label}`,
        prompt: 'The Business Central user name used for web service access.',
        ignoreFocusOut: true,
    });
    if (!user) {
        return undefined;
    }

    const password = await vscode.window.showInputBox({
        title: `Password for ${user}`,
        prompt: 'Stored in the VS Code secret store, not in any settings file.',
        password: true,
        ignoreFocusOut: true,
    });
    if (password === undefined) {
        return undefined;
    }

    const credentials: StoredCredentials = { user, password };
    await context.secrets.store(secretKey, JSON.stringify(credentials));
    return credentials;
}

export async function forgetCredentials(
    context: vscode.ExtensionContext,
    environment: ResolvedEnvironment,
): Promise<void> {
    await context.secrets.delete(`${SECRET_PREFIX}${environment.key}`);
}

async function acquireClientCredentialsToken(tenant: string, clientId: string, clientSecret: string): Promise<string> {
    const form = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://api.businesscentral.dynamics.com/.default',
    }).toString();

    const response = await request({
        method: 'POST',
        url: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
    });

    if (response.status !== 200) {
        throw new Error(`Could not obtain a token for tenant ${tenant}: ${response.text()}`);
    }

    return response.json<{ access_token: string }>().access_token;
}

/**
 * Produces the Authorization header for the environment: basic authentication on premises,
 * and either the signed-in Microsoft account or a configured Entra application for SaaS.
 */
export async function getAuthorizationHeader(
    context: vscode.ExtensionContext,
    environment: ResolvedEnvironment,
): Promise<string | undefined> {
    if (!environment.saas) {
        const credentials = await readOnPremCredentials(context, environment);
        if (!credentials) {
            return undefined;
        }
        const encoded = Buffer.from(`${credentials.user}:${credentials.password}`, 'utf8').toString('base64');
        return `Basic ${encoded}`;
    }

    const settings = vscode.workspace.getConfiguration('bcLayoutPreview');
    const clientId = settings.get<string>('saas.clientId', '').trim();
    const clientSecret = settings.get<string>('saas.clientSecret', '').trim();

    if (clientId && clientSecret) {
        const token = await acquireClientCredentialsToken(environment.tenant, clientId, clientSecret);
        return `Bearer ${token}`;
    }

    const session = await vscode.authentication.getSession(
        'microsoft',
        ['https://api.businesscentral.dynamics.com/user_impersonation', 'offline_access'],
        { createIfNone: true },
    );
    return `Bearer ${session.accessToken}`;
}
