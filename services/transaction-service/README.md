# Transaction Service

## Folder Structure

```
transaction-service/
├── index.js
├── package.json
└── src/
    ├── app.js
    ├── index.js
    ├── db/
    │   └── db.js
    ├── services/
    │   ├── index.js
    │   └── transaction/
    │       ├── transaction.entity.js
    │       ├── transaction.js
    │       └── transaction.service.js
    └── utils/
        └── configs.js
```

## API

### `POST /api/transactions`

#### Headers
- `idempotency-key`: required (or provide in body as `idempotency_key`)

#### Body
```json
{
  "sender_id": "acct_1001",
  "receiver_id": "acct_2002",
  "amount": 250.75,
  "currency": "USD",
  "reference_id": "order_7799",
  "metadata": {
    "note": "invoice #7799"
  },
  "idempotency_key": "a5f6c52a-0fe8-4b3a-b1f1-9dcf3e0f5c9f"
}
```

#### Success Response
```json
{
  "success": true,
  "transactionId": "8b364e77-e8b4-4fdb-a201-164a7a2f50a8",
  "ledgerTransactionId": "2b7c6a62-2bd4-4b5e-8c44-0f6b1d0a9a60",
  "status": "COMPLETED"
}
```

#### Idempotency Scenarios
- Same key + same payload → returns cached response
- Same key + different payload → `409` error
- Concurrent requests → only one proceeds; others return `409`
- Expired key → treated as new request

### `GET /api/transactions/status/:status`

Allowed statuses: `PENDING`, `FAILED`, `COMPLETED`

#### Query Params
- `page` (default: `1`)
- `limit` (default: `50`, max: `200`)
- `sender_id`
- `receiver_id`

#### Example
`GET /api/transactions/status/PENDING?page=1&limit=20&sender_id=acct_1001`

```json
{
  "success": true,
  "status": "PENDING",
  "count": 1,
  "page": 1,
  "limit": 20,
  "transactions": [
    {
      "id": "8b364e77-e8b4-4fdb-a201-164a7a2f50a8",
      "sender_id": "acct_1001",
      "receiver_id": "acct_2002",
      "amount": "250.75",
      "currency": "USD",
      "status": "PENDING",
      "retry_count": 2,
      "last_retry_at": "2026-04-07T09:42:01.000Z",
      "next_retry_at": "2026-04-07T09:43:01.000Z",
      "created_at": "2026-04-07T09:40:01.000Z"
    }
  ]
}
```

### `GET /api/transactions/:id`

#### Example
```json
{
  "success": true,
  "transaction": {
    "id": "8b364e77-e8b4-4fdb-a201-164a7a2f50a8",
    "sender_id": "acct_1001",
    "receiver_id": "acct_2002",
    "amount": "250.75",
    "currency": "USD",
    "status": "COMPLETED",
    "ledger_transaction_id": "2b7c6a62-2bd4-4b5e-8c44-0f6b1d0a9a60",
    "idempotency_key": "a5f6c52a-0fe8-4b3a-b1f1-9dcf3e0f5c9f",
    "request_hash": "0e6d54a6b0b7c9b23e663b80a6c3c2ef1f3d5e3a4f2f9c4d41c3c0e99d8b7f2a",
    "retry_count": 0,
    "last_retry_at": null,
    "next_retry_at": null,
    "created_at": "2026-04-07T09:40:01.000Z"
  }
}
```

## Env Vars
- `PORT`
- `ORIGIN`
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASS`
- `DB_NAME`
- `IDEMPOTENCY_TTL_MINUTES`
- `LEDGER_SERVICE_URL`
- `RECOVERY_INTERVAL_MS`
- `RECOVERY_MAX_RETRIES`
- `RECOVERY_BASE_DELAY_MS`

## Notes
- Uses PostgreSQL transactions for atomicity.
- Writes `transactions` and `idempotency_keys` tables in `db.js` init.
- Recovery worker retries `PENDING` transactions with exponential backoff.
