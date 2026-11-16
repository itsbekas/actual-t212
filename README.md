# actual-t212

Library for fetching Trading212 transactions in [Actual Budget](https://actualbudget.org/) format.

## Usage

```js
import { getTransactions } from "actual-t212";

const transactions = await getTransactions({
  token: process.env.T212_TOKEN,
  accountId: "<actual-account-id>",
  fromDate: "2026-01-01T00:00:00.000Z",
  toDate: new Date().toISOString(),
});
```

Ranges longer than 360 days are automatically chunked to respect Trading212's export window limit.
