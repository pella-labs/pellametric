# Bill of Rights Rider

**Status:** draft (Sprint 1)
**Owner:** Workstream I — Compliance & Legal
**Audience:** enterprise counsel, Data Protection Officers, works-council / CSE / RSU
representatives, procurement legal review.

**Relationship to other artifacts.** This rider is the formal contractual parallel to the
six-item customer-facing Bill of Rights published at `/privacy` and canonicalized in
`packages/config/src/bill-of-rights.ts`. The friendly list at PRD §6.5 is marketing-tone;
this rider is its operative contract-language twin, drafted so that the two documents
cite identical product controls and identical statutory anchors. Intended to be appended
as a rider to the customer Master Services Agreement, to the customer Data Processing
Agreement, and — in BetrVG §87(1) Nr. 6 jurisdictions — as an annex to the local
Betriebsvereinbarung (see `works-agreement-DE.md`). This document does not re-paraphrase
the PRD §6.5 text; it is a parallel formal instrument.

**Rider absorbs three wording gaps in the currently-locked PRD §6.5 text** (tracked in
`dev-docs/workstreams/i-compliance-prd.md` §6.5 as W-1, W-2, W-3). The absorption
approach is documented in §"Absorption of PRD §6.5 wording gaps" below.

## Cross-reference table

| Rider paragraph | PRD §6.5 item (abbreviated) | Primary statutory anchors |
|---|---|---|
| Right 1 — Prompt-text egress transparency | Item 1 ("prompts never leave your laptop unless you see a banner") | GDPR Art. 5(1)(c); Art. 13(1)(c); Art. 25(2) |
| Right 2 — Prompt confidentiality vis-à-vis management | Item 2 ("manager cannot read your prompts" + three exceptions) | BetrVG §75; GDPR Art. 5(1)(b); Art. 6(1)(f); Statuto Art. 4 |
| Right 3 — Subject access, portability, and accelerated erasure | Item 3 ("see every byte; export or delete, 7-day SLA") | GDPR Art. 15, Art. 17, Art. 20, Art. 12(3) |
| Right 4 — Privacy-by-default and signed tier change | Item 4 ("default is counters + envelopes; signed + 7d to change") | GDPR Art. 25(1)–(2); Art. 6(1) |
| Right 5 — Auditability of data access | Item 5 ("every access logged; you can request the log") | GDPR Art. 30; Art. 12(4); Art. 5(2) |
| Right 6 — Transparency of management drill-down views | Item 6 ("notified when a manager views your drill page") | GDPR Art. 14; Art. 88; BetrVG §87(1) Nr. 6; EDPB Op. 2/2017 |

---

## Right 1 — Prompt-text egress transparency

**Provision.** The Controller shall not transmit raw prompt text, prompt content
payloads, tool arguments, tool outputs, file contents, file paths, diffs, ticket
identifiers, electronic-mail addresses, or real names from the data subject's endpoint
to any centralized ingest surface or downstream processor, except where the endpoint has
first displayed an in-IDE notification banner to the data subject describing the scope,
tier, and destination of the transmission. For the avoidance of doubt, this Provision
governs the transmission of *prompt text and associated identifying payloads*; redacted
event envelopes, numerical counters, locally-abstracted workflow summaries, and derived
embeddings emitted by the on-device pipeline described in PRD §8.7 may leave the
endpoint under the Tier-B shipped default and are not within the scope of this
Provision. The egress journal maintained on the endpoint shall record every byte
transmitted and shall be inspectable by the data subject on demand.

**Statutory basis.** General Data Protection Regulation Art. 5(1)(c) (data minimization
— limiting personal data processed to that which is necessary in relation to the
purposes for which they are processed); GDPR Art. 13(1)(c) (obligation to inform the
data subject of the purposes of processing and the legal basis therefor at the time the
personal data are obtained); GDPR Art. 25(2) (data-protection-by-default — ensuring
that, by default, only personal data necessary for each specific purpose of processing
are processed and are not made accessible without the individual's intervention to an
indefinite number of natural persons). For employees in Germany, Betriebsverfassungsgesetz
§87(1) Nr. 6 (co-determination on monitoring-capable systems) requires that the scope of
egress be disclosed in the Betriebsvereinbarung. For employees in France, Code du
travail Art. L1222-4 (no information concerning an employee personally may be collected
by a device which has not been brought to the employee's attention prior to its
implementation).

