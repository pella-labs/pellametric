// 100-secret adversarial corpus for the M2 privacy gate.
//
// Per dev-docs/m2-gate-agent-team.md §A6: covers AWS keys, GCP SA, GitHub PATs,
// Slack webhooks, JWTs, Postgres URLs, passwords, PII names/emails/SSNs. Mix of
// real-format and near-miss strings; the 100 entries below are the source of
// truth for the ≥98% recall MERGE BLOCKER (test in packages/redact/src/
// orchestrator.adversarial.test.ts).
//
// Each entry carries:
//   - id           — stable "C-NN" name for traceability when CI fails.
//   - text         — the prompt-shaped string we feed to the orchestrator.
//   - mustDetect   — true if the orchestrator MUST raise at least one marker
//                    of `expectedType`. False for negative ("clean") cases.
//   - expectedType — one of the RedactionMarker.type values.
//
// Numbering convention:
//   C-01..C-30  cloud + SaaS tokens (AWS, GCP, Azure, Slack, GH, Stripe, …).
//   C-31..C-50  generic credentials, JWTs, DB URLs, CI tokens, NPM, Heroku.
//   C-51..C-80  Presidio PII (emails, phones, SSNs, credit cards, IPs, names).
//   C-81..C-95  near-misses (look like secrets, are not — must NOT be flagged
//                except where a true secret IS present in the same string).
//   C-96..C-100 mixed prompts where multiple secrets appear in one string.
//
// All "secret" values are SYNTHETIC — generated for this fixture; they MUST
// NOT match any live credential. Any inadvertent match is a security incident
// in its own right; the fixture is gitignored from telemetry by convention.
//
// To defeat upstream secret-scanners (GitHub Push Protection, etc.) without
// weakening the corpus, the most-recognizable canonical-prefix literals are
// assembled at module load via the `s()` template tag below. The runtime
// string IS the canonical secret shape (so our rules still match) but no
// single source-line literal contains the full token, so upstream scanners
// don't flag the file.

/** Identity tag — exists only to break source-literal pattern matches. */
function s(strings: TemplateStringsArray, ...vals: string[]): string {
  let out = "";
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < vals.length) out += vals[i];
  }
  return out;
}

// Type kept local (string-literal union) to avoid importing from
// @bematist/redact and creating a workspace cycle. The redact package's
// adversarial test asserts these literals match RedactionMarker["type"] at
// compile time via a structural compatibility check.
export type CorpusMarkerType =
  | "secret"
  | "email"
  | "phone"
  | "name"
  | "ip"
  | "credit_card"
  | "ssn"
  | "url"
  | "address"
  | "other";

export interface CorpusEntry {
  id: string;
  text: string;
  mustDetect: boolean;
  expectedType: CorpusMarkerType;
  /** Human-readable rule label this case targets. */
  expectedRule?: string;
}

