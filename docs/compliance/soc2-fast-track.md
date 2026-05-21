# SOC 2 Fast-Track Plan and Missing Tickets

**Prepared:** 2026-05-15
**Status:** Draft for review. Nothing here is in Linear yet.
**Reference docs:** `docs/road-map.md` (full roadmap), Linear project "Pellametric Compliance" (PEL-12 and children).

---

## 0. TL;DR

- **Realistic fast-track timeline:** Type I report in ~120 days (≈Sep 12 2026), usable Type II report in ~210 days (≈Dec 11 2026).
- **Speed lever:** Buy Vanta (or Drata) in Week 1 and use their bundled auditor / pentest / training / background-check partners. This is the single biggest accelerant.
- **Hard floors that no platform can compress:**
  - Pentest scheduling: 4–8 weeks lead time.
  - Type II observation window: **3-month minimum**, period.
  - Privacy counsel onboarding: 2–4 weeks.
- **What this doc adds:** ~22 tickets the existing Linear backlog is missing — mostly people, legal, customer-facing, and audit-logistics work — plus a revised execution pipeline that puts speed first.
- **Inverted advice from the original roadmap:** the roadmap said "buy a compliance platform once Phase 1 foundations are underway." For speed, that's wrong — **the platform IS the speed**. Buy first, configure your controls to match it.

---

## 1. Why a Compliance Platform Is the Speed Play

Modern compliance platforms (Vanta, Drata, Secureframe) are not just evidence dashboards. They are **bundled service marketplaces** that collapse 5–6 independent procurement cycles into one purchase:

| Without platform | With Vanta/Drata |
|---|---|
| Draft 13 policies from scratch (~3 weeks) | Customize 13 templates (~3 days) |
| RFP 4–6 auditors, evaluate, contract (~4 weeks) | Pick from marketplace, intro call in 48h (~3 days) |
| Source pentest vendor, scope, contract (~4 weeks) | Pick partner from in-platform list (~3 days) |
| Source security-training vendor, contract (~2 weeks) | Enroll in built-in module (~1 day) |
| Build evidence-collection spreadsheets (~ongoing) | Auto-collected from GitHub/Railway/Postgres |
| Build employee acknowledgement workflow (~1 week) | Built into the platform |
| Background-check vendor selection (~2 weeks) | Checkr integration, 1-click enroll |

**Net compression: ~9-month roadmap → ~4-month Type I.**

---

## 2. Platform Comparison (speed-weighted)

|  | Vanta | Drata | Secureframe |
|---|---|---|---|
| Auditor marketplace size | ~80 firms | ~40 firms | ~30 firms |
| Pentest partner network | Cobalt, AssuredSec, NetSPI, others | Cobalt, NetSPI, others | Cobalt, others |
| Bundled security training | Yes (native module) | Yes (native module) | Yes (native) |
| Bundled background checks | Yes (Checkr) | Yes (Checkr) | Yes (Checkr) |
| First-year cost (startup pricing) | ~$15k–$30k | ~$12k–$25k | ~$10k–$20k |
| Typical Type-I time-to-report | 90–120 days | 90–120 days | 100–130 days |
| GitHub / Railway / Postgres integrations | Yes | Yes | Yes |
| AI/LLM control mappings (NIST AI RMF, ISO 42001) | Most mature | Some | Limited |
| Enterprise customer recognition | Highest | High | Medium |
| Vanta Help / fractional vCISO bundled | Yes on higher tiers | Add-on | Add-on |

### Recommendation: **Vanta**

1. **Largest auditor marketplace** — the single biggest factor in audit-cycle speed.
2. **Most pentest partners** — pentest booking is a calendar bottleneck and more partners = earlier slots.
3. **Strongest sales-side recognition** — "Are you on Vanta?" is asked by procurement teams verbatim.
4. **Best AI-platform mappings** if you want to extend to ISO 42001 later (likely, given the AI-telemetry product).
5. **Vanta Help** (bundled fractional vCISO) replaces hiring an external readiness consultant.

**Drata is a close second.** Pick Drata if budget is tighter, the team wants slightly better continuous-monitoring depth, and you don't mind a smaller auditor pool.

**Skip Secureframe** unless cost is a hard constraint — smaller marketplace = slower auditor selection.

---