**Product control.** Enforced through four concentric technical controls. First, the
shipped default is Tier B (counters plus server-side-redacted event envelopes, per PRD
Decision D7); raw prompt text is not captured, not persisted, and not transmitted under
this default. Second, server-side ingest implements a deny-list of forbidden fields
(`rawPrompt`, `prompt_text`, `messages`, `toolArgs`, `toolOutputs`, `fileContents`,
`diffs`, `filePaths`, `ticketIds`, `emails`, `realNames`) and rejects any payload
containing these fields with HTTP 400; this rejection is verified in continuous
integration by an adversarial fuzzer that must achieve one-hundred-percent rejection
before any release is cut. Third, the collector endpoint maintains a local append-only
SQLite egress journal recording every byte transmitted to the ingest surface,
inspectable at any time by the data subject via the command `bematist audit --tail`.
Fourth, the collector supports an egress allowlist via the `--ingest-only-to` flag with
TLS certificate pinning, such that a compromised or substituted collector binary cannot
exfiltrate payloads to an attacker-controlled destination. Tier-C processing (full
events including prompt text) requires an explicit per-project opt-in by the data
subject or a tenant-wide administrator change governed by Right 4 below.

**Verification.** The customer's Data Protection Officer or works-council counsel may
exercise this control by (a) inspecting the Apache-2.0-licensed source code of
`packages/redact` to confirm the deny-list enforcement and the configuration of
TruffleHog, Gitleaks, and Presidio rulesets as described in PRD §8.7; (b) running
`bematist audit --tail --verbose` on any endpoint of the data subject's choice and
inspecting the local SQLite egress journal to confirm that only enumerated, redacted,
envelope-class payloads have been transmitted; (c) reviewing the continuous-integration
test artifact `bun run test:privacy` which executes the forbidden-field adversarial
fuzzer against the ingest surface on every pull request; (d) examining the Sigstore /
cosign release-signature chain to confirm that the collector binary running on the
endpoint is the canonical release artifact; (e) requesting, through the Processor, a
nightly invariant-scan report that asserts zero forbidden-field occurrences in the
`events_raw` ClickHouse table for the customer's tenant.

## Right 2 — Prompt confidentiality vis-à-vis management

**Provision.** Personnel holding a managerial or reporting role within the customer's
organization shall not be granted read access to the raw prompt text of any individual
employee, save in three enumerated cases: (i) the individual employee has executed an
explicit per-project opt-in through the `/me/consents` surface to share full prompt text
for a specified project scope; (ii) a tenant administrator has executed a tenant-wide
full-prompt mode change in accordance with Right 4 of this rider (Ed25519-signed policy
change, seven-day cooldown, in-IDE banner delivery to every affected individual
contributor before the change takes effect); or (iii) a legal-hold has been lawfully
issued and executed by a user holding the Auditor role within the tenant, with the
legal-hold recorded on the `audit_log` table and accessible to the affected employee on
request. Each such access shall be recorded contemporaneously in the `audit_log` table.
Exports of prompt text via CSV or equivalent mechanisms shall require two-factor
authentication and a corresponding `audit_log` entry.

**Statutory basis.** Betriebsverfassungsgesetz §75 (equal treatment and protection of
the personal rights of employees, including the general right of personality under
Art. 2(1) read with Art. 1(1) of the Grundgesetz); GDPR Art. 5(1)(b) (purpose limitation
— personal data collected for a specified, explicit, and legitimate purpose shall not be
further processed in a manner incompatible with those purposes); GDPR Art. 6(1)(f)
(legitimate-interests balancing test, which under EDPB Opinion 2/2017 on data processing
at work tilts against managerial prompt-text access absent specific justification). For
Italian employees, Statuto dei Lavoratori Art. 4 (remote-monitoring-capable systems
require a prior union agreement enumerating permitted purposes); the three named
exceptions above align with the "specific, justified, and agreed-upon" exceptions
pattern required by Art. 4. For French employees, Code du travail Art. L2312-38 (CSE
information and consultation on working conditions and worker health, including systems
capable of monitoring performance) requires advance disclosure of the exception scheme.

