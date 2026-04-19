// Peer engineer configuration + remote-snapshot loader.
//
// Config via `BEMATIST_PEERS` env (JSON array of {id, name, url, secret}).
// Each entry points at a teammate's dashboard /api/peer/snapshot endpoint.
// Meant for a tailnet or VPN — not the public internet — so bearer auth
// over HTTP is acceptable for the demo.

import "server-only";

import { getLocalData, type LocalData } from "./local-sources";

export interface PeerConfig {
  id: string;
  name: string;
  url: string;
  secret: string;
}

export interface Engineer {
  id: string;
  name: string;
  /** "me" = local machine; otherwise a peer id. */
  kind: "me" | "peer";
  url?: string;
  online?: boolean;
}

function parsePeers(): PeerConfig[] {
  const raw = process.env.BEMATIST_PEERS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PeerConfig[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is PeerConfig =>
        typeof p.id === "string" &&
        typeof p.name === "string" &&
        typeof p.url === "string" &&
        typeof p.secret === "string",
    );
  } catch {
    return [];
  }
}

function localEngineer(): Engineer {
  const name = process.env.BEMATIST_LOCAL_ENGINEER_NAME ?? "You (local)";
  return { id: "me", name, kind: "me", online: true };
}

/** Return every engineer configured for this dashboard — always includes the
 *  local machine plus any BEMATIST_PEERS entries. */
export function listEngineers(): Engineer[] {
  const peers = parsePeers().map((p) => ({
    id: p.id,
    name: p.name,
    kind: "peer" as const,
    url: p.url,
  }));
  return [localEngineer(), ...peers];
}

// ── Peer snapshot cache ─────────────────────────────────────────

interface PeerCacheEntry {
  at: number;
  data: LocalData;
  online: boolean;
}

const peerCache = new Map<string, PeerCacheEntry>();
const PEER_TTL_MS = 5 * 60_000; // 5 min — teammate dashboards recompute every ~60s,
// pulling more often adds noise without adding signal.

async function fetchPeer(peer: PeerConfig): Promise<LocalData | null> {
  try {
    const r = await fetch(`${peer.url.replace(/\/$/, "")}/api/peer/snapshot`, {
      method: "GET",
      headers: { authorization: `Bearer ${peer.secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return null;
    return (await r.json()) as LocalData;
  } catch {
    return null;
  }
}

export async function getEngineerData(engineerId: string): Promise<{
  data: LocalData | null;
  online: boolean;
  engineer: Engineer;
}> {
  if (engineerId === "me") {
    return { data: await getLocalData(), online: true, engineer: localEngineer() };
  }
  const peers = parsePeers();
  const peer = peers.find((p) => p.id === engineerId);
  if (!peer) {
    return {
      data: null,
      online: false,
      engineer: { id: engineerId, name: engineerId, kind: "peer", online: false },
    };
  }
  const engineer: Engineer = {
    id: peer.id,
    name: peer.name,
    kind: "peer",
    url: peer.url,
  };
  const now = Date.now();
  const cached = peerCache.get(peer.id);
  if (cached && now - cached.at < PEER_TTL_MS) {
    return { data: cached.data, online: cached.online, engineer };
  }
  const data = await fetchPeer(peer);
  const online = data !== null;
  if (data) peerCache.set(peer.id, { at: now, data, online });
  else if (cached) {
    // Serve stale on offline — better than nothing, flag as offline.
    return { data: cached.data, online: false, engineer };
  }
  return { data, online, engineer };
}

/** Pull every engineer's data in parallel. Offline peers return null but the
 *  engineer still appears in the list with `online: false`. */
export async function getAllEngineerData(): Promise<
  Array<{ engineer: Engineer; data: LocalData | null; online: boolean }>
> {
  const list = listEngineers();
  return Promise.all(list.map((e) => getEngineerData(e.id)));
}
