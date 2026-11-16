import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);

// The export schema has changed over time -- the timestamp column has been
// called both of these -- so resolve it per export rather than assuming one.
// Order matters: the first column present wins.
const DATE_COLUMNS = ['Time (UTC)', 'Time'];

function amountToInteger(amount) {
    return Math.round(Number(amount) * 100);
}

// Trading212 includes columns conditionally: merchant columns only appear when
// the window contains card activity, tax/result columns only when it contains
// sells or dividends. Only the timestamp is load-bearing, so fail loudly --
// naming the columns we did get -- rather than importing a garbage date.
function resolveDateColumn(row) {
    const column = DATE_COLUMNS.find(candidate => candidate in row);
    if (!column) {
        throw new Error(
            `No known date column in export. Expected one of ${DATE_COLUMNS.join(', ')}; ` +
            `got: ${Object.keys(row).join(', ')}`
        );
    }
    return column;
}

/**
 * Transforms parsed Trading212 CSV rows into Actual Budget transaction objects.
 *
 * @param {Array<object>} csvData - Parsed CSV rows from Trading212 export
 * @param {string} accountId - Target Actual Budget account ID
 * @returns {Array<object>} Transactions ready for Actual's importTransactions
 */
export function parseCSVData(csvData, accountId) {
    if (!accountId) {
        throw new Error("accountId is required for parsing CSV data");
    }
    if (!Array.isArray(csvData) || csvData.length === 0) {
        return [];
    }

    const dateColumn = resolveDateColumn(csvData[0]);

    const transactions = [];
    let skipped = 0;

    for (const row of csvData) {
        // Parsed as UTC because the column is explicitly UTC -- going through
        // local time could shift a late-evening transaction to the wrong day.
        // The emptiness check is not redundant: dayjs(undefined) is *now* and
        // reports itself valid, so a renamed column would otherwise import
        // every transaction dated today.
        const rawDate = row[dateColumn];
        const parsedDate = dayjs.utc(rawDate);
        const total = Number(row['Total']);
        if (!rawDate || !parsedDate.isValid() || !Number.isFinite(total)) {
            console.warn(`Skipping row ${row['ID'] || '<no id>'}: unusable date "${rawDate}" or Total "${row['Total']}".`);
            skipped++;
            continue;
        }

        const date = parsedDate.format('YYYY-MM-DD');
        let amount = amountToInteger(total);
        let imported_payee = null;
        const category = row['Merchant category'] || null;
        let notes = null;
        const imported_id = row['ID'];
        const cleared = true;

        switch (row['Action']) {
            case "Deposit":
                notes = `${row['Action']} (${row['Notes']})`;
                break;
            case "Card debit":
            case "Card credit": {
                // Merchant columns ship only with card activity; fall back so
                // notes can never read "undefined (...)".
                const merchant = row['Merchant name'] || row['Name'] || row['Action'];
                notes = row['Notes'] ? `${merchant} (${row['Notes']})` : merchant;
                imported_payee = row['Merchant name'] || null;
                break;
            }
            case "Spending cashback":
            case "Interest on cash":
                notes = row['Action'];
                break;
            case "Lending interest":
                notes = row['Notes'];
                break;
            case "Market buy":
                amount = -amount;
                notes = `${row['Action']} (${row['Ticker']})`;
                imported_payee = `${row['Name']} (${row['Ticker']})`;
                break;
            case "Market sell":
                notes = `${row['Action']} (${row['Ticker']})`;
                imported_payee = `${row['Name']} (${row['Ticker']})`;
                break;
            case "Dividend (Dividend)":
                notes = row['Action'];
                imported_payee = `${row['Name']} (${row['Ticker']})`;
                break;
            default:
                break;
        }

        const payee_name = imported_payee;

        transactions.push({
            account: accountId,
            date,
            amount,
            payee_name,
            imported_payee,
            category,
            notes,
            imported_id,
            cleared
        });
    }

    // Skipping the odd malformed row is fine; skipping all of them means the
    // export format changed under us, which must not look like a clean run.
    if (transactions.length === 0 && skipped > 0) {
        throw new Error(`All ${skipped} rows were unusable -- the export format has probably changed.`);
    }

    return transactions;
}