**Product control.** Enforced through PostgreSQL row-level-security policies on every
table surfacing `prompt_text` or its derivatives, with the manager principal denied
`SELECT` on prompt-text columns by default; the RLS configuration is merge-blocked by an
adversarial cross-tenant and cross-role probe (`INT9`) that must return zero rows before
any release is cut. The user-interface "Reveal" gesture required to surface prompt text
writes an `audit_log` row containing the actor identifier, target engineer identifier
hash, surface, timestamp, and the tier at time of view (`tier_at_view` column of
`audit_events`, per PRD Decision D30). CSV exports containing prompt columns are gated
by a two-factor-authentication challenge and a corresponding audit entry. The three
enumerated exceptions are technically distinguishable: exception (i) is represented by a
row in the `consents` table with `scope='project'` and `tier='C'`; exception (ii) is
represented by a signed Ed25519 policy change governed by Right 4 below; exception (iii)
is represented by an `audit_events` row with `reveal_gesture=true` and actor role
`auditor`.

**Verification.** The customer's Data Protection Officer may exercise this control by
(a) inspecting the PostgreSQL RLS policies in the Apache-2.0-licensed source under
`packages/schema/postgres/` and confirming that the policies governing prompt-text
access carry both `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`; (b)
requesting a read-only SQL export, scoped by the customer's tenant, of the last ninety
days of `audit_log` rows whose `action='prompt_reveal'`, and verifying against the
`consents` table that every such row corresponds to one of the three enumerated
exceptions; (c) running the adversarial cross-role probe test suite (`bun run
test:privacy` — INT9 subsuite) locally against a self-hosted deployment and confirming
that the cross-role probe returns zero rows; (d) executing, as a named manager
principal, a direct SQL query attempting `SELECT prompt_text FROM events` and confirming
that the query returns zero rows by virtue of the RLS policy rather than of an
application-layer filter; (e) for any exception (ii) activation, requesting the signed
Ed25519 policy file and cross-validating its signature under Right 4 Verification.

## Right 3 — Subject access, portability, and accelerated erasure

**Provision.** The data subject shall be entitled, on request, to receive a complete
export of all personal data held by the Controller concerning that data subject, in a
structured, commonly used, and machine-readable format, within seven (7) calendar days
of the request being received; and shall be entitled, on request, to have all personal
data held concerning that data subject erased within seven (7) calendar days of the
request being received, subject only to the aggregate-retention carve-out under GDPR
Art. 17(3)(e) whereby aggregates keyed on `HMAC(engineer_id, tenant_salt)` are retained
indefinitely as non-personal data. The seven-day service-level-agreement commitment is a
voluntary contraction of the statutory one-month response period under GDPR Art. 12(3)
and shall not be interpreted to limit the data subject's statutory rights.

**Statutory basis.** GDPR Art. 15 (right of access by the data subject); GDPR Art. 17
(right to erasure — "right to be forgotten"); GDPR Art. 20 (right to data portability);
GDPR Art. 12(3) (information on action taken on a request under Articles 15 to 22 shall
be provided without undue delay and in any event within one month of receipt of the
request). GDPR Art. 17(3)(e) preserves the Controller's right to retain data in
aggregated, de-identified form under the conditions set out therein. For UK-situated
data subjects, UK-GDPR Art. 15, 17, 20, and 12(3) apply in parallel, with the
Information Commissioner's Office "Monitoring Workers" guidance (October 2023)
reinforcing the subject-access obligation in the employment context. For California-
resident employees, the California Consumer Privacy Act as amended by the California
Privacy Rights Act (Cal. Civ. Code §1798.100 et seq.; employee data in-scope from
1 January 2023) provides parallel access and deletion rights.

**Product control.** Enforced through two command-line interfaces on the collector
(`bematist export` and `bematist erase`) which trigger server-side workflows writing
to the `erasure_requests` Postgres table with a seven-day SLA watchdog. Erasure is
executed by `DROP PARTITION` on the ClickHouse `events` table, which is partitioned by
`(tenant_id, engineer_id, day)` per PRD Decision D15, making erasure atomic and
auditable at the storage layer rather than through logical `DELETE` mutations (which
would violate Tier-A retention guarantees, per the challenger-review C1 blocker fix).
A weekly batched mutation worker executes secondary cleanups on any denormalized table
that is not partitioned for drop (PRD Decision D8). Export is executed against the same
partition boundary, producing a JSON export bundle with a SHA-256 manifest for integrity
verification. Email confirmation is dispatched on completion of either operation, and a
corresponding entry is written to `audit_log`. The seven-day SLA is enforced end-to-end
by the integration test `INT12` which is merge-blocking on changes to `packages/api`
erasure surfaces or to the partition-drop worker.