## 3. Realistic Fast-Track Timeline

Assumes Vanta signed Week 1, engineering pipeline runs in parallel, no major remediation surprises.

| Week | Milestone | Owner |
|---|---|---|
| 1 | Sign Vanta contract; connect GitHub, Railway, Postgres, better-auth integrations | Eng + Ops |
| 1 | Engage privacy counsel (2–4 wk onboarding lead time) | Founder |
| 1 | Pick auditor from Vanta marketplace; intro call scheduled | Founder |
| 1 | Pick pentest vendor from Vanta marketplace; book for Week 8–10 | Eng lead |
| 1–3 | Execute Week-1 engineering wins (Dependabot, MFA on consoles, retention cron, branch protection) | Eng |
| 2–4 | Customize Vanta policy templates (13 docs) | Compliance owner |
| 4 | Background-check vendor enrolled; HR baseline policies acknowledged | Founder |
| 4 | Security awareness training launched (via Vanta module) | Compliance owner |
| 4–6 | Engineering pipeline Week 2–3 (system description, classification, tenant tests, audit events) | Eng |
| 6 | Counsel returns DPA, MSA, Privacy Policy drafts | Founder + counsel |
| 6 | Publish Trust Center + Subprocessor list | Eng + Marketing |
| 8 | Vanta readiness score ≥ 85%; engage auditor for readiness review | Compliance owner |
| 10–12 | **Penetration test executed**; remediation in flight | Eng + pentest vendor |
| 12 | Type I audit kickoff | Auditor |
| 16 | **Type I report issued** | Auditor |
| 16 | Type II observation window starts (3-month minimum) | All |
| 28 | Type II audit fieldwork | Auditor |
| 30 | **Type II report issued** (~Day 210 from today) | Auditor |

### What cannot be compressed

- **Pentest scheduling:** 4–8 weeks even with platform partners. Book in Week 1.
- **Type II observation:** 3 months is the floor. You cannot start it until Type I is signed.
- **Counsel turnaround:** 2–4 weeks for first-pass DPA/MSA/Privacy Policy review.
- **Auditor fieldwork:** typically 2–4 weeks of evidence requests + walkthroughs.

---

## 4. Week-1 Decisions Required From You

These have to be locked before Vanta onboarding starts.

| Decision | Recommended default | Rationale |
|---|---|---|
| Platform: Vanta / Drata / Secureframe / none | **Vanta** | Marketplace size + recognition |
| First audit scope | **Security + Confidentiality** | Prompts are encrypted; Confidentiality is cheap to add and tells the right customer story |
| Type I target date | **Week 14–16 (≈late Aug 2026)** | Aligns with realistic pentest + remediation timeline |
| Type II observation window | **3 months for first report** | Fastest enterprise unblock; move to 12-month annual after |
| Pentest scope | **Web app + APIs + tenant isolation + collector binary** | Customer-facing surface plus the binary they install |
| Auditor type | **SaaS-focused boutique (A-LIGN, Prescient, Insight, Sensiba)** | Big 4 is 2–3× slower and 2–4× more expensive |
| External vCISO or in-house | **In-house + Vanta Help** | Save the $30k+ vCISO retainer |
| Collector binary in scope | **Yes** | It ingests customer data; excluding it would weaken the customer story |
| Background-check vendor | **Checkr via Vanta** | Default integration; cheapest path |
| Cyber insurance | **Yes, $1M coverage minimum** | Standard enterprise contract requirement |

---

## 5. Missing Tickets — Draft for Linear

22 tickets organized into 5 categories. Each is ticket-ready — copy/paste into Linear under PEL-12 once you've reviewed.

Conventions:
- **Effort:** XS = ≤2h, S = ≤1 day, M = 2–5 days, L = 1–2 weeks, XL = 2+ weeks
- **Speed-track priority:** P0 (Week 1), P1 (Week 2–4), P2 (Week 4–8), P3 (Month 3+)
- **Owner type:** Founder, Eng, Compliance Owner (could be founder), Counsel, External

---

### Category A: Program governance & people (7 tickets)

