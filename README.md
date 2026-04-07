# Fintech Microservices Platform

Production-oriented fintech backend with isolated services, API gateway auth, idempotent transactions, double-entry ledger, FX conversion/quotes, payroll queue processing, and admin observability.

## Services

- `auth-service` (`3008`): register/login/refresh/logout, token validation (gateway subrequest)
- `ledger-service` (`3001`): double-entry postings, invariant checks, balances, audit chain checks
- `transaction-service` (`3002`): idempotent transaction orchestration and recovery worker
- `account-service` (`3003`): account CRUD + balance via ledger
- `fx-service` (`3004`): quote + convert, single-use quote enforcement
- `payroll-service` (`3005`): asynchronous payroll batch processing via BullMQ
- `admin-service` (`3006`): monitoring and operational endpoints
- `api-gateway` (`8080`): centralized ingress, auth validation, correlation IDs
- `prometheus` (`9090`) + `grafana` (`3007`): monitoring

## Setup and Run

### Prerequisites

- Docker + Docker Compose
- OpenSSL (for RSA keys)

### 1) Generate JWT RSA keys

```bash
cd /home/common/Desktop/wa-mac
openssl genpkey -algorithm RSA -out auth-private.pem -pkeyopt rsa_keygen_bits:2048
openssl rsa -pubout -in auth-private.pem -out auth-public.pem

export AUTH_PRIVATE_KEY="$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' auth-private.pem)"
export AUTH_PUBLIC_KEY="$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' auth-public.pem)"
```

### 2) Start platform

```bash
docker compose -f infra/docker-compose.yml down --remove-orphans
docker compose -f infra/docker-compose.yml up -d --force-recreate
docker compose -f infra/docker-compose.yml ps
```

### 3) Gateway base URL

All business APIs go through:

- `http://localhost:8080`

## API Endpoint Summary

> All routes below are through gateway (`http://localhost:8080`).

### Auth Service

#### `POST /api/auth/register`
Request:
```json
{ "email": "admin@fin.local", "password": "StrongPass123!", "role": "admin" }
```
Response:
```json
{ "success": true, "user": { "id": "uuid", "email": "admin@fin.local", "role": "admin" } }
```

#### `POST /api/auth/login`
Request:
```json
{ "email": "admin@fin.local", "password": "StrongPass123!" }
```
Response:
```json
{ "success": true, "access_token": "...", "refresh_token": "...", "token_type": "Bearer", "expires_in": "15m" }
```

#### `POST /api/auth/refresh`
Request:
```json
{ "refresh_token": "..." }
```
Response:
```json
{ "success": true, "access_token": "...", "refresh_token": "...", "token_type": "Bearer", "expires_in": "15m" }
```

#### `POST /api/auth/logout`
Request:
```json
{ "refresh_token": "..." }
```
Response:
```json
{ "success": true, "message": "Logged out" }
```

### Account Service

#### `POST /api/accounts`
Request:
```json
{ "user_id": "user_001", "status": "ACTIVE" }
```
Response:
```json
{ "success": true, "account": { "id": "uuid", "user_id": "user_001", "status": "ACTIVE" } }
```

#### `GET /api/accounts/:id`
Response:
```json
{ "success": true, "account": { "id": "uuid", "user_id": "user_001", "status": "ACTIVE" } }
```

#### `GET /api/accounts/:id/balance`
Response:
```json
{ "success": true, "account": { "id": "uuid", "user_id": "user_001", "status": "ACTIVE" }, "balance": "0" }
```

### Transaction Service

#### `POST /api/transactions`
Headers: `Authorization`, `idempotency-key`

Request:
```json
{ "sender_id": "<account1>", "receiver_id": "<account2>", "amount": 100, "currency": "USD" }
```
Response (normal):
```json
{ "success": true, "transactionId": "uuid", "ledgerTransactionId": "uuid", "status": "COMPLETED" }
```
Response (ledger degraded):
```json
{ "success": false, "transactionId": "uuid", "message": "Ledger service timeout after 3000ms", "status": "PENDING" }
```

#### `GET /api/transactions/:id`
Response:
```json
{ "success": true, "transaction": { "id": "uuid", "status": "COMPLETED" } }
```

#### `GET /api/transactions/status/:status`
Response:
```json
{ "success": true, "status": "PENDING", "count": 0, "transactions": [] }
```

### Ledger Service

#### `POST /api/ledger`
Request:
```json
{ "senderId": "A", "receiverId": "B", "amount": 10, "currency": "USD" }
```
Response:
```json
{ "success": true, "message": "Entry created successfully", "transactionId": "uuid" }
```

#### `GET /api/ledger/check`
Response:
```json
{ "success": true, "status": "OK", "message": "Ledger is balanced" }
```

#### `GET /api/ledger/audit/check`
Response:
```json
{ "success": true, "status": "OK", "recordsChecked": 42 }
```

#### `GET /api/ledger/balance/:accountId`
Response:
```json
{ "success": true, "accountId": "uuid", "balance": "100.00" }
```

#### `GET /api/ledger/transaction/:id`
Response:
```json
{ "success": true, "transaction": { "id": "uuid" }, "entries": [{ "type": "DEBIT" }, { "type": "CREDIT" }] }
```

### FX Service

#### `POST /api/fx/quote`
Request:
```json
{ "from_currency": "USD", "to_currency": "BDT", "amount": 100 }
```
Response:
```json
{ "success": true, "quote_id": "uuid", "rate": 117.25, "expires_at": "timestamp" }
```