**Verification.** The customer's Data Protection Officer may exercise this control by
(a) submitting a test erasure request against a seeded test engineer identifier and
confirming, by SQL inspection of the `erasure_requests` table, that the request is
marked complete with a timestamp within seven calendar days of the request timestamp;
(b) confirming, by a SQL `SELECT count(*) FROM events WHERE engineer_id = <hash>` query
against the ClickHouse cluster, that the count returns zero rows after erasure
completion; (c) reviewing the integration-test artifact `INT12` in the repository
continuous-integration output; (d) inspecting the `audit_log` table for the paired
`erasure_requested` and `erasure_completed` rows with matching request identifier; (e)
requesting a copy of the signed completion email transmitted to the data subject, which
includes the SHA-256 manifest hash; (f) validating the manifest hash against the
exported JSON bundle by local recomputation.

## Right 4 — Privacy-by-default and signed tier change

**Provision.** The Controller shall operate, by shipped default and without any customer
configuration action required, in Tier B (counters plus server-side-redacted event
envelopes, with raw prompt text neither captured nor persisted). Any change from Tier B
to Tier C (full events including prompt text) shall require all three of the following
conditions, cumulatively: (a) a tenant-policy file cryptographically signed with an
Ed25519 signature corresponding to the tenant administrator key of record; (b) a
mandatory seven (7) calendar day cooldown period between the signed policy change being
recorded server-side and the change taking effect on any endpoint; and (c) the delivery
of an in-IDE banner notification to every individual contributor affected by the change,
displayed on the first session of that individual contributor following the cooldown and
before any Tier-C payload is captured from that endpoint. For managed-cloud deployments,
Tier-C operation additionally requires the `org.tier_c_managed_cloud_optin` flag to be
set to true server-side; a client-side policy file is not the security boundary.

**Statutory basis.** GDPR Art. 25(1) (data protection by design and by default — the
Controller shall implement appropriate technical and organizational measures, such as
pseudonymization, which are designed to implement data-protection principles in an
effective manner); GDPR Art. 25(2) (in particular, such measures shall ensure that by
default personal data are not made accessible without the individual's intervention to
an indefinite number of natural persons); GDPR Art. 6(1) (lawful basis — a change from
Tier B to Tier C expands the processing scope and requires a distinct lawful basis,
which the signed-config-plus-cooldown-plus-banner sequence evidences through contractual
documentation plus transparency plus the opportunity for the data subject to object).
For employees, the Art. 6(1)(f) legitimate-interests balancing test under EDPB Opinion
2/2017 is highly fact-dependent on transparency; the cooldown and banner together
constitute the "specific, reasoned, and auditable" opportunity to object without
retaliation that works-council counsel will evaluate.

**Product control.** Enforced through PRD Decision D20. The tenant-policy file is
validated server-side against an Ed25519 public key registered for the tenant at
provisioning; a policy file lacking a valid signature is rejected with HTTP 400 at the
admin API and never takes effect. The seven-day cooldown is enforced by a scheduled
worker that refuses to activate a tier change whose `signed_at` timestamp is less than
seven calendar days prior to the current server time. The in-IDE banner is delivered by
the collector's policy-synchronization poll; the banner display is a blocking
precondition to any subsequent Tier-C event capture from that endpoint, recorded in the
collector's local state and surfaced in `bematist policy show`. Complementary
enforcement: the Tier-A `raw_attrs` allowlist is applied at write time (challenger
review control C10) to prevent the symmetric failure mode where a tenant on Tier A
accidentally accepts broader attributes through schema drift. Managed-cloud ingest
rejects Tier-C payloads with HTTP 403 unless `org.tier_c_managed_cloud_optin=true`.

**Verification.** The customer's Data Protection Officer may exercise this control by
(a) inspecting the `tenant_policies` table in Postgres and confirming, by running
`openssl pkeyutl -verify` against the stored signature, that the currently-active policy
is signed by the registered Ed25519 key and not by any other key; (b) requesting the
policy-change audit trail from `audit_log` for the tenant and confirming that every
`policy_change` row carries a `signed_at` timestamp preceding its `activated_at`
timestamp by at least seven calendar days; (c) running `bematist policy show` on an
endpoint and confirming that the displayed effective tier matches the signed policy, and
that the banner-acknowledged timestamp is recorded locally; (d) inspecting the collector
source under `apps/collector/` to confirm that the banner-delivery gate is an enforced
precondition to Tier-C capture, not an advisory log message; (e) for managed-cloud
deployments, confirming by admin-API introspection that the `org.tier_c_managed_cloud_optin`
flag is the server-side gate and that a client-side policy file cannot bypass it.