#### A1. Designate SOC 2 program owner and management sponsor
- **Outcome:** A named owner accountable for the SOC 2 program; a named management sponsor who will sign the management assertion letter to the auditor.
- **Speed-track priority:** P0
- **Effort:** XS
- **Owner:** Founder
- **Why:** Auditor requires a named exec on the assertion letter. PEL-12 has Dave assigned but there's no formal RACI.
- **Done when:** Roles documented in `docs/compliance/program-ownership.md`; Vanta workspace owner set.

#### A2. Engage external readiness advisor or document decision to skip
- **Outcome:** Either an engaged vCISO/advisor, or a documented decision to rely on Vanta Help + internal team.
- **Speed-track priority:** P0
- **Effort:** S
- **Owner:** Founder
- **Why:** First-timers without guidance typically burn 2–3× more time. Vanta Help may be sufficient.
- **Recommended default:** Skip external advisor; use Vanta Help.

#### A3. Define employee onboarding & offboarding checklist with access provisioning
- **Outcome:** Documented checklist covering: account creation in each system, MFA enrollment, training, policy acknowledgements, equipment, and the mirror process for offboarding.
- **Speed-track priority:** P1
- **Effort:** S
- **Owner:** Founder / Compliance Owner
- **Why:** Auditor will request a sample termination; without this you fail on first request.
- **Dependency:** Builds on PEL-39's access inventory.

#### A4. Set up background check process for personnel with production access
- **Outcome:** Vendor selected (Checkr via Vanta), policy documented, all current personnel checked, process embedded in onboarding.
- **Speed-track priority:** P1
- **Effort:** S
- **Owner:** Founder
- **Why:** Standard SOC 2 control. Cheap to set up; expensive to retrofit.

#### A5. Stand up annual security awareness training program
- **Outcome:** Vanta's built-in training module assigned to all personnel; first round completed; tracking enabled for annual renewal.
- **Speed-track priority:** P1
- **Effort:** S
- **Owner:** Compliance Owner
- **Why:** Auditor will pull the completion roster. Use Vanta-native module to skip vendor procurement entirely.

#### A6. Roll out confidentiality, IP-assignment, and AUP acknowledgements
- **Outcome:** All employees and contractors have signed Confidentiality, IP Assignment, and Acceptable Use agreements; tracked in Vanta.
- **Speed-track priority:** P1
- **Effort:** S
- **Owner:** Counsel (drafts), Founder (executes)
- **Why:** Required at minimum for SOC 2; also necessary to enforce against insider misuse of customer telemetry.
- **Dependency:** Counsel engagement (B1).

#### A7. Conduct and document the annual risk assessment
- **Outcome:** A formal risk register and assessment document, distinct from PEL-47's *policy*. Real risks identified, scored, owned, with treatment plans.
- **Speed-track priority:** P2
- **Effort:** M
- **Owner:** Compliance Owner
- **Why:** Auditor requires the *output document*, not just the procedure. Vanta has a built-in template.

---

### Category B: Legal & contractual (5 tickets)

#### B1. Engage privacy/data counsel for DPA, MSA, ToS, Privacy Policy review
- **Outcome:** Counsel engaged, scope agreed, all four documents drafted/reviewed.
- **Speed-track priority:** P0 (start immediately — 2–4 wk lead time)
- **Effort:** L (calendar time) / S (your time)
- **Owner:** Founder
- **Why:** Counsel onboarding is the longest legal lead time. Start in Week 1 or it becomes the critical path.
- **Recommended firms:** Cooley, Goodwin, Fenwick (Tier 1); Outside Counsel models like Westaway, Cobalt (faster, cheaper).

#### B2. Publish customer-facing Privacy Policy aligned with telemetry classification
- **Outcome:** Public Privacy Policy that accurately describes what Pellametric collects, retention, subprocessors, and customer rights.
- **Speed-track priority:** P1
- **Effort:** S (after counsel returns)
- **Owner:** Counsel (draft), Eng (deploy to marketing site)
- **Dependency:** B1 (counsel), PEL-41 (classification).

#### B3. Draft and publish DPA template
- **Outcome:** A signable DPA template hosted on the trust center; can be executed on customer request.
- **Speed-track priority:** P1
- **Effort:** S
- **Owner:** Counsel
- **Why:** Required by every EU/UK customer and most US enterprises.
- **Dependency:** B1.

