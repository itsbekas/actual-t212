import axios from 'axios';
import { parse } from 'csv-parse/sync';
import dayjs from 'dayjs';
import { parseCSVData } from './parser.js';
import { Trading212Client } from './t212.js';

export { Trading212Client } from './t212.js';
export { parseCSVData } from './parser.js';

// Trading212 export requests are capped at 1 year; chunk in 360-day steps.
export const CHUNK_DAYS = 360;

// The export is generated asynchronously; give up eventually rather than
// spinning forever if Trading212 never produces a download link.
const MAX_DOWNLOAD_LINK_ATTEMPTS = 20;
const DOWNLOAD_LINK_RETRY_MS = 60000;

async function fetchCSVChunk(t212Client, fromDateISO, toDateISO) {
    const report = await t212Client.exportCSV(fromDateISO, toDateISO);
    if (report === null) {
        throw new Error(`Trading212 refused the export request for ${fromDateISO} -> ${toDateISO}.`);
    }
    const reportId = report.reportId;

    await new Promise(resolve => setTimeout(resolve, 10000));

    let exportData = null;
    for (let attempt = 1; !exportData || !exportData.downloadLink; attempt++) {
        const exportList = await t212Client.getExports();
        exportData = exportList.find(e => e.reportId === Number(reportId));

        if (!exportData || !exportData.downloadLink) {
            if (attempt >= MAX_DOWNLOAD_LINK_ATTEMPTS) {
                throw new Error(`Export ${reportId} had no download link after ${attempt} attempts.`);
            }
            console.warn(`No download link found for export ${reportId}. Retrying in 60 seconds (${attempt}/${MAX_DOWNLOAD_LINK_ATTEMPTS})...`);
            await new Promise(resolve => setTimeout(resolve, DOWNLOAD_LINK_RETRY_MS));
        }
    }

    const response = await axios.get(exportData.downloadLink);
    return parse(response.data, { columns: true });
}

/**
 * Fetches Trading212 transactions for a date range formatted for Actual Budget.
 * Automatically splits ranges larger than 360 days into sequential chunks.
 *
 * @param {object} options
 * @param {string} options.token - Trading212 API key ("keyId:keySecret")
 * @param {string} options.accountId - Target Actual Budget account ID
 * @param {string|Date} options.fromDate - Range start (ISO string or Date)
 * @param {string|Date} [options.toDate] - Range end (defaults to now)
 * @returns {Promise<Array<object>>} Actual-format transactions
 */
export async function getTransactions({ token, accountId, fromDate, toDate = new Date() }) {
    if (!token) {
        throw new Error("Trading212 API token is required.");
    }
    if (!accountId) {
        throw new Error("Actual accountId is required.");
    }

    const start = dayjs(fromDate);
    const end = dayjs(toDate);
    if (!fromDate || !start.isValid()) {
        throw new Error(`Invalid fromDate: "${fromDate}"`);
    }
    if (!end.isValid()) {
        throw new Error(`Invalid toDate: "${toDate}"`);
    }
    if (!start.isBefore(end)) {
        return [];
    }

    const t212Client = new Trading212Client(token);
    const allTransactions = [];

    let cursor = start;
    while (cursor.isBefore(end)) {
        const next = cursor.add(CHUNK_DAYS, 'day');
        const chunkEnd = next.isBefore(end) ? next : end;

        const csvRows = await fetchCSVChunk(t212Client, cursor.toISOString(), chunkEnd.toISOString());
        const parsed = parseCSVData(csvRows, accountId);
        allTransactions.push(...parsed);

        cursor = chunkEnd;
    }

    return allTransactions;
}