## Right 5 — Auditability of data access

**Provision.** Every access by any principal (manager, administrator, auditor,
automated system, or other) to personal data of a data subject shall be recorded
contemporaneously in an append-only audit-log table maintained by the Controller. The
data subject shall be entitled, on request, to receive a complete copy of all audit-log
entries concerning access to that data subject's personal data, in a structured and
machine-readable format, without charge and without requiring justification. Audit-log
entries are retained indefinitely as non-personal records of processing activity,
consistent with GDPR Art. 30(1). Neither the application role nor any other non-
administrative principal shall be granted `UPDATE` or `DELETE` privileges against the
audit-log table at the database layer; append-only integrity is a database-enforced
invariant, not merely an application-layer convention.

**Statutory basis.** GDPR Art. 30 (records of processing activities — the Controller
shall maintain a record of processing activities under its responsibility, including the
categories of recipients to whom personal data have been or will be disclosed); GDPR
Art. 12(4) (if the Controller does not take action on the request of the data subject,
the Controller shall inform the data subject without delay and at the latest within one
month of receipt of the request of the reasons for not taking action and of the
possibility of lodging a complaint with a supervisory authority); GDPR Art. 5(2)
(accountability — the Controller shall be responsible for, and be able to demonstrate
compliance with, Art. 5(1)). For German employees, BetrVG §87(1) Nr. 6 transparency
obligations extend to the audit-log contents by virtue of the monitoring-capable-system
classification established in EDPB Opinion 2/2017.

**Product control.** Enforced through a PostgreSQL `audit_log` table configured as
append-only at the database level by executing `REVOKE UPDATE, DELETE ON audit_log FROM
PUBLIC` and by granting only `INSERT` and `SELECT` privileges to the application role.
The append-only invariant is verified at deploy time by a pre-flight database assertion
and at continuous-integration time by a migration-linter. Per PRD Decision D30, a
companion `audit_events` table records per-view drill-downs into individual data
subjects (distinct from the general `audit_log` which records all actions). The data
subject may retrieve their personal audit trail at any time via `bematist audit
--my-accesses`, which returns all rows of `audit_log` and `audit_events` whose
`target_engineer_id_hash` matches the invoking data subject. Row-level-security policies
on both tables restrict read access to (i) the acting principal within their own
tenant, (ii) the target data subject, and (iii) the Auditor role within the tenant
scope.

**Verification.** The customer's Data Protection Officer may exercise this control by
(a) inspecting the Postgres migration history under `packages/schema/postgres/` and
confirming the presence of the `REVOKE UPDATE, DELETE ON audit_log` statement in the
authoritative migration for that table; (b) connecting to the Postgres instance as a
user with only application-role privileges and attempting an `UPDATE audit_log SET …`
or `DELETE FROM audit_log WHERE …` statement, confirming that both fail with a
permissions error rather than succeeding silently; (c) running `bematist audit
--my-accesses` against a seeded test data subject and verifying that the returned rows
match, row-for-row, the rows present in the `audit_log` and `audit_events` tables for
that subject; (d) inspecting the RLS policies on both tables and confirming the three-
way policy (actor / target / auditor) described above is in force; (e) requesting the
monthly accountability report under GDPR Art. 5(2), which the Controller generates by
aggregating `audit_log` activity-type counts within the tenant.

## Right 6 — Transparency of management drill-down views

**Provision.** Where a principal holding a managerial role within the customer's
organization exercises a view operation against a surface that drills down into the
personal data of a specific individual contributor (including but not limited to
`/me`, `/team/:slug`, `/sessions/:id`, and `/clusters/:id` when scoped to a named
individual contributor), a record of that view shall be written contemporaneously to
the `audit_events` table. The affected individual contributor shall receive, at
minimum, a daily digest of such view events; and shall be entitled to elect, through
the `/me/notifications` surface, to receive immediate notifications of each such view.
The election to receive immediate notifications shall not be conditioned on any premium
subscription or paid tier. Opt-out of notifications is permitted at the individual
contributor's election; transparency of managerial views remains the shipped default
posture and is not a feature that the Controller may disable for the tenant as a whole.