#### B4. Publish public Subprocessor list with change-notification process
- **Outcome:** Public page (e.g., `pellametric.com/subprocessors`) with vendor list, data processed, region; email subscription for change notices.
- **Speed-track priority:** P1
- **Effort:** S
- **Owner:** Compliance Owner + Eng
- **Why:** Customer-facing version of PEL-46's internal register. Many enterprise contracts mandate it.

#### B5. Establish responsible disclosure / `security.txt` and security@ inbox
- **Outcome:** `security.txt` published at `/.well-known/security.txt`; `security@pellametric.com` routed to incident commander; disclosure policy documented.
- **Speed-track priority:** P1
- **Effort:** XS
- **Owner:** Eng
- **Why:** Cheap, expected, and the only thing that lets outside researchers report bugs responsibly.

---

### Category C: Customer-facing security posture (4 tickets)

#### C1. Stand up a Trust Center page
- **Outcome:** Single URL (e.g., `trust.pellametric.com` or `pellametric.com/trust`) hosting: posture statement, subprocessor list, DPA template, security FAQ, SOC 2 status, security@ contact.
- **Speed-track priority:** P1
- **Effort:** M
- **Owner:** Eng + Marketing
- **Why:** This is the URL sales teams link in every enterprise deal. Vanta has a Trust Center add-on that auto-publishes.

#### C2. Build security questionnaire response library (SIG-Lite, CAIQ)
- **Outcome:** Pre-filled SIG-Lite and CAIQ workbooks reusable across customer questionnaires; stored in Vanta's questionnaire automation if available.
- **Speed-track priority:** P2
- **Effort:** M
- **Owner:** Compliance Owner
- **Why:** First questionnaire response takes 30+ hours from scratch; second takes 1 hour with a library. Pays for itself on deal #2.

#### C3. Update marketing site and sales collateral with compliant posture language
- **Outcome:** Site uses the exact language from roadmap §10 (no claims of "SOC 2 compliant" before report issuance); sales collateral matches.
- **Speed-track priority:** P1
- **Effort:** S
- **Owner:** Founder + Marketing
- **Why:** Auditor will flag mismatches between marketing claims and actual report scope. Saying "SOC 2 compliant" before issuance is a real liability.

#### C4. Define NDA + SOC 2 report distribution process
- **Outcome:** A documented workflow for sharing the SOC 2 report under NDA: who can request, how the NDA is executed, how the report is delivered, expiry/access tracking.
- **Speed-track priority:** P2
- **Effort:** S
- **Owner:** Counsel (template), Compliance Owner (workflow)
- **Why:** SOC 2 reports are confidential and must be NDA-gated. Vanta has a feature for this.

---

### Category D: External audit logistics (4 tickets)

#### D1. Procure and complete an independent penetration test
- **Outcome:** Pentest executed against web app + APIs + tenant isolation + collector binary; findings remediated or risk-accepted; final report stored as evidence.
- **Speed-track priority:** P0 (book immediately — 4–8 wk lead)
- **Effort:** L (calendar) / S (your time)
- **Owner:** Eng lead + pentest vendor
- **Why:** Required before Type II and expected before Type I for customer credibility. PEL-49 is *vuln scanning*, which is automated and continuous — pentest is human-led and point-in-time. Different control.
- **Budget:** $10k–$25k via Vanta marketplace.

#### D2. Procure cyber insurance ($1M minimum)
- **Outcome:** Active cyber liability policy with at least $1M coverage; certificate of insurance available on request.
- **Speed-track priority:** P1
- **Effort:** S
- **Owner:** Founder
- **Why:** Many enterprise contracts require it; some auditors want proof. Vouch, Embroker, Coalition are startup-friendly carriers.
- **Budget:** ~$3k–$10k/yr.

#### D3. Schedule auditor kickoff and walk through evidence-request portal
- **Outcome:** Auditor selected (via Vanta marketplace), engagement letter signed, kickoff meeting completed, evidence portal mapped.
- **Speed-track priority:** P0–P1
- **Effort:** S
- **Owner:** Founder + auditor
- **Why:** PEL-52 covers selection but not the kickoff. This is when the real timeline gets locked.

#### D4. Prepare management assertion letter and system-description sign-off
- **Outcome:** Signed management assertion letter and signed system description (PEL-42 output) delivered to auditor at audit kickoff.
- **Speed-track priority:** P2
- **Effort:** S
- **Owner:** Founder + Compliance Owner
- **Why:** This is the formal deliverable the auditor needs. Vanta provides a template.

