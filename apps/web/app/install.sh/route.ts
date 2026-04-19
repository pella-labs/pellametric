// GET /install.sh → 302 to the latest signed install.sh published to the
// GH release. Point of this route: so users can keep muscle-memory'ing
// `curl -fsSL https://bematist.dev/install.sh | sh` without hitting the
// proxy's auth-redirect (which would return the sign-in HTML and blow up
// `sh` as it tried to parse `<`).
//
// The GH release install.sh is cosign-signed + manifest-checksummed
// upstream; this route is a dumb redirect so we inherit all of that for
// free instead of mirroring bytes. `permanent: false` lets us re-point
// later (e.g. to a self-hosted mirror) without busting CDN caches.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GH_LATEST_INSTALL_SH =
  "https://github.com/pella-labs/bematist/releases/latest/download/install.sh";

export function GET(): Response {
  return NextResponse.redirect(GH_LATEST_INSTALL_SH, {
    status: 302,
    headers: {
      // `curl -fsSL` follows redirects; `| sh` then consumes the script.
      // Cache-Control must NOT be too aggressive — if we ever pin to a
      // specific release tag, we want that change to propagate within
      // the hour. 5m is a reasonable default.
      "Cache-Control": "public, max-age=300",
    },
  });
}
