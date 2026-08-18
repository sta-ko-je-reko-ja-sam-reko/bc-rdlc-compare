import * as path from 'path';
import * as vscode from 'vscode';

export function layoutFormatFor(fsPath: string): string {
    switch (path.extname(fsPath).toLowerCase()) {
        case '.rdlc':
        case '.rdl':
            return 'RDLC';
        case '.docx':
            return 'Word';
        case '.xlsx':
            throw new Error(
                `${path.basename(fsPath)} is an Excel layout. The comparison renders both sides to PDF, ` +
                    'and Business Central cannot save a report to PDF with an Excel layout.',
            );
        default:
            throw new Error(`${path.basename(fsPath)} is not a report layout. Expected .rdlc, .rdl or .docx.`);
    }
}

export interface InferredReport {
    reportId: number;
    /** Name of the first dataitem's source table, as written in the AL source. */
    dataItemTable?: string;
}

/**
 * Finds the report that uses a layout file by looking for the AL object whose rendering section
 * references it, and reads its first dataitem, so neither has to be typed by hand.
 */
export async function inferReport(layoutUri: vscode.Uri): Promise<InferredReport | undefined> {
    const layoutName = path.basename(layoutUri.fsPath);
    const alFiles = await vscode.workspace.findFiles('**/*.al', '**/node_modules/**', 4000);

    for (const file of alFiles) {
        let text: string;
        try {
            text = Buffer.from(await vscode.workspace.fs.readFile(file)).toString('utf8');
        } catch {
            continue;
        }

        if (!text.includes(layoutName)) {
            continue;
        }

        const reportMatch = /\breport(?:extension)?\s+(\d+)\s+"?[^"\r\n]+"?/i.exec(text);
        if (!reportMatch) {
            continue;
        }

        return {
            reportId: Number(reportMatch[1]),
            dataItemTable: firstDataItemTable(text),
        };
    }

    return undefined;
}

/**
 * Reads the source table of the first dataitem, which is the record a report is run against.
 */
export function firstDataItemTable(alSource: string): string | undefined {
    const match = /\bdataitem\s*\(\s*[^;()]+;\s*(?:"([^"]+)"|([A-Za-z0-9_]+))\s*\)/i.exec(alSource);
    if (!match) {
        return undefined;
    }
    return match[1] ?? match[2];
}

/**
 * Builds a Business Central view string from field=filter pairs separated by semicolons,
 * for example "No.=1000..1010;Type=Item".
 */
export function buildFilterView(filterText: string): string {
    const trimmed = filterText.trim();
    if (!trimmed) {
        return '';
    }

    const clauses = trimmed
        .split(';')
        .map((pair) => pair.trim())
        .filter((pair) => pair.length > 0)
        .map((pair) => {
            const separator = pair.indexOf('=');
            if (separator < 0) {
                throw new Error(`"${pair}" is not a field=filter pair.`);
            }
            const field = pair.slice(0, separator).trim();
            const value = pair.slice(separator + 1).trim();
            return `${field}=FILTER(${value})`;
        });

    return `WHERE(${clauses.join(',')})`;
}

/**
 * Builds the request page parameter document from simple name=value pairs, for reports whose
 * request page has options that must be set before they will run.
 */
export function buildRequestPageXml(reportId: number, optionText: string): string {
    const trimmed = optionText.trim();
    if (!trimmed) {
        return '';
    }

    const fields = trimmed
        .split(';')
        .map((pair) => pair.trim())
        .filter((pair) => pair.length > 0)
        .map((pair) => {
            const separator = pair.indexOf('=');
            if (separator < 0) {
                throw new Error(`"${pair}" is not a name=value pair.`);
            }
            const name = pair.slice(0, separator).trim();
            const value = pair.slice(separator + 1).trim();
            return `<Field name="${escapeXml(name)}">${escapeXml(value)}</Field>`;
        })
        .join('');

    return (
        '<?xml version="1.0" encoding="utf-8" standalone="yes"?>' +
        `<ReportParameters id="${reportId}">` +
        `<Options>${fields}</Options>` +
        '</ReportParameters>'
    );
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