#### `POST /api/fx/convert`
Request (single-use quote):
```json
{ "from_currency": "USD", "to_currency": "BDT", "amount": 100, "quote_id": "uuid" }
```
Response:
```json
{ "success": true, "from_currency": "USD", "to_currency": "BDT", "amount": 100, "rate": 117.25, "converted_amount": 11725 }
```

### Payroll Service

#### `POST /api/payroll/run`
Request:
```json
{ "batch_reference": "APR-2026-BATCH-001", "jobs": [{ "employee_id": "emp_001", "sender_account_id": "A", "receiver_account_id": "B", "amount": 2500, "currency": "USD" }] }
```
Response:
```json
{ "success": true, "message": "Payroll run accepted", "runId": "uuid", "totalJobs": 1 }
```

#### `GET /api/payroll/run/:id`
Response:
```json
{ "success": true, "run": { "status": "PROCESSING" }, "jobs": [{ "status": "QUEUED" }] }
```

### Admin Service (admin role required)

#### `GET /api/admin/transactions`
Response:
```json
{ "success": true, "source": "transaction-service", "data": { "status": "PENDING", "transactions": [] } }
```

#### `GET /api/admin/ledger-status`
Response:
```json
{ "success": true, "source": "ledger-service", "data": { "status": "OK" } }
```

#### `POST /api/admin/recovery`
Request:
```json
{}
```
Response:
```json
{ "success": true, "message": "Manual recovery trigger completed", "data": { "pendingCount": 0 } }
```

## Idempotency: 5 Scenarios and Exact Handling

`transaction-service` uses `idempotency_keys` table + payload hash lock path.

1. **First request with new key**
   - inserts key as `PROCESSING`
   - creates transaction row
   - returns final response, stores response snapshot

2. **Same key + identical payload after completion**
   - existing key `COMPLETED` found
   - returns stored response without new transaction

3. **Same key + different payload**
   - hash mismatch
   - returns `409` conflict

4. **Same key while first request in-flight**
   - existing key `PROCESSING`
   - returns `409` (`Request already in progress`)

5. **Expired key reuse**
   - expired key is deleted and reclaimed
   - request treated as fresh claim

## Double-Entry Invariant

Invariant: for every ledger transaction,

`SUM(DEBIT amounts) - SUM(CREDIT amounts) == 0`

Verification:
- API: `GET /api/ledger/check`
- SQL logic groups by `transaction_id` and returns any imbalance set
- Monitoring metric: `ledger_invariant_status` (1 OK, 0 BROKEN)

## FX Quote Strategy

- Quote issuance endpoint: `POST /api/fx/quote`
- Quote has TTL (`FX_QUOTE_TTL_SECONDS`, default 30s)
- Conversion with `quote_id` enforces:
  - quote exists
  - not expired
  - `used_at IS NULL`
  - row locked (`FOR UPDATE`)
  - marked `used_at` during consume => **single-use**
- Provider failure handling:
  - if no internal book rate available for pair, returns `503` (`FX provider unavailable for requested pair`)

## Payroll Resumability Checkpoint Pattern

Pattern is DB-state checkpoint driven:
- `payroll_runs` tracks aggregate progress (`successful_jobs`, `failed_jobs`, `status`)
- each job state in `payroll_jobs` (`QUEUED` -> `PROCESSING` -> `SUCCESS`/`FAILED`)
- retries tracked with `attempts`
- worker crash/restart safety:
  - queue retries + DB state are authoritative checkpoints
  - run aggregate is recomputed after every terminal job update

## Audit Hash Chain

`ledger_audit_log` stores immutable event chain fields:
- `prev_hash`
- `hash`
- event payload

Hash format:
- Genesis: `sha256("GENESIS|<payload>")`
- Event: `sha256("<prev_hash>|<transaction_id>|<event_type>|<payload>")`

Tamper detection in practice:
- `GET /api/ledger/audit/check` replays the chain
- if any record hash mismatch or broken link (`prev_hash` mismatch), returns `TAMPERED`
- this detects manual row update/delete/reorder attempts in the audit trail

## Observability

- Prometheus scrape targets:
  - `transaction-service /metrics`
  - `ledger-service /metrics`
  - `payroll-service /metrics`
- Grafana dashboard: `infra/grafana/dashboards/fintech-overview.json`

Primary business metrics:
- `transactions_total`
- `transactions_failed`
- `transactions_pending`
- `ledger_invariant_status`
- `queue_jobs_processed`
- `queue_jobs_failed`

## Tradeoffs Under Time Pressure

- Used local compose + mounted code workflow instead of full CI pipeline deployment manifests
- Gateway trusts auth headers from Nginx path instead of service-level JWT verification for every service
- Internal FX quote provider uses local order book table, not external multi-provider aggregation
- Audit hash chain implemented in ledger service only (no cross-service global event chain)

## Before True Production Cutover

- Replace static compose secrets with KMS/Vault-backed secret management
- Add TLS termination, HSTS, strict CORS allowlist, and WAF policy
- Implement key rotation automation and JWKS key rollover playbook
- Add migration tooling and schema versioning per service
- Add CI/CD gates (SAST, dependency scan, integration/failure tests)
- Add centralized log shipping (ELK/OpenSearch) + SIEM alerts
- Add backup/restore drills for Postgres + Redis HA setup
