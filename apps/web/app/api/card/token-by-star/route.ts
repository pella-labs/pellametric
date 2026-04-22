import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { hashCardToken, isReservedCardSlug, toCardSlug } from "@/lib/card-backend";
import { hasStarred } from "@/lib/github-stars";

export const dynamic = "force-dynamic";

const ADJECTIVES = [
  "obsidian", "velvet", "liminal", "gossamer", "cerulean", "tungsten", "feral",
  "luminous", "brackish", "vermilion", "halcyon", "ember", "tectonic", "ferrous",
  "mercurial", "spectral", "crystalline", "sable", "ardent", "sylvan", "abyssal",
  "gilded", "cobalt", "indigo", "glacial", "wrought", "tidal", "viridian", "russet",
  "ochre", "cinnabar", "auric", "pewter", "briny", "vesper", "saturnine", "opaline",
  "moonlit", "alloyed", "tempered", "nacreous", "argent", "pearlescent", "verdigris",
  "patinated", "charred", "ashen", "silken", "flaxen", "basalt", "granite", "slate",
  "marble", "onyx", "flint", "beryl", "topaz", "agate", "garnet", "lapis", "celadon",
  "alabaster", "ebony", "mahogany", "heather", "smoldering", "flickering", "coiled",
  "braided", "knotted", "humming", "fluted", "striated", "beveled", "hexagonal",
  "hermetic", "runic", "arcane", "hewn", "chiseled", "sea-worn", "sun-bleached",
  "storm-cut", "wind-carved", "littoral", "pelagic", "cryptic", "vestigial",
  "ancestral", "primordial", "telluric", "plutonic", "chthonic", "vitreous",
  "adamantine", "seraphic", "empyrean", "umbral", "penumbral", "iridescent",
  "limpid", "ink-dark",
];

const NOUNS = [
  "monolith", "cirrus", "reliquary", "cypress", "halyard", "meridian", "solstice",
  "thorn", "reverie", "cinder", "fjord", "quasar", "nebula", "penumbra", "cipher",
  "tessera", "obelisk", "cairn", "dolmen", "belvedere", "rotunda", "apse", "pylon",
  "atrium", "cloister", "scriptorium", "cenotaph", "stupa", "pagoda", "minaret",
  "ziggurat", "aqueduct", "cenote", "caldera", "fumarole", "geyser", "tarn",
  "moraine", "mesa", "butte", "serac", "massif", "schist", "gneiss", "gabbro",
  "rhyolite", "melange", "foreland", "antefix", "volute", "cartouche", "scarab",
  "kithara", "krater", "amphora", "kylix", "hydria", "kantharos", "phiale", "rhyton",
  "thurible", "ciborium", "crosier", "chalice", "myrrh", "frankincense", "copal",
  "spikenard", "ambergris", "horizon", "meadow", "tundra", "taiga", "savanna",
  "lagoon", "atoll", "estuary", "causeway", "gantry", "lantern", "sextant",
  "astrolabe", "armillary", "gnomon", "codex", "palimpsest", "colophon", "paragon",
  "parallax", "aurora", "vesper",
];

function mintStarToken(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 900) + 100;
  // `bm_` prefix required by the collector's token guard — do not change.
  return `bm_${adj}-${noun}-${num}`;
}

/**
 * POST /api/card/token-by-star — star-gated token issuance. If the supplied
 * GitHub username has publicly starred pella-labs/pellametric, mint a
 * one-shot card token tied to that login. No sign-in required.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { username?: string } | null;
    const username = body?.username?.trim();

    if (!username || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(username)) {
      return NextResponse.json({ error: "invalid username" }, { status: 400 });
    }

    const check = await hasStarred(username);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    if (!check.starred) return NextResponse.json({ error: "not_starred" }, { status: 400 });

    const slug = toCardSlug(username);
    if (isReservedCardSlug(slug)) {
      return NextResponse.json(
        { error: `GitHub username '${username}' collides with a reserved path.` },
        { status: 400 },
      );
    }

    const token = mintStarToken();
    const tokenHash = hashCardToken(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await sql`
      INSERT INTO card_tokens (token_hash, subject_kind, subject_id, github_username, expires_at)
      VALUES (${tokenHash}, 'github_star', ${slug}, ${username}, ${expiresAt}::timestamptz)`;
    return NextResponse.json({ token });
  } catch (e) {
    console.error("[/api/card/token-by-star] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
