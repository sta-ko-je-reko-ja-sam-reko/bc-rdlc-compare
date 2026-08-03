import * as http from 'http';
import * as https from 'https';
import * as vscode from 'vscode';
import { URL } from 'url';

export interface HttpResponse {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
    text(): string;
    json<T>(): T;
}

export interface HttpRequestOptions {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: Buffer | string;
    timeoutMs?: number;
}

function ignoreCertErrors(): boolean {
    return vscode.workspace.getConfiguration('bcLayoutPreview').get<boolean>('ignoreCertificateErrors', false);
}

function defaultTimeout(): number {
    const seconds = vscode.workspace
        .getConfiguration('bcLayoutPreview')
        .get<number>('requestTimeoutSeconds', 300);
    return Math.max(10, seconds) * 1000;
}

/**
 * Issues a single HTTP request using Node's own stack rather than fetch, so that
 * self-signed certificates and very large PDF payloads can both be handled.
 */
export function request(options: HttpRequestOptions): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
        const url = new URL(options.url);
        const isTls = url.protocol === 'https:';
        const transport = isTls ? https : http;

        const bodyBuffer =
            options.body === undefined
                ? undefined
                : Buffer.isBuffer(options.body)
                  ? options.body
                  : Buffer.from(options.body, 'utf8');

        const headers: Record<string, string> = { ...(options.headers ?? {}) };
        if (bodyBuffer) {
            headers['Content-Length'] = String(bodyBuffer.length);
        }

        const requestOptions: https.RequestOptions = {
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || (isTls ? 443 : 80),
            path: `${url.pathname}${url.search}`,
            method: options.method,
            headers,
        };

        if (isTls && ignoreCertErrors()) {
            requestOptions.rejectUnauthorized = false;
        }

        const req = transport.request(requestOptions, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(chunks);
                resolve({
                    status: res.statusCode ?? 0,
                    headers: res.headers,
                    body,
                    text: () => body.toString('utf8'),
                    json: <T>() => JSON.parse(body.toString('utf8')) as T,
                });
            });
        });

        req.setTimeout(options.timeoutMs ?? defaultTimeout(), () => {
            req.destroy(new Error(`Request to ${url.host} timed out.`));
        });

        req.on('error', reject);

        if (bodyBuffer) {
            req.write(bodyBuffer);
        }
        req.end();
    });
}

export class HttpError extends Error {
    constructor(
        readonly status: number,
        readonly url: string,
        readonly detail: string,
    ) {
        super(`${status} from ${url}: ${detail}`);
    }
}

/**
 * Extracts the human-readable message from a Business Central OData or Automation API error payload.
 */
export function describeBcError(response: HttpResponse): string {
    const raw = response.text();
    try {
        const parsed = JSON.parse(raw) as { error?: { message?: string; code?: string } };
        if (parsed.error?.message) {
            return parsed.error.code ? `${parsed.error.code}: ${parsed.error.message}` : parsed.error.message;
        }
    } catch {
        // Not JSON; fall through to the raw text.
    }
    return raw.length > 600 ? `${raw.slice(0, 600)}…` : raw;
}
