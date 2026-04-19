# GitHub webhook fixtures — Phase G0

These fixtures are the golden wire-shape payloads the Bematist ingest
server will ever see from `github.com`. They drive:

1. The fixture-redaction CI gate (`fixtures.redaction.test.ts`) — merge
   blocker on any PR that introduces a fixture containing a real TLD,
   a PEM block, a stray `@`, or a real-looking GitHub token prefix.
2. Parser contract tests (RED → GREEN per PRD §13 step 3/4) — G1.
3. Persistence integration tests against a real local Postgres — G1.
4. Scoring-module tests — G2.
5. Playwright E2E — G1/G3, POSTs the raw payload + sidecar headers
   against `localhost:8000/v1/webhooks/github?org=<slug>`.

## Layout

```
packages/fixtures/github/
  <event>/
    <scenario>.json           # raw GitHub webhook body (bytes GitHub would POST)
    <scenario>.headers.json   # X-GitHub-Event, X-GitHub-Delivery, X-Hub-Signature-256
  .webhook-secret             # deterministic fixture secret — dev-only
  fixtures.redaction.test.ts  # CI redaction gate
  README.md
```

The `<scenario>.headers.json` sidecar is computed by the recorder using
the raw bytes of `<scenario>.json` and the contents of
`.webhook-secret`. Test runners POST `<scenario>.json` as the body with
the sidecar's headers; the existing HMAC verifier
(`apps/ingest/src/webhooks/verify.ts`) accepts the signature because
the ingest is configured to use the same fixture secret in dev.

## `.webhook-secret`

This file is a hardcoded, clearly non-sensitive dev-only string. It
only has meaning in combination with the fixture payloads: any real
GitHub webhook delivery will never be signed with it. We commit it to
the repo so the redaction gate is fully reproducible and any dev can
recompute signatures locally without a shared secret-manager dance.

**Do not copy this value anywhere real.** The repo has a pre-commit
hook that would refuse a real GitHub App webhook secret here anyway.

## Recording a new fixture

```bash
# From the repo root, capture stdin JSON:
gh api /repos/OWNER/REPO/hooks/HOOK_ID/deliveries/DELIVERY_ID \
  | bun run fixtures:github:record \
    --event pull_request \
    --scenario opened

# Or feed a hand-edited file:
cat /tmp/synthetic-pr.json \
  | bun run fixtures:github:record --event pull_request --scenario edge-case
```

The recorder:

1. Reads the payload from stdin.
2. Applies the same redaction ruleset as
   `fixtures.redaction.test.ts` (fails on real TLDs, PEM blocks,
   `@`-in-string-outside-allowed-domains, GitHub token prefixes).
3. Computes `X-Hub-Signature-256` via HMAC-SHA256 with the fixture
   secret over the final payload bytes.
4. Writes `<event>/<scenario>.json` + `<event>/<scenario>.headers.json`.

## Allowed fixture domains

The redaction gate only accepts these domain strings:

- `example.com`, `example.org`, `example.net`
- `test.invalid`
- `bematist.local`

Any other TLD-looking string in a committed fixture fails the gate.
Redact before recording: owner logins, repo names, PR titles, commit
messages, URLs, e-mails, and IDs.

## Bill of fixtures (G0)

| Event            | Scenario                    |
| ---------------- | --------------------------- |
| `pull_request`   | `opened`                    |
| `pull_request`   | `synchronize`               |
| `pull_request`   | `closed-merged-squash`      |
| `push`           | `regular`                   |
| `push`           | `forced`                    |
| `check_suite`    | `completed-success`         |
| `workflow_run`   | `completed`                 |
| `installation`   | `created`                   |

Phase G1 adds 12 edge-case fixtures; G3 adds 3 deployment fixtures.
