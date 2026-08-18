// Ländername -> ISO-3166-1 alpha-2.
// Die Basisliste wird zur Laufzeit aus Intl.DisplayNames erzeugt (kein Datenfile nötig),
// die Alias-Tabelle fängt die Schreibweisen ab, die GDELT abweichend verwendet.

const ALIASES: Record<string, string> = {
  "united states": "US",
  "united states of america": "US",
  "usa": "US",
  "us": "US",
  "united kingdom": "GB",
  "uk": "GB",
  "great britain": "GB",
  "england": "GB",
  "scotland": "GB",
  "wales": "GB",
  "northern ireland": "GB",
  "russia": "RU",
  "russian federation": "RU",
  "south korea": "KR",
  "korea": "KR",
  "republic of korea": "KR",
  "north korea": "KP",
  "vietnam": "VN",
  "viet nam": "VN",
  "laos": "LA",
  "syria": "SY",
  "iran": "IR",
  "ivory coast": "CI",
  "cote divoire": "CI",
  "côte d'ivoire": "CI",
  "congo": "CG",
  "republic of the congo": "CG",
  "congo brazzaville": "CG",
  "democratic republic of the congo": "CD",
  "congo kinshasa": "CD",
  "dr congo": "CD",
  "drc": "CD",
  "zaire": "CD",
  "tanzania": "TZ",
  "bolivia": "BO",
  "venezuela": "VE",
  "moldova": "MD",
  "macedonia": "MK",
  "north macedonia": "MK",
  "czech republic": "CZ",
  "czechia": "CZ",
  "burma": "MM",
  "myanmar": "MM",
  "cape verde": "CV",
  "east timor": "TL",
  "timor leste": "TL",
  "swaziland": "SZ",
  "eswatini": "SZ",
  "vatican": "VA",
  "vatican city": "VA",
  "holy see": "VA",
  "palestine": "PS",
  "palestinian territory": "PS",
  "west bank": "PS",
  "gaza": "PS",
  "gaza strip": "PS",
  "brunei": "BN",
  "micronesia": "FM",
  "hong kong": "HK",
  "macau": "MO",
  "macao": "MO",
  "taiwan": "TW",
  "bahamas": "BS",
  "gambia": "GM",
  "netherlands": "NL",
  "holland": "NL",
  "turkey": "TR",
  "turkiye": "TR",
  "türkiye": "TR",
  "cabo verde": "CV",
  "sao tome and principe": "ST",
  "st kitts and nevis": "KN",
  "st lucia": "LC",
  "st vincent and the grenadines": "VC",
  "saint kitts and nevis": "KN",
  "saint lucia": "LC",
  "saint vincent and the grenadines": "VC",
  "antigua and barbuda": "AG",
  "trinidad and tobago": "TT",
  "bosnia and herzegovina": "BA",
  "bosnia": "BA",
  "reunion": "RE",
  "curacao": "CW",
  "kosovo": "XK",
};

function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

let lookup: Map<string, string> | null = null;

function buildLookup(): Map<string, string> {
  const map = new Map<string, string>();
  const dn = new Intl.DisplayNames(["en"], { type: "region" });
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a) + String.fromCharCode(b);
      let name: string | undefined;
      try {
        name = dn.of(code);
      } catch {
        continue;
      }
      if (!name || name === code) continue;
      map.set(normalise(name), code);
      // "Congo - Kinshasa" -> auch "congo kinshasa"
      const plain = normalise(name.replace(/[-–]/g, " "));
      if (!map.has(plain)) map.set(plain, code);
    }
  }
  for (const [k, v] of Object.entries(ALIASES)) map.set(normalise(k), v);
  return map;
}

/** Gibt den ISO-2-Code zurück oder null, wenn der Name nicht auflösbar ist. */
export function toIso2(countryName: string | null | undefined): string | null {
  if (!countryName) return null;
  if (!lookup) lookup = buildLookup();
  const key = normalise(countryName);
  return lookup.get(key) ?? null;
}

/**
 * GDELT-Ortsnamen sehen aus wie "Nairobi, Nairobi Area, Kenya" oder "Kenya".
 * Zerlegt in Ortsname, ADM1 und Land.
 */
export function splitPlaceName(raw: string): {
  name: string;
  admin1: string | null;
  country: string | null;
} {
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { name: raw, admin1: null, country: null };
  if (parts.length === 1) return { name: parts[0], admin1: null, country: parts[0] };
  return {
    name: parts[0],
    admin1: parts.length >= 3 ? parts[1] : null,
    country: parts[parts.length - 1],
  };
}
