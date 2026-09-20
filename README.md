# CareStack Secure API

A REST API over a real hospital management MySQL schema (patients, appointments,
billing, staff, departments), containerized with Docker and shipped through a
CI/CD pipeline that blocks any build containing a known CRITICAL or HIGH
severity vulnerability.

## Stack

- Node.js 22 / Express 5
- MySQL 8 (stored procedures, triggers, and views for booking, billing, and
  discharge logic — not just raw CRUD)
- Docker (multi-stage build, non-root runtime user)
- GitHub Actions (Hadolint → npm audit → Docker build → Trivy scan gate →
  GHCR push)

## API

| Method | Route                   | Description                                      |
|--------|-------------------------|---------------------------------------------------|
| GET    | `/health`                | Liveness + DB connectivity check                  |
| GET    | `/patients`               | List patients                                     |
| GET    | `/appointments`            | List appointments (joined with doctor/patient)    |
| POST   | `/appointments`            | Book an appointment via `sp_BookAppointment`; returns 409 if the slot is taken |
| GET    | `/billing/:patientId`      | Billing records for a patient                     |

## Security decisions

**Least-privilege database access.** The API connects as a dedicated
`hospital_app` MySQL user scoped to `SELECT, INSERT, UPDATE, DELETE, EXECUTE`
on `hospital_db` only — not `root`. The `EXECUTE` grant is required because
booking goes through a stored procedure rather than raw INSERTs.

**Non-root container user.** The final image runs as the unprivileged `node`
user, not root, and the base image's own npm CLI (and its dependency tree —
`tar`, `pacote`, `sigstore`, and others) is stripped out of the runtime stage.
That CLI is only needed during the build stage's `npm ci`; leaving it in the
shipped image meant carrying several real, disclosed HIGH-severity
vulnerabilities in code that never executes at runtime. Trivy caught this
during development — 19 HIGH-severity findings, all traced to that unused
bundled tooling — and removing it cleared every one of them. Before/after
scan results are in this repo's Security tab.

**Trivy pinned to a commit SHA, not a version tag.** In March 2026,
`aquasecurity/trivy-action` and `aquasecurity/setup-trivy` were compromised
via stolen maintainer credentials (GHSA-69fq-xp46-6x23, CVE-2026-33634):
nearly every existing version tag (0.0.1–0.34.2) was retagged to point at a
credential-stealing payload, so pinning to `@v0.30.0` or any other tag would
silently pull malicious code with no visible diff. This workflow pins to a
specific commit SHA instead:

```yaml
uses: aquasecurity/trivy-action@a9c7b0f06e461e9d4b4d1711f154ee024b8d7ab8 # v0.36.0
```

Commit SHAs are immutable; tags are not. The SHA above was verified directly
against the upstream repo with `git ls-remote`, not taken from a cached or
fetched source.

## Pipeline

Every push to `main` and every pull request runs:

1. **Hadolint** — lints the Dockerfile itself before anything is built.
2. **`npm ci` + `npm audit --audit-level=high`** — checks the app's own
   dependency tree.
3. **Docker build** — builds the image, tagged with the commit SHA.
4. **Trivy scan** — scans the full built image (OS packages + application
   layer), fails the job on any CRITICAL/HIGH finding with a known fix, and
   uploads results as SARIF to the repo's Security tab.
5. **GHCR push** — only reachable if every step above passed; publishes
   `ghcr.io/<owner>/carestack-secure-api` tagged with both the commit SHA and
   `latest`.

## Running locally

```
npm install
cp .env.example .env   # fill in DB_HOST, DB_USER, DB_PASSWORD, DB_NAME
npm run dev
```

```
docker build -t carestack-secure-api:local .
docker run --rm -p 3000:3000 --env-file .env carestack-secure-api:local
```
