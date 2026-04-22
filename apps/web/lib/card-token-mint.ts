// Shared card-token minter. Format: `bm_<adj>-<noun>-<num>`.
// 128 × 128 × 900 ≈ 14.7M combinations. Single-use + 1h TTL keeps that
// comfortable for an online-guessing threat model.

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
  "limpid", "ink-dark", "swift", "cosmic", "neon", "lunar", "pixel", "turbo",
  "hyper", "cyber", "nova", "quantum", "stellar", "blazing", "shadow", "golden",
  "iron", "chrome", "electric", "frozen", "silent", "crimson", "azure", "verdant",
  "amber", "jade", "onyx-dark", "pearl", "ruby",
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
  "parallax", "aurora", "vesper", "falcon", "phoenix", "coder", "spark", "orbit",
  "pulse", "forge", "nexus", "vortex", "prism", "atlas", "titan", "raven", "storm",
  "byte", "flux", "drift", "echo", "blade", "comet", "ember-peak", "beacon",
  "anvil", "canyon", "cascade", "conduit", "embassy", "foundry", "gallery",
  "harbor", "lighthouse", "outpost", "quarry", "refuge", "vantage",
];

/** `bm_<adj>-<noun>-<num>` — short shareable token. */
export function mintCardToken(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 900) + 100;
  return `bm_${adj}-${noun}-${num}`;
}
