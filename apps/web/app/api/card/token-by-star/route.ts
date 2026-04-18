import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { db, firebaseConfigured } from "@/lib/firebase/admin";
import { hasStarred } from "@/lib/github-stars";

// Curated evocative wordlists — materials, textures, architecture, geology.
// 128 * 128 * 900 ≈ 14.7M combinations; single-use + 1h expiry + GitHub-rate-
// limited issuance makes this comfortable for a star-gated token.
const ADJECTIVES = [
  "obsidian",
  "velvet",
  "liminal",
  "gossamer",
  "cerulean",
  "tungsten",
  "feral",
  "luminous",
  "brackish",
  "vermilion",
  "halcyon",
  "ember",
  "tectonic",
  "ferrous",
  "mercurial",
  "spectral",
  "crystalline",
  "sable",
  "ardent",
  "sylvan",
  "abyssal",
  "gilded",
  "cobalt",
  "indigo",
  "glacial",
  "wrought",
  "tidal",
  "viridian",
  "russet",
  "ochre",
  "cinnabar",
  "auric",
  "pewter",
  "briny",
  "vesper",
  "saturnine",
  "opaline",
  "moonlit",
  "alloyed",
  "tempered",
  "nacreous",
  "argent",
  "pearlescent",
  "verdigris",
  "patinated",
  "charred",
  "ashen",
  "fathomless",
  "silken",
  "flaxen",
  "basalt",
  "granite",
  "slate",
  "marble",
  "onyx",
  "pumice",
  "flint",
  "beryl",
  "topaz",
  "agate",
  "peridot",
  "garnet",
  "malachite",
  "lapis",
  "celadon",
  "alabaster",
  "ebony",
  "mahogany",
  "cedarwood",
  "rowan",
  "thistle",
  "heather",
  "lichen",
  "rimelit",
  "smoldering",
  "flickering",
  "coiled",
  "braided",
  "knotted",
  "humming",
  "keening",
  "fluted",
  "striated",
  "beveled",
  "hexagonal",
  "hermetic",
  "runic",
  "cypherous",
  "sibylline",
  "oracular",
  "arcane",
  "esoteric",
  "lapidary",
  "hewn",
  "chiseled",
  "sea-worn",
  "sun-bleached",
  "moon-silvered",
  "storm-cut",
  "wind-carved",
  "archipelagic",
  "littoral",
  "pelagic",
  "benthic",
  "cryptic",
  "vestigial",
  "ancestral",
  "primordial",
  "antediluvian",
  "telluric",
  "plutonic",
  "chthonic",
  "vitreous",
  "adamantine",
  "chalcedonic",
  "seraphic",
  "empyrean",
  "cimmerian",
  "stygian",
  "umbral",
  "penumbral",
  "noctilucent",
  "iridescent",
  "limpid",
  "petrichor",
  "kintsugi",
  "gilt-edged",
  "ink-dark",
];

const NOUNS = [
  "monolith",
  "cirrus",
  "reliquary",
  "cypress",
  "halyard",
  "meridian",
  "solstice",
  "thorn",
  "reverie",
  "cinder",
  "fjord",
  "quasar",
  "nebula",
  "penumbra",
  "cipher",
  "tessera",
  "cromlech",
  "obelisk",
  "ostinato",
  "threnody",
  "menhir",
  "cairn",
  "dolmen",
  "belvedere",
  "rotunda",
  "apse",
  "pylon",
  "atrium",
  "peristyle",
  "cloister",
  "scriptorium",
  "apiary",
  "cenotaph",
  "stupa",
  "pagoda",
  "minaret",
  "ziggurat",
  "caravanserai",
  "hypocaust",
  "aqueduct",
  "cenote",
  "caldera",
  "fumarole",
  "geyser",
  "tarn",
  "moraine",
  "drumlin",
  "esker",
  "mesa",
  "butte",
  "arête",
  "couloir",
  "serac",
  "nunatak",
  "massif",
  "graben",
  "syncline",
  "schist",
  "gneiss",
  "gabbro",
  "rhyolite",
  "andesite",
  "ophiolite",
  "flysch",
  "molasse",
  "turbidite",
  "melange",
  "nappe",
  "klippe",
  "foreland",
  "hoarfrost",
  "antefix",
  "volute",
  "cartouche",
  "scarab",
  "kithara",
  "krater",
  "amphora",
  "lekythos",
  "kylix",
  "hydria",
  "pithos",
  "pelike",
  "kantharos",
  "phiale",
  "rhyton",
  "stamnos",
  "thurible",
  "ciborium",
  "monstrance",
  "crosier",
  "paten",
  "chalice",
  "myrrh",
  "frankincense",
  "copal",
  "benzoin",
  "labdanum",
  "galbanum",
  "spikenard",
  "ambergris",
  "horizon",
  "meadow",
  "tundra",
  "taiga",
  "savanna",
  "lagoon",
  "atoll",
  "archipelago",
  "estuary",
  "causeway",
  "gantry",
  "lantern",
  "sextant",
  "astrolabe",
  "armillary",
  "gnomon",
  "quipu",
  "codex",
  "palimpsest",
  "marginalia",
  "scriptura",
  "colophon",
  "paragon",
  "parallax",
  "aurora",
  "vesper",
];

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function mintToken(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 900) + 100;
  return `${adj}-${noun}-${num}`;
}

/**
 * Star-gated token issuance. Alternative to OAuth: if the supplied GitHub
 * username has publicly starred the repo, we mint a one-shot card token tied
 * to that login. No Firebase auth, no OAuth popup.
 *
 * Security note: this endpoint trusts the public star as a weak identity
 * signal. The token is single-use and short-lived; the CLI still has to be
 * run on the user's machine to submit stats.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { username?: string } | null;
  const username = body?.username?.trim();

  if (!username || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(username)) {
    return NextResponse.json({ error: "invalid username" }, { status: 400 });
  }

  const check = await hasStarred(username);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }
  if (!check.starred) {
    return NextResponse.json({ error: "not_starred" }, { status: 400 });
  }

  if (!firebaseConfigured) {
    return NextResponse.json({ error: "Firebase service account not configured" }, { status: 503 });
  }

  const token = mintToken();
  const tokenHash = hashToken(token);

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const uid = `gh_${username.toLowerCase()}`;
  await db.collection("api_tokens").doc(tokenHash).set({
    tokenHash,
    uid,
    githubLogin: username,
    authMethod: "star",
    expiresAt,
    used: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ token });
}