---

### Category E: AI-specific items the roadmap names but didn't ticket (3 tickets)

#### E1. Conduct DPIA / AI risk assessment mapped to NIST AI RMF
- **Outcome:** A documented DPIA that walks through the NIST AI RMF Generative AI Profile against Pellametric's actual data flows.
- **Speed-track priority:** P2
- **Effort:** M
- **Owner:** Compliance Owner + Eng (input)
- **Why:** Enterprise AI buyers increasingly ask about NIST AI RMF alignment by name. Also useful as an ISO 42001 stepping-stone.

#### E2. EU AI Act applicability review
- **Outcome:** A short documented assessment concluding whether Pellametric is in scope (high-risk system, GPAI, etc.) — most likely "not high-risk," but the assessment itself is the artifact.
- **Speed-track priority:** P3
- **Effort:** S
- **Owner:** Counsel + Compliance Owner
- **Dependency:** B1.

#### E3. Publish responsible-disclosure / bug-bounty policy (decision: paid vs unpaid)
- **Outcome:** A documented disclosure program, even if unpaid. Lives at `pellametric.com/security` and `.well-known/security.txt`.
- **Speed-track priority:** P2
- **Effort:** S
- **Owner:** Eng + Compliance Owner
- **Why:** Increasingly an enterprise expectation. Start unpaid; convert to paid via Bugcrowd/HackerOne later if volume warrants.

---

## 6. Revised Pipeline (Speed-First)

Replaces my earlier 4-week pipeline with one optimized for the Vanta-bundled approach.

### Week 1 — "Buy the platform, start the long-lead-time items"

**Engineering (no blockers):**
1. Enable GitHub Dependabot, secret scanning, push protection, branch protection on `main`
2. Add `.github/CODEOWNERS` and PR template
3. Schedule `cleanup-retention.ts` as a GitHub Actions cron
4. Enable Railway PITR backups + one restore test
5. MFA on Railway, GitHub org, Linear, domain registrar (PEL-39 partial)

**Business (Week-1 long-lead bookings):**
6. **A1** Designate program owner + sponsor
7. **Sign Vanta contract** — kick off integrations
8. **B1** Engage privacy counsel (4-week lead)
9. **D1** Book pentest via Vanta marketplace (6-week lead)
10. **D3** Pick auditor via Vanta marketplace; intro call within 48h
11. **D2** Apply for cyber insurance (1-week turnaround)

### Week 2–3 — "Foundation work in parallel with platform onboarding"

**Engineering:**
12. **PEL-42** System description + Mermaid diagrams in `docs/compliance/`
13. **PEL-41** Telemetry classification (field-by-field from `schema.ts`)
14. **NEW:** Encrypt better-auth OAuth account tokens at rest
15. **NEW:** Add ingest rate limiting + body-size cap
16. **NEW:** Add `audit_event` table + emitters for token/export/role/credential events

**Vanta:**
17. Connect GitHub, Railway, Postgres, better-auth integrations
18. Customize 13 policy templates from Vanta library
19. **A4** Run Checkr background checks on all personnel
20. **A5** Launch security awareness training (Vanta module)
21. **A6** Distribute and collect confidentiality/IP/AUP acknowledgements

### Week 4–6 — "Code controls and customer-facing surface"

**Engineering:**
22. **PEL-40** Tenant-isolation test suite + extract `lib/authz.ts`
23. **PEL-44** Centralized logging (Axiom or Vanta-recommended provider)
24. **PEL-45** Finalize change-management evidence

**Customer-facing:**
25. **C1** Stand up Trust Center page
26. **C3** Update marketing site language to roadmap §10
27. **B5** Publish `security.txt` and security@ inbox
28. **B2, B3, B4** Receive counsel drafts; publish Privacy Policy, DPA template, Subprocessor list

### Week 6–8 — "Readiness sprint"

29. **PEL-47** Policy suite final review (already drafted via Vanta templates)
30. **PEL-48** Evidence repository structure (Vanta-native)
31. **PEL-46** Vendor inventory finalized
32. **A3** Onboarding/offboarding checklist documented
33. **A7** Annual risk assessment completed
34. **E1** DPIA / NIST AI RMF assessment completed
35. Auditor readiness review

