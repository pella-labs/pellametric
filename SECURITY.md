# Bematist Security Policy

Thanks for helping keep Bematist and its users safe.

## Scope

In scope for coordinated disclosure:

- The collector binary (`apps/collector`) — installation, egress, signature verification, on-device redaction, Clio prompt pipeline.
- The server applications (`apps/web`, `apps/ingest`, `apps/worker`) and the packages they consume (`packages/api`, `packages/schema`, `packages/redact`, `packages/embed`, `packages/scoring`, `packages/clio`).
- Storage schemas (ClickHouse DDL, Postgres migrations, RLS policies) and the tenancy / privacy-tier enforcement they encode.
- CI/CD and publish workflows in `.github/workflows/` (build, release, SBOM, signing, SLSA provenance) and the distribution artifacts they produce (distro packages, GitHub Release binaries, container images).
- The GitHub App (`bematist-github`) webhook surface.

Out of scope (please do not test against these without written permission):

- Customer-hosted data in self-host or managed-cloud deployments. Bematist is tenant-owned by design — vulnerabilities in a specific customer's configuration belong to that customer.
- Social-engineering, physical attacks, or denial-of-service against shared infrastructure.
- Third-party dependencies that have their own disclosure channels (please report upstream and let us know so we can track patches).

## Reporting a vulnerability

Preferred: **GitHub Security Advisories** — open a private advisory at `https://github.com/<org>/bematist/security/advisories/new`. This creates a private thread with the maintainers, a CVE reservation path, and a draft disclosure timeline.

Fallback: email `security@bematist.dev` *(placeholder — a real inbox and a published PGP key will be announced when the domain is registered; fingerprint `TBD-FINGERPRINT-PLACEHOLDER-UPDATE-ON-DOMAIN-REGISTRATION`)*.

Please include, where possible:

- A description of the issue and its impact.
- Steps to reproduce, proof-of-concept code, or a minimal repro repo.
- Affected versions and commit SHAs.
- Your preferred credit line (name / handle / "anonymous").

Please do **not** file a public GitHub issue, pull request, discussion, or social-media post before a coordinated disclosure date.

## Our response commitments (SLA)

- **Acknowledgement:** within 48 hours of receipt.
- **Triage and severity assignment:** within 5 business days, using CVSS 4.0 and the guidance in §6 of this policy as a tie-breaker for privacy impact.
- **Fix or mitigation plan:** within 30 days for Critical and High severity; within 90 days for Medium and Low.
- **Coordinated disclosure window:** 90 days from the first acknowledgement by default. We will ask for an extension (with reasoning) if an incomplete fix would create a larger exposure than the original issue.

We will work with you on the disclosure timeline and credit. Security advisories are published as **GitHub Security Advisories (GHSA)** with a reserved CVE; fixes are shipped with cosign-signed release artifacts and SLSA Level 3 provenance.

## Safe harbor

Bematist considers good-faith security research an essential part of keeping our users safe. If you make a good-faith effort to comply with this policy during your security research, we will consider your research to be authorized, will work with you to understand and resolve the issue quickly, and Bematist will not pursue or support any legal action related to your research. You are expected to comply with all applicable laws, to avoid privacy violations and degradation of user experience, and to give us a reasonable time to respond before making any information public. If legal action is initiated by a third party against you for activities that were conducted in accordance with this policy, we will make this authorization known.

## Credits

A thanks file will be maintained with the names (or handles) of researchers who have reported valid vulnerabilities and consented to be listed.