**Statutory basis.** GDPR Art. 14 (information to be provided where personal data have
not been obtained from the data subject — in employment contexts, where aggregation,
cross-referencing, and managerial drill-down views produce derived personal data that
were not directly collected from the data subject, the transparency obligation extends
to the existence and operation of those views); BetrVG §87(1) Nr. 6 (co-determination on
monitoring-capable systems — the works council is entitled to negotiate the scope and
transparency of managerial views, and EDPB Opinion 2/2017 clarifies that any system
"suitable to monitor" employees triggers this co-determination regardless of the
Controller's subjective intent); GDPR Art. 5(1)(a) (lawfulness, fairness, and
transparency of processing); GDPR Art. 88 (processing in the context of employment —
Member States may, by law or by collective agreements, provide for more specific rules
to ensure the protection of the rights and freedoms of employees).

**Product control.** Enforced through PRD Decision D30. The `audit_events` table
(schema proposal at `dev-docs/workstreams/i-compliance-prd.md` §9.1) captures, for each
managerial view, the acting user identifier, the tenant scope, the HMAC-pseudonymized
target engineer identifier, the specific URL surface, the session identifier hash (when
the view is session-scoped), a boolean flag indicating whether a Reveal gesture was
performed, the tier at time of view, and the user-agent and IP-address hashes for
audit-trail integrity. The daily-digest delivery is executed by a scheduled worker
querying the index `(actor_org_id, target_engineer_id_hash, ts DESC)`; the immediate-
notification election is persisted on the `users.notification_preferences` column and is
honored by the same worker's event-driven path. The immediate-notification feature
ships in the Apache-2.0-licensed manager dashboard and is not gated by any commercial
license or subscription tier.

**Verification.** The customer's Data Protection Officer may exercise this control by
(a) inspecting the `audit_events` table schema in the Postgres migration history and
confirming that all columns enumerated above are present, `NOT NULL` where mandated,
and indexed as specified; (b) exercising a managerial view against a seeded test
individual contributor account and confirming, within five minutes, the presence of a
new row in `audit_events` whose columns match the exercised view; (c) confirming that
the seeded test individual contributor receives the digest notification on the next
scheduled delivery, and — if immediate-notification election is active — within five
minutes of the view; (d) inspecting the pricing and packaging documentation to confirm
that immediate-notification election is not a premium feature; (e) running `bun run
test:privacy` and confirming that the `audit_events` RLS probe returns zero cross-
tenant rows; (f) requesting, through the Processor, a reconciliation report between
`audit_events` rows and manager-dashboard access logs at the web-application layer,
which shall match row-for-row within a tolerance window of zero missed events
(duplicates permitted but not missing rows).

---

## Absorption of PRD §6.5 wording gaps

This rider is drafted such that three known wording risks in the currently-locked PRD
§6.5 text are absorbed by the Provision and Product-Control paragraphs above. The
absorption does not amend PRD §6.5 itself; a separate pull request proposing that
amendment is tracked at `dev-docs/workstreams/i-compliance-prd.md` §6.5 as W-1, W-2,
W-3. Until the amendment lands, this rider is the operative document for enterprise
legal review.

**W-1. PRD §6.5 item 1 uses the absolute "never."** The locked friendly text states that
prompts "never leave your laptop unless you see a banner." Taken literally, the text
overclaims against the Tier-B shipped default, under which redacted event envelopes,
derived embeddings, and abstracted workflow summaries do leave the endpoint. **Rider
Right 1 Provision** absorbs this gap by explicitly distinguishing "raw prompt text and
associated identifying payloads" (which are the target of the no-egress-without-banner
commitment) from "redacted event envelopes, numerical counters, locally-abstracted
workflow summaries, and derived embeddings" (which are within the Tier-B default egress
scope and are transparently journaled). Enterprise counsel reading the rider therefore
does not encounter an overclaim.

**W-2. PRD §6.5 item 2 is a period-fragment that defers the three exceptions.** The
locked friendly text reads "Your manager cannot read your prompts. Until one of three
named exceptions applies." and relies on a sub-page to enumerate the exceptions. For
enterprise contract review this is insufficient. **Rider Right 2 Provision** absorbs
this gap by enumerating inline, with subsection letters (i), (ii), (iii), all three
exceptions: per-project IC opt-in, Ed25519-signed tenant-wide tier change under Right 4,
and legal-hold by Auditor. The Product-Control paragraph further specifies the
technical distinguishability of the three exception paths so that a DPO reviewing
`audit_log` entries can classify each reveal event unambiguously.