### Week 8–12 — "Pentest, remediate, audit prep"

36. **D1** Pentest executed Week 8–10
37. Remediate findings Week 10–12
38. **C2** Build SIG-Lite + CAIQ response library
39. **D4** Sign management assertion + system description
40. **PEL-50** IR runbook + tabletop
41. **PEL-51** Readiness assessment final review

### Week 12–16 — "Type I audit"

42. Type I audit kickoff (Week 12)
43. Auditor fieldwork (Week 12–15)
44. **Type I report issued (~Week 16)**

### Week 16–28 — "Type II observation window (3-month minimum)"

45. Operate controls; collect evidence continuously via Vanta
46. Quarterly reviews per evidence cadence
47. **C4** NDA + report distribution workflow live
48. **E2** EU AI Act applicability review
49. **E3** Publish disclosure policy / bug bounty decision

### Week 28–30 — "Type II audit"

50. Type II fieldwork
51. **Type II report issued (~Week 30, ≈Day 210)**

---

## 7. Cost Summary (Fast-Track Path)

Order-of-magnitude, first year. Final numbers depend on platform tier, auditor, and pentest scope.

| Line item | Range | Notes |
|---|---|---|
| Vanta (annual, with Help) | $20k–$30k | Includes evidence collection, training module, policy templates, marketplace access |
| Auditor (Type I + Type II combined, SaaS-focused boutique) | $25k–$50k | Big 4 would be $80k–$150k+ |
| Pentest (one comprehensive) | $12k–$25k | Via Vanta marketplace |
| Privacy counsel (DPA + MSA + Privacy Policy + AUP + IP) | $8k–$25k | One-time burst; thereafter ~$2k/yr |
| Cyber insurance (annual) | $3k–$10k | $1M coverage, startup-friendly carrier |
| Background checks | $300–$1,000 | $30–$50/person via Checkr |
| Security awareness training | Included in Vanta | $0 incremental |
| Internal time (founder + 1 eng @ 0.3 FTE for 7 months) | — | The real hidden cost |
| **Total cash outlay** | **$68k–$141k** | For Type I + Type II in 7 months |

**Roadmap §6 estimated $45k–$125k for a slower 12-month path. Going fast costs ~10–15% more in cash but delivers the report 5 months sooner — which is usually worth one enterprise deal.**

---

## 8. Risks and Watch-Outs

1. **Pentest slot availability is the #1 schedule risk.** Book in Week 1 or the audit slips.
2. **Counsel can be slower than promised.** Have a second firm on standby; consider parallel engagement of an outside-counsel-style firm (Westaway, Cobalt) alongside a traditional firm.
3. **Vanta auto-evidence is not 100%** — expect ~20% of controls to need manual evidence. Don't assume "everything green in Vanta = audit passing."
4. **Auditor walk-throughs require human availability.** Block 5–10 hours of leadership calendar in Weeks 12–15.
5. **Customer questionnaires will arrive before the report.** Have the C2 library ready by Week 8 or sales will block on you.
6. **Marketing language drift.** Audit the marketing site for any "SOC 2 compliant" claims before Type I is signed — saying it pre-issuance is a real legal risk.
7. **The Type II observation window is a vibe-killer.** Once Type I is in hand, you cannot skip the 3-month wait. Plan for it.

---

## 9. Open Decisions for You Before We File Tickets

Please mark each:

- [ ] Approve Vanta as platform choice (vs Drata or hold)
- [ ] Approve first audit scope: Security + Confidentiality
- [ ] Approve target Type I date: ~Week 14–16 from kickoff
- [ ] Approve including the collector binary in scope
- [ ] Approve SaaS-focused auditor (vs Big 4)
- [ ] Approve in-house compliance ownership + Vanta Help (vs external vCISO)
- [ ] Approve cyber insurance procurement, $1M coverage
- [ ] Approve preferred privacy counsel (or request shortlist)
- [ ] Approve preferred pentest vendor (or accept Vanta default)
- [ ] Approve background checks for all current personnel
- [ ] Confirm program owner and management sponsor (name them)

Once you've reviewed and decided, I'll file all 22 tickets under PEL-12 with the revised dependency chains so PEL-42 isn't a fake bottleneck and the Week-1 long-lead items can start immediately.