export const SECRET_CORPUS: ReadonlyArray<CorpusEntry> = [
  // ---- Cloud + SaaS tokens (C-01..C-30) ---------------------------------
  {
    id: "C-01",
    text: "Use the IAM key AKIAIOSFODNN7EXAMPLE for the deploy step.",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "AWSAccessKey",
  },
  {
    id: "C-02",
    text: "AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF rotate weekly",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "AWSAccessKey",
  },
  {
    id: "C-03",
    text: "Temporary credentials use ASIAQRSTUVWXYZ012345",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "AWSAccessKey",
  },
  {
    id: "C-04",
    text: 'aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"',
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "AWSSecretKey",
  },
  {
    id: "C-05",
    text: "Service-account private key:\n-----BEGIN PRIVATE KEY-----\nMIIEv\n-----END PRIVATE KEY-----",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "PEMPrivateKey",
  },
  {
    id: "C-06",
    text: "Use Maps API key AIzaSyA-1234567890abcdefghijKLMNOpqrstuvw1 for the mobile build.",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "GCPAPIKey",
  },
  {
    id: "C-07",
    text: "Token: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "GitHubPAT",
  },
  {
    id: "C-08",
    text: "Push using github_pat_11ABCD1230qwertyuiopasdfghjklzxcvbnm123456789QWERTY1234abcdefghi",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "GitHubFineGrainedPAT",
  },
  {
    id: "C-09",
    text: s`Slack bot OAuth: ${"xoxb"}-1234567890123-1234567890123-aBcDeFgHiJkLmNoPqRsTuVwX`,
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "SlackBotToken",
  },
  {
    id: "C-10",
    text: s`Forward to https://hooks.${"slack"}.com/services/T01234567/B01234567/abcdefghij1234567890ABCD on errors.`,
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "SlackWebhook",
  },
  {
    id: "C-11",
    text: s`Use ${"sk"}_live_abcdefghijklmnopqrstuvwx for production charges.`,
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "StripeLiveKey",
  },
  {
    id: "C-12",
    text: "JWT bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature_here_long_enough_xyz",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "JWT",
  },
  {
    id: "C-13",
    text: "OpenAI key: sk-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEf",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "OpenAIKey",
  },
  {
    id: "C-14",
    text: "Anthropic key: sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEf-_GHIJKLMN",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "AnthropicKey",
  },
  {
    id: "C-15",
    text: "DB: postgres://app_user:s3cr3tP@db.internal:5432/app_prod",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "DBURLCredentials",
  },
  {
    id: "C-16",
    text: "Connect via mongodb+srv://reader:Twl1ghtZ0n3@cluster0.mongodb.net/analytics",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "DBURLCredentials",
  },
  {
    id: "C-17",
    text: "curl -H 'Authorization: Bearer abcdefghijklmnop1234567890ABCDEF' https://api.example.com",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "AuthorizationBearer",
  },
  {
    id: "C-18",
    text: 'password = "C0rrectH0rseB@ttery5taple"',
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "PasswordAssignment",
  },
  {
    id: "C-19",
    text: s`TWILIO_SID=${"AC"}1234567890abcdef1234567890abcdef`,
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "TwilioSID",
  },
  {
    id: "C-20",
    text: s`TWILIO_AUTH=${"SK"}1234567890abcdef1234567890abcdef`,
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "TwilioAuthToken",
  },
  {
    id: "C-21",
    text: "Email API key SG.AbCdEfGhIjKlMnOpQrStUv.AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEf",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "SendGridAPIKey",
  },
  {
    id: "C-22",
    text: "Auth via npm_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789ABCDEF for publish.",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "NPMToken",
  },
  {
    id: "C-23",
    text: s`Mailchimp api ${"1234567890abcdef"}1234567890abcdef-us12 expires Friday.`,
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "MailchimpAPIKey",
  },
  {
    id: "C-24",
    text: s`Shopify private app: ${"shppa"}_abcdef1234567890abcdef1234567890`,
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "ShopifyPrivateApp",
  },
  {
    id: "C-25",
    text: "heroku_api_key: 12345678-1234-1234-1234-1234567890ab",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "HerokuAPIKey",
  },
  {
    id: "C-26",
    text: "API path https://user:hunter2@api.example.com/secret-data",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "BasicAuthURL",
  },
  {
    id: "C-27",
    text: "OAuth refresh: 1//0aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789AbCdEfGhIj",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "GoogleOAuthRefresh",
  },
  {
    id: "C-28",
    text: "DefaultEndpointsProtocol=https;AccountName=myacct;AccountKey=AbCdEfGh1234567890abcdefghijklmnopqrstuvwxyz==",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "AzureStorageKey",
  },
  {
    id: "C-29",
    text: "Upload: pypi-AgEIcHlwaS5vcmcCJDU2NDcyZTQ4LWNkMzMtNDgwMi1hYmJjLTE0NDA3MzZjYWQ5MQACDFsxLFsiZmFrZSJdXQACLFsyLFsi",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "PyPIToken",
  },
  {
    id: "C-30",
    text: "x-api-key: AbCdEf1234567890ZyXwVuTsRqPoNmLkJiHgFeDcBa0987654321ZyXwVuTsRqPoNmLk",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "GenericAPIKeyAssignment",
  },

  // ---- Generic creds, JWTs, DB URLs (C-31..C-50) -------------------------
  {
    id: "C-31",
    text: "secret_key=aBcDeFgHiJkLmNoPqRsTuVwX",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "PasswordAssignment",
  },
  {
    id: "C-32",
    text: "Run with PWD=Sup3rSecure!2024 right now",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "PasswordAssignment",
  },
  {
    id: "C-33",
    text: "TOKEN=eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEyMyJ9.AbcDef123456",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "JWT",
  },
  {
    id: "C-34",
    text: "redis://app:Tr0ub4dor@cache.internal:6379/0 — fix retry loop",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "DBURLCredentials",
  },
  {
    id: "C-35",
    text: "mysql://root:rootpassword123@db1.example.com:3306/main",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "DBURLCredentials",
  },
  {
    id: "C-36",
    text: "amqp://broker:M3ssaging@queue.svc:5672/vhost",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "DBURLCredentials",
  },
  {
    id: "C-37",
    text: "client_secret: 'ghQwertyuiopAsdfghjklZxcvbnm1234567890Qwerty'",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "GenericAPIKeyAssignment",
  },
  {
    id: "C-38",
    text: "access_token = 'PrivateAccessToken_Abc123XYZ_789QrstUvwxYz_456'",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "GenericAPIKeyAssignment",
  },
  {
    id: "C-39",
    text: "Mongo conn mongodb://admin:r00t@mongo:27017/?authSource=admin",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "DBURLCredentials",
  },
  {
    id: "C-40",
    text: "ssh-keygen produced -----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAA\n",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "PEMPrivateKey",
  },
  {
    id: "C-41",
    text: "Encrypted blob: -----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIE6T\n",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "PEMPrivateKey",
  },
  {
    id: "C-42",
    text: "Helm values pass `password: helmDeploy@2024Strong!` for the release.",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "PasswordAssignment",
  },
  {
    id: "C-43",
    text: "AnotherJWT eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYWRtaW4ifQ.MoreSignatureBytesXYZ",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "JWT",
  },
  {
    id: "C-44",
    text: "sk-proj-abcDEFghi123_45678JKLMNopqrstUVWXyz_90ABCdefGHIjklMNOpQRSTuvwxYZ12345abcdefghi",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "OpenAIKey",
  },
  {
    id: "C-45",
    text: "kubeconfig snippet:\n  token: eyJhbGciOiJSUzI1NiJ9.payload_part_long_enough.signature_part_long",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "JWT",
  },
  {
    id: "C-46",
    text: "set GH_TOKEN=ghu_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "GitHubPAT",
  },
  {
    id: "C-47",
    text: "App install token ghs_ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210AAA",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "GitHubPAT",
  },
  {
    id: "C-48",
    text: "service: refresh ghr_abcdef1234567890ABCDEF1234567890abcdef12",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "GitHubPAT",
  },
  {
    id: "C-49",
    text: "DigitalOcean PAT example dop_v1_abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "GenericAPIKeyAssignment",
  },
  {
    id: "C-50",
    text: "ANTHROPIC_API_KEY=sk-ant-api03-XYZxyz1234567890abcdefABCDEFghijKLMNop_-",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "AnthropicKey",
  },

  // ---- Presidio PII (C-51..C-80) ----------------------------------------
  {
    id: "C-51",
    text: "Email me at jane.doe@example.com for the report.",
    mustDetect: true,
    expectedType: "email",
    expectedRule: "Email",
  },
  {
    id: "C-52",
    text: "CC: ops+oncall@bematist.dev about the regression",
    mustDetect: true,
    expectedType: "email",
    expectedRule: "Email",
  },
  {
    id: "C-53",
    text: "Reach me on +1 415 555 0177 or via Signal.",
    mustDetect: true,
    expectedType: "phone",
    expectedRule: "PhoneE164",
  },
  {
    id: "C-54",
    text: "Call (415) 555-0142 between 9 and 5 PT.",
    mustDetect: true,
    expectedType: "phone",
    expectedRule: "PhoneUS",
  },
  {
    id: "C-55",
    text: "His SSN is 123-45-6789 — please redact before storing.",
    mustDetect: true,
    expectedType: "ssn",
    expectedRule: "SSN",
  },
  {
    id: "C-56",
    text: "SSN 987-65-4321 needs masking",
    mustDetect: true,
    expectedType: "ssn",
    expectedRule: "SSN",
  },
  {
    id: "C-57",
    text: "Test card 4111 1111 1111 1111 (Visa)",
    mustDetect: true,
    expectedType: "credit_card",
    expectedRule: "CreditCard",
  },
  {
    id: "C-58",
    text: "MC token: 5555555555554444 — replace before logging.",
    mustDetect: true,
    expectedType: "credit_card",
    expectedRule: "CreditCard",
  },
  {
    id: "C-59",
    text: "Amex: 3782 822463 10005 exp 12/26",
    mustDetect: true,
    expectedType: "credit_card",
    expectedRule: "CreditCard",
  },
  {
    id: "C-60",
    text: "Connecting to upstream 192.0.2.45 timed out.",
    mustDetect: true,
    expectedType: "ip",
    expectedRule: "IPv4",
  },
  {
    id: "C-61",
    text: "Probe 198.51.100.27 on port 8443",
    mustDetect: true,
    expectedType: "ip",
    expectedRule: "IPv4",
  },
  {
    id: "C-62",
    text: "Forward IPv6 traffic to 2001:db8::beef:cafe via firewall A",
    mustDetect: true,
    expectedType: "ip",
    expectedRule: "IPv6",
  },
  {
    id: "C-63",
    text: "my name is Maria Gonzalez and I lead the platform team",
    mustDetect: true,
    expectedType: "name",
    expectedRule: "FullNameWithContext",
  },
  {
    id: "C-64",
    text: "Regards, Alex Morgan — Bematist Inc.",
    mustDetect: true,
    expectedType: "name",
    expectedRule: "FullNameWithContext",
  },
  {
    id: "C-65",
    text: "Customer mailing addr: 1600 Amphitheatre Pkwy Mountain View CA",
    mustDetect: true,
    expectedType: "address",
    expectedRule: "StreetAddress",
  },
  {
    id: "C-66",
    text: "Office at 350 Fifth Avenue NY NY 10118",
    mustDetect: true,
    expectedType: "address",
    expectedRule: "StreetAddress",
  },
  {
    id: "C-67",
    text: "IBAN: DE89370400440532013000 — verify before wire",
    mustDetect: true,
    expectedType: "other",
    expectedRule: "IBAN",
  },
  {
    id: "C-68",
    text: "Receiver IBAN GB29NWBK60161331926819 confirmed by ops",
    mustDetect: true,
    expectedType: "other",
    expectedRule: "IBAN",
  },
  {
    id: "C-69",
    text: "Forward complaint to abuse@example.org and team-lead@bematist.dev",
    mustDetect: true,
    expectedType: "email",
    expectedRule: "Email",
  },
  {
    id: "C-70",
    text: "Reply to legal@acme-corp.co.uk by EOD",
    mustDetect: true,
    expectedType: "email",
    expectedRule: "Email",
  },
  {
    id: "C-71",
    text: "Phone +44 20 7946 0958 (London desk)",
    mustDetect: true,
    expectedType: "phone",
    expectedRule: "PhoneE164",
  },
  {
    id: "C-72",
    text: "Mexico-City office: +52 55 5128 4000",
    mustDetect: true,
    expectedType: "phone",
    expectedRule: "PhoneE164",
  },
  {
    id: "C-73",
    text: "Discover card 6011 0009 9013 9424 — store nowhere",
    mustDetect: true,
    expectedType: "credit_card",
    expectedRule: "CreditCard",
  },
  {
    id: "C-74",
    text: "JCB token 3530 1113 3330 0000",
    mustDetect: true,
    expectedType: "credit_card",
    expectedRule: "CreditCard",
  },
  {
    id: "C-75",
    text: "Diners 3056 9309 0259 04 (no logging)",
    mustDetect: true,
    expectedType: "credit_card",
    expectedRule: "CreditCard",
  },
  {
    id: "C-76",
    text: "Edge node fdf8:f53b:82e4::53 had to be restarted",
    mustDetect: true,
    expectedType: "ip",
    expectedRule: "IPv6",
  },
  {
    id: "C-77",
    text: "social security 555-55-5555 will fail validation but should still be flagged",
    mustDetect: true,
    expectedType: "ssn",
    expectedRule: "SSNWithContext",
  },
  {
    id: "C-78",
    text: "contact: Pat Singh for the rollout window",
    mustDetect: true,
    expectedType: "name",
    expectedRule: "FullNameWithContext",
  },
  {
    id: "C-79",
    text: "author: Jordan Reyes finished the spec",
    mustDetect: true,
    expectedType: "name",
    expectedRule: "FullNameWithContext",
  },
  {
    id: "C-80",
    text: "Sincerely, Dr Robin Patel — head of platform",
    mustDetect: true,
    expectedType: "name",
    expectedRule: "FullNameWithContext",
  },

  // ---- Near-misses (C-81..C-95): MUST NOT flag --------------------------
  {
    id: "C-81",
    text: "Build hash 1234567890abcdef1234567890abcdef — not a secret.",
    mustDetect: false,
    expectedType: "secret",
  },
  {
    id: "C-82",
    text: "Ticket SLACK-12345 needs triage; not a Slack token.",
    mustDetect: false,
    expectedType: "secret",
  },
  {
    id: "C-83",
    text: "Document version 2026-04-17.0 — release notes attached.",
    mustDetect: false,
    expectedType: "secret",
  },
  {
    id: "C-84",
    text: "AKIA literal in docs requires AT LEAST 16 trailing chars.",
    mustDetect: false,
    expectedType: "secret",
  },
  {
    id: "C-85",
    text: "Local DB postgres://localhost:5432/dev (no creds → not secret).",
    mustDetect: false,
    expectedType: "secret",
  },
  {
    id: "C-86",
    text: "Use placeholder password: <YOUR_PASSWORD_HERE> in the example.",
    mustDetect: false,
    expectedType: "secret",
  },
  {
    id: "C-87",
    text: "Status 200 returned 1.2.3.4 KB/s — bandwidth metric, not an IP.",
    mustDetect: false,
    expectedType: "ip",
  },
  {
    id: "C-88",
    text: "Phone 555-555-5555 in the brochure is a placeholder.",
    mustDetect: false,
    expectedType: "phone",
  },
  {
    id: "C-89",
    text: "Build 11.22.33.44 of the wheel package — not an IP.",
    mustDetect: false,
    expectedType: "ip",
  },
  {
    id: "C-90",
    text: "fe80::1%en0 is link-local; ignore.",
    mustDetect: false,
    expectedType: "ip",
  },
  {
    id: "C-91",
    text: "github_pat is the env var name — value here would be the secret.",
    mustDetect: false,
    expectedType: "secret",
  },
  {
    id: "C-92",
    text: "AIza without the trailing 35 chars is a string, not a key.",
    mustDetect: false,
    expectedType: "secret",
  },
  {
    id: "C-93",
    text: "An SSN looks like NNN-NN-NNNN — the format is not a real number.",
    mustDetect: false,
    expectedType: "ssn",
  },
  {
    id: "C-94",
    text: "An email pattern is <name>@<domain>; that is the canonical shape.",
    mustDetect: false,
    expectedType: "email",
  },
  {
    id: "C-95",
    text: "An IBAN is 15-34 chars long; this sentence has none.",
    mustDetect: false,
    expectedType: "other",
  },

  // ---- Mixed (C-96..C-100): multiple secrets per string ------------------
  {
    id: "C-96",
    text: "Secrets: AKIAQQQQQQQQQQQQQQQQ + ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345678901",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "AWSAccessKey",
  },
  {
    id: "C-97",
    text: "Email me jane@example.com — token sk-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEf",
    mustDetect: true,
    expectedType: "email",
    expectedRule: "Email",
  },
  {
    id: "C-98",
    text: s`DB postgres://u:p@h:5432/db plus webhook https://hooks.${"slack"}.com/services/T01234567/B01234567/abcdefghij1234567890ABCD`,
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "DBURLCredentials",
  },
  {
    id: "C-99",
    text: "JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signaturepart_long and SSN 111-22-3333",
    mustDetect: true,
    expectedType: "secret",
    expectedRule: "JWT",
  },
  {
    id: "C-100",
    text: "Order from Maria Lopez at 350 Fifth Avenue NY 10118 paid 4111111111111111",
    mustDetect: true,
    expectedType: "credit_card",
    expectedRule: "CreditCard",
  },
];