**W-3. PRD §6.5 item 4 omits the Ed25519 signature and IC banner.** The locked friendly
text refers only to "a signed config + 7-day delay." The actual product control per PRD
Decision D20 is the conjunction of an Ed25519-signed policy, a seven-day cooldown, and
in-IDE banner delivery to every affected individual contributor. **Rider Right 4
Provision** absorbs this gap by stating all three conditions as cumulative, and the
Product-Control paragraph specifies the server-side signature validation, the cooldown
worker, and the banner-acknowledged-before-capture enforcement. Counsel reviewing for
EU AI Act and EDPB Opinion 2/2017 compliance therefore sees the full control surface.

---

## Counsel review checklist

Before this rider is relied upon in any customer-facing contract execution, the
following items shall be confirmed:

- [ ] Each Provision paragraph has been reviewed by counsel qualified in the jurisdiction of the counterparty's principal data-processing location.
- [ ] The statutory citations under each Right have been verified against the then-current consolidated text of the relevant instrument (GDPR EUR-Lex consolidated; BetrVG Bundesanzeiger; UK-GDPR legislation.gov.uk; CPRA Title 1.81.5 of the California Civil Code).
- [ ] The product-control references have been cross-checked against the current head of `CLAUDE.md`, `dev-docs/PRD.md`, and the referenced decision identifiers (D7, D8, D15, D20, D30) and found to be technically accurate as of the contract execution date.
- [ ] The `audit_events` schema referenced in Right 6 Product Control has been confirmed as landed in the authoritative Postgres migration history, not only proposed in the workstream PRD.
- [ ] The Ed25519 verification procedure referenced in Right 4 Verification has been exercised at least once against a real tenant policy file in the staging environment.
- [ ] The seven-day partition-drop erasure in Right 3 Product Control has been exercised end-to-end against a seeded test engineer in the staging environment, and the `INT12` test is green on the main branch.
- [ ] The cross-reference to `works-agreement-DE.md` has been confirmed consistent with the BetrVG §87(1) Nr. 6 Betriebsvereinbarung text published in the same sprint.
- [ ] For French customers, the rider has been read alongside `cse-consultation-FR.md` to confirm that the CSE consultation scheme anticipates the three exceptions enumerated in Right 2.
- [ ] For Italian customers, the rider has been read alongside `union-agreement-IT.md` to confirm that the union agreement under Statuto dei Lavoratori Art. 4 anticipates the exception scheme.
- [ ] The sub-processor list referenced in Right 1 Verification has been updated to reflect the then-current set of sub-processors for the managed-cloud deployment (where applicable).
- [ ] The Bill of Rights version string exported from `packages/config/src/bill-of-rights.ts` (`BILL_OF_RIGHTS_VERSION`) has been recorded on the signature page of the executed rider, so that any subsequent revision triggers re-review.

## Cross-references

- `legal/review/works-agreement-DE.md` — Betriebsvereinbarung per BetrVG §87(1) Nr. 6; anchors Right 2 and Right 6.
- `legal/review/cse-consultation-FR.md` — CSE consultation per Code du travail Art. L1222-4 and L2312-38; anchors Right 1 and Right 6.
- `legal/review/union-agreement-IT.md` — union agreement per Statuto dei Lavoratori Art. 4; anchors Right 2.
- `legal/review/DPIA.md` — GDPR Art. 35 DPIA outline for the customer's DPO; cross-references every Right.
- `legal/review/SCCs-module-2.md` — Commission SCCs 2021/914 Module 2 plus TIA plus DPF self-cert plan.
- `packages/config/src/bill-of-rights.ts` — canonical friendly PRD §6.5 text shared with the `/privacy` render.
- `dev-docs/PRD.md` §6.5 — friendly Bill of Rights; §8.7 — Clio-adapted on-device prompt pipeline enforcing Right 1.
- `dev-docs/workstreams/i-compliance-prd.md` — compliance-workstream PRD spanning this rider and related templates.

## Changelog

- 2026-04-16 — initial draft landed in Sprint 1 Week 1 per `dev-docs/workstreams/i-compliance-prd.md` §7 ship order. All six paragraphs first-drafted with Provision, Statutory basis, Product control, and Verification sub-sections. Absorption of PRD §6.5 wording risks W-1, W-2, W-3 documented. Queued for legal-review-pass in Sprint 2, finalization in Sprint 3.
