import * as vscode from 'vscode';
import { parse as parseJsonc, ParseError } from 'jsonc-parser';

export interface AlLaunchConfig {
    name: string;
    request?: string;
    environmentType?: string;
    server?: string;
    serverInstance?: string;
    port?: number;
    tenant?: string;
    environmentName?: string;
    authentication?: string;
    sourceFile: string;
}

export function isSaaS(config: AlLaunchConfig): boolean {
    const environmentType = (config.environmentType ?? '').toLowerCase();
    if (environmentType === 'sandbox' || environmentType === 'production') {
        return true;
    }
    return !config.server && !!config.environmentName;
}

/**
 * Collects every AL configuration from every launch.json in the workspace.
 * AL launch files routinely contain comments and commented-out blocks, so they are parsed as JSONC.
 */
export async function findLaunchConfigs(): Promise<AlLaunchConfig[]> {
    const files = await vscode.workspace.findFiles('**/.vscode/launch.json', '**/node_modules/**');
    const configs: AlLaunchConfig[] = [];

    for (const file of files) {
        let text: string;
        try {
            text = Buffer.from(await vscode.workspace.fs.readFile(file)).toString('utf8');
        } catch {
            continue;
        }

        const errors: ParseError[] = [];
        const parsed = parseJsonc(text, errors, { allowTrailingComma: true }) as
            | { configurations?: unknown[] }
            | undefined;

        if (!parsed || !Array.isArray(parsed.configurations)) {
            continue;
        }

        for (const entry of parsed.configurations) {
            const candidate = entry as Record<string, unknown>;
            if (typeof candidate?.name !== 'string') {
                continue;
            }
            if (candidate.type !== undefined && candidate.type !== 'al') {
                continue;
            }
            configs.push({
                name: candidate.name,
                request: candidate.request as string | undefined,
                environmentType: candidate.environmentType as string | undefined,
                server: candidate.server as string | undefined,
                serverInstance: candidate.serverInstance as string | undefined,
                port: candidate.port as number | undefined,
                tenant: candidate.tenant as string | undefined,
                environmentName: candidate.environmentName as string | undefined,
                authentication: candidate.authentication as string | undefined,
                sourceFile: file.fsPath,
            });
        }
    }

    return configs;
}

export function describeConfig(config: AlLaunchConfig): string {
    if (isSaaS(config)) {
        return `SaaS · ${config.environmentName ?? '(no environment)'}`;
    }
    const port = config.port ? `:${config.port}` : '';
    return `OnPrem · ${config.server ?? '(no server)'}${port}/${config.serverInstance ?? ''}`;
}
