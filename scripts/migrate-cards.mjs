#!/usr/bin/env node
// One-off: copy `cards` + `card_tokens` from Bematist DB (switchyard) to
// pella-metrics DB (shinkansen). Idempotent: uses ON CONFLICT DO UPDATE
// on card_id / token_hash.

import postgres from "/Users/san/Desktop/pella-metrics/apps/web/node_modules/postgres/src/index.js";

const SRC = "postgresql://postgres:ZOBUMKTMkoGaqPZwnbQwOkTSzBiKfwwi@switchyard.proxy.rlwy.net:40404/railway";
const DST = "postgresql://postgres:MJrrHlLnOZZWbchRcjYRSGNlhivknXdx@shinkansen.proxy.rlwy.net:41780/railway";

const src = postgres(SRC, { ssl: "require", max: 4 });
const dst = postgres(DST, { ssl: "require", max: 4 });

async function describe(sql, table) {
  return sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=${table}
    ORDER BY ordinal_position`;
}

async function tableExists(sql, table) {
  const r = await sql`SELECT to_regclass(${"public." + table}) AS t`;
  return r[0].t !== null;
}

async function main() {
  console.log("== inspecting source ==");
  const srcHasCards = await tableExists(src, "cards");
  const srcHasTokens = await tableExists(src, "card_tokens");
  console.log("cards table:", srcHasCards, "| card_tokens table:", srcHasTokens);
  if (!srcHasCards && !srcHasTokens) {
    console.log("nothing to migrate");
    return;
  }
  if (srcHasCards) console.log("cards columns:", await describe(src, "cards"));
  if (srcHasTokens) console.log("card_tokens columns:", await describe(src, "card_tokens"));

  const srcCardCount = srcHasCards ? (await src`SELECT count(*)::int AS c FROM cards`)[0].c : 0;
  const srcTokCount = srcHasTokens ? (await src`SELECT count(*)::int AS c FROM card_tokens`)[0].c : 0;
  console.log(`source rows: cards=${srcCardCount} card_tokens=${srcTokCount}`);

  console.log("== ensuring destination tables ==");
  await dst`
    CREATE TABLE IF NOT EXISTS cards (
      card_id         text PRIMARY KEY,
      owner_user_id   text,
      github_username text,
      display_name    text,
      avatar_url      text,
      stats           jsonb NOT NULL,
      created_at      timestamptz NOT NULL DEFAULT now()
    )`;
  await dst`
    CREATE TABLE IF NOT EXISTS card_tokens (
      token_hash      text PRIMARY KEY,
      subject_id      text NOT NULL,
      subject_kind    text NOT NULL,
      github_username text,
      created_at      timestamptz NOT NULL DEFAULT now(),
      expires_at      timestamptz NOT NULL,
      used_at         timestamptz
    )`;

  if (srcHasCards && srcCardCount > 0) {
    console.log("== copying cards ==");
    const rows = await src`SELECT card_id, owner_user_id, github_username, display_name, avatar_url, stats, created_at FROM cards`;
    let inserted = 0;
    for (const r of rows) {
      await dst`
        INSERT INTO cards (card_id, owner_user_id, github_username, display_name, avatar_url, stats, created_at)
        VALUES (${r.card_id}, ${r.owner_user_id}, ${r.github_username}, ${r.display_name}, ${r.avatar_url}, ${dst.json(r.stats)}, ${r.created_at})
        ON CONFLICT (card_id) DO UPDATE SET
          owner_user_id   = EXCLUDED.owner_user_id,
          github_username = EXCLUDED.github_username,
          display_name    = EXCLUDED.display_name,
          avatar_url      = EXCLUDED.avatar_url,
          stats           = EXCLUDED.stats,
          created_at      = EXCLUDED.created_at`;
      inserted++;
    }
    console.log(`cards inserted/updated: ${inserted}`);
  }

  if (srcHasTokens && srcTokCount > 0) {
    console.log("== copying card_tokens ==");
    const rows = await src`SELECT token_hash, subject_id, subject_kind, github_username, created_at, expires_at, used_at FROM card_tokens`;
    let inserted = 0;
    for (const r of rows) {
      await dst`
        INSERT INTO card_tokens (token_hash, subject_id, subject_kind, github_username, created_at, expires_at, used_at)
        VALUES (${r.token_hash}, ${r.subject_id}, ${r.subject_kind}, ${r.github_username}, ${r.created_at}, ${r.expires_at}, ${r.used_at})
        ON CONFLICT (token_hash) DO UPDATE SET
          subject_id      = EXCLUDED.subject_id,
          subject_kind    = EXCLUDED.subject_kind,
          github_username = EXCLUDED.github_username,
          created_at      = EXCLUDED.created_at,
          expires_at      = EXCLUDED.expires_at,
          used_at         = EXCLUDED.used_at`;
      inserted++;
    }
    console.log(`card_tokens inserted/updated: ${inserted}`);
  }

  const dstCardCount = (await dst`SELECT count(*)::int AS c FROM cards`)[0].c;
  const dstTokCount = (await dst`SELECT count(*)::int AS c FROM card_tokens`)[0].c;
  console.log(`\n== done == destination rows: cards=${dstCardCount} card_tokens=${dstTokCount}`);
}

main()
  .catch(e => { console.error("FAIL:", e); process.exitCode = 1; })
  .finally(async () => { await src.end(); await dst.end(); });
