# Architecture Decisions

## 1) Gateway-Centric Auth Trust

**Decision**: validate JWT at Nginx gateway using auth subrequest (`/_auth`) and pass trusted identity headers (`X-Auth-Verified`, `X-User-Id`, `X-User-Role`) to services.

**Why**:
- single auth policy enforcement point
- avoids token verification duplication in every service
- simpler service code and standardized access control context

**Tradeoff**:
- services must not be exposed directly to untrusted networks
- strict network boundaries are mandatory

## 2) RS256 + JWKS

**Decision**: auth-service signs access tokens with RS256 and exposes JWKS endpoint.

**Why**:
- asymmetric keys improve key management posture
- supports future key rotation and external verifier compatibility

**Tradeoff**:
- requires key provisioning and secure secret handling discipline

## 3) Refresh Token Rotation + Hash Storage

**Decision**:
- refresh token stored hashed (`sha256`) in DB
- refresh operation rotates token atomically (delete old, insert new)

**Why**:
- leaked DB values cannot be replayed directly
- replay risk reduced through one-time refresh token semantics

## 4) Idempotency at Transaction Service Boundary

**Decision**:
- idempotency key + request hash + TTL in DB
- response snapshot persisted for deterministic replay

**Why**:
- financial transaction creation must be duplicate-safe under retries and partial failures

## 5) Pending-First Degradation for Ledger Outage

**Decision**:
- on ledger timeout/unreachability, transaction returns `202` and remains `PENDING`
- recovery worker retries with backoff

**Why**:
- prevents immediate hard-failure from transient downstream outages
- maintains eventual consistency path

## 6) Double-Entry Ledger + Invariant Endpoint

**Decision**:
- all money movement recorded as DEBIT + CREDIT pair in same transaction
- invariant check endpoint and metric exposed

**Why**:
- accounting correctness is core correctness condition

## 7) Ledger Audit Hash Chain

**Decision**:
- append-only audit log with `prev_hash` and `hash`
- deterministic chain verification endpoint

**Why**:
- tamper-evidence for critical financial posting events

## 8) FX Quote Lifecycle Safety

**Decision**:
- explicit quote issue endpoint with expiry
- single-use quote enforcement via `used_at` + row lock
- provider-failure explicit `503` response path

**Why**:
- avoids stale quote execution and quote replay
- transparent failure semantics for upstream callers

## 9) Payroll Resumability via DB State Checkpoints

**Decision**:
- job/run statuses in DB are source of truth
- worker updates per-job state and recomputes run aggregates

**Why**:
- crash/restart safe progression in batch financial flows

## 10) Observability as First-Class Requirement

**Decision**:
- Prometheus metrics endpoints in critical services
- Grafana dashboard for transaction, ledger, and queue health signals

**Why**:
- fast detection of failure modes and operational regressions

## 11) Time-Pressure Tradeoffs

- compose-centric deployment instead of full Kubernetes/IaC
- internal FX rate book before multi-provider smart routing
- centralized auth at gateway before mTLS service mesh
- no full compliance control pack yet (audit retention policy, SIEM integration, policy as code)

## 12) Pre-Production Blockers to Close

- move secrets/keys to managed secret store (Vault/KMS)
- TLS everywhere + strict CORS allowlist
- backup/restore runbooks and regular DR drills
- CI/CD policy gates (SAST, dependency/image scan, migration checks)
- runtime hardening (resource limits, autoscaling, zero-downtime rollout policy)
