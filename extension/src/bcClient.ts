import { ResolvedEnvironment, withTenant } from './environment';
import { describeBcError, HttpError, request } from './http';

/** The three segments that address a custom API in Business Central. */
export interface ApiRoute {
    apiPublisher: string;
    apiGroup: string;
    apiVersion: string;
}

export interface ReportLayoutInfo {
    id: string;
    reportId: number;
    name: string;
    applicationId: string;
    layoutFormat: string;
    caption: string;
    description: string;
}

export interface ObjectInfo {
    objectType: string;
    objectId: number;
    objectName: string;
    objectCaption: string;
}

export interface CompanyInfo {
    id: string;
    name: string;
}

export interface FieldInfo {
    tableNo: number;
    tableName: string;
    fieldNo: number;
    fieldName: string;
    fieldCaption: string;
    typeName: string;
    fieldClass: string;
    enabled: boolean;
}

export interface RenderRequestFields {
    reportId: number;
    tableId: number;
    layoutName: string;
    applicationId: string;
    layoutFormat: string;
    filterView: string;
    requestPageXml: string;
}

export const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

export class HelperNotInstalledError extends Error {
    constructor() {
        super('The layout preview API is not published in this environment.');
    }
}

function jsonHeaders(authorization: string): Record<string, string> {
    return {
        Authorization: authorization,
        'Content-Type': 'application/json',
        Accept: 'application/json',
    };
}

/**
 * Lists the companies of the environment through the standard API, which is always available and
 * returns the company ids that the custom API endpoints are addressed with.
 */
export async function listCompanies(
    environment: ResolvedEnvironment,
    authorization: string,
): Promise<CompanyInfo[]> {
    const url = withTenant(environment, `${environment.apiRoot}/v2.0/companies`);
    const response = await request({
        method: 'GET',
        url,
        headers: { Authorization: authorization, Accept: 'application/json' },
    });

    if (response.status < 200 || response.status >= 300) {
        throw new HttpError(response.status, url, describeBcError(response));
    }

    return response.json<{ value: CompanyInfo[] }>().value;
}

export class BcClient {
    constructor(
        private readonly environment: ResolvedEnvironment,
        private readonly authorization: string,
        private readonly companyId: string,
        private readonly route: ApiRoute,
    ) {}

    private get base(): string {
        const { apiPublisher, apiGroup, apiVersion } = this.route;
        return `${this.environment.apiRoot}/${apiPublisher}/${apiGroup}/${apiVersion}/companies(${this.companyId})`;
    }

    private async send<T>(
        method: string,
        url: string,
        body?: unknown,
        extraHeaders?: Record<string, string>,
    ): Promise<T | undefined> {
        const target = withTenant(this.environment, url);
        const response = await request({
            method,
            url: target,
            headers: { ...jsonHeaders(this.authorization), ...(extraHeaders ?? {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });

        if (response.status === 404) {
            throw new HelperNotInstalledError();
        }
        if (response.status < 200 || response.status >= 300) {
            throw new HttpError(response.status, target, describeBcError(response));
        }
        if (response.body.length === 0) {
            return undefined;
        }
        return response.json<T>();
    }

    async isHelperInstalled(): Promise<boolean> {
        try {
            await this.send('GET', `${this.base}/reportLayouts?$top=1`);
            return true;
        } catch (error) {
            if (error instanceof HelperNotInstalledError) {
                return false;
            }
            throw error;
        }
    }

    async getReportLayouts(reportId: number): Promise<ReportLayoutInfo[]> {
        const url = `${this.base}/reportLayouts?$filter=reportId eq ${reportId}`;
        const payload = await this.send<{ value: ReportLayoutInfo[] }>('GET', encodeURI(url));
        return payload?.value ?? [];
    }

    /**
     * Lists the fields of a table, including tables whose AL source is not available.
     * This is how a filter can be built for a partner or Microsoft table.
     */
    async searchFields(tableNo: number, typeName?: string): Promise<FieldInfo[]> {
        const clauses = [`tableNo eq ${tableNo}`];
        if (typeName) {
            clauses.push(`typeName eq '${typeName.replace(/'/g, "''")}'`);
        }
        const url = `${this.base}/bcFields?$filter=${clauses.join(' and ')}&$top=1000`;
        const payload = await this.send<{ value: FieldInfo[] }>('GET', encodeURI(url));
        return payload?.value ?? [];
    }

    async searchTables(searchText: string): Promise<ObjectInfo[]> {
        const escaped = searchText.replace(/'/g, "''");
        const filter = escaped
            ? `$filter=contains(objectCaption,'${escaped}')&$top=500`
            : '$top=500';
        const url = `${this.base}/bcObjects?${filter}`;
        const payload = await this.send<{ value: ObjectInfo[] }>('GET', encodeURI(url));
        return (payload?.value ?? []).filter((entry) => entry.objectType === 'Table');
    }

    private async createRequest(fields: RenderRequestFields): Promise<string> {
        const created = await this.send<{ id: string }>('POST', `${this.base}/layoutPreviewRequests`, fields);
        if (!created?.id) {
            throw new Error('The API did not return an id for the render request.');
        }
        return created.id;
    }

    private async deleteRequest(id: string): Promise<void> {
        try {
            await this.send('DELETE', `${this.base}/layoutPreviewRequests(${id})`, undefined, {
                'If-Match': '*',
            });
        } catch {
            // A leftover request row is harmless; never mask the original failure with a cleanup error.
        }
    }

    private async runRender(id: string): Promise<void> {
        await this.send('POST', `${this.base}/layoutPreviewRequests(${id})/Microsoft.NAV.render`, {}, {
            'If-Match': '*',
        });

        const state = await this.send<{ rendered: boolean; errorMessage: string }>(
            'GET',
            `${this.base}/layoutPreviewRequests(${id})`,
        );

        if (!state?.rendered) {
            throw new Error(state?.errorMessage || 'Business Central did not report why the render failed.');
        }
    }

    private async fetchPdf(id: string): Promise<Buffer> {
        const payload = await this.send<{ value: string }>(
            'POST',
            `${this.base}/layoutPreviewRequests(${id})/Microsoft.NAV.getPdf`,
            {},
            { 'If-Match': '*' },
        );
        if (!payload?.value) {
            throw new Error('The render produced no document.');
        }
        return Buffer.from(payload.value, 'base64');
    }

    /**
     * Renders a report with a layout that is already published in the environment.
     * An empty layout name renders with whatever the environment currently selects.
     */
    async renderRegisteredLayout(
        fields: Omit<RenderRequestFields, 'layoutFormat'> & { layoutFormat?: string },
    ): Promise<Buffer> {
        const id = await this.createRequest({ layoutFormat: 'RDLC', ...fields });
        try {
            await this.runRender(id);
            return await this.fetchPdf(id);
        } finally {
            await this.deleteRequest(id);
        }
    }

    /**
     * Renders a report with a layout supplied from the workspace.
     */
    async renderSuppliedLayout(fields: RenderRequestFields, layoutBytes: Buffer): Promise<Buffer> {
        const id = await this.createRequest({ ...fields, layoutName: '', applicationId: EMPTY_GUID });
        try {
            await this.send(
                'POST',
                `${this.base}/layoutPreviewRequests(${id})/Microsoft.NAV.setLayout`,
                { content: layoutBytes.toString('base64') },
                { 'If-Match': '*' },
            );
            await this.runRender(id);
            return await this.fetchPdf(id);
        } finally {
            await this.deleteRequest(id);
        }
    }
}
