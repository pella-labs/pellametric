import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, desc, eq, gte, lte, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { PDFArray, PDFDocument, PDFName, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

type ExportRow = {
  userId: string;
  userName: string;
  source: string;
  repo: string;
  model: string | null;
  startedAt: Date;
  endedAt: Date;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  messages: number;
  userTurns: number;
  errors: number;
};

function esc(v: unknown): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes("\n") || s.includes('"')) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function totals(rows: ExportRow[]) {
  return rows.reduce((a, r) => ({
    sessions: a.sessions + 1,
    tokensIn: a.tokensIn + r.tokensIn,
    tokensOut: a.tokensOut + r.tokensOut,
    messages: a.messages + r.messages,
    userTurns: a.userTurns + r.userTurns,
    errors: a.errors + r.errors,
  }), { sessions: 0, tokensIn: 0, tokensOut: 0, messages: 0, userTurns: 0, errors: 0 });
}

async function makeStyledPdf(args: {
  orgName: string;
  provider: string;
  slug: string;
  mode: "team" | "member";
  from: Date;
  to: Date;
  rows: ExportRow[];
}): Promise<Uint8Array> {
  const { orgName, provider, slug, mode, from, to, rows } = args;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [842, 595]; // A4 landscape
  let page = pdf.addPage(pageSize);
  const tocPage = page;
  let y = 560;
  const left = 26;
  const headerY = 516;
  const headerH = 79;
  const contentTop = headerY - 20;
  const iconPath = path.join(process.cwd(), "app", "icon.png");
  let brandIcon: any = null;
  try {
    const bytes = await readFile(iconPath);
    brandIcon = await pdf.embedPng(bytes);
  } catch {}

  const drawHeader = () => {
    page.drawRectangle({ x: 0, y: headerY, width: 842, height: headerH, color: rgb(0.07, 0.09, 0.14) });

    const leftTextX = left + 38;
    const leftTitleSize = 15;
    const leftSubSize = 9;
    const leftGap = 4;
    const leftBlockH = leftTitleSize + leftGap + leftSubSize;
    const leftTitleY = headerY + (headerH - leftBlockH) / 2 + leftSubSize + leftGap - 1;
    const leftSubY = leftTitleY - leftSubSize - leftGap + 1;
    const leftIconSize = 26;
    const leftIconY = headerY + (headerH - leftIconSize) / 2;
    if (brandIcon) page.drawImage(brandIcon, { x: left, y: leftIconY, width: leftIconSize, height: leftIconSize });
    page.drawText("Telemetryc", { x: leftTextX, y: leftTitleY, size: leftTitleSize, font: fontBold, color: rgb(0.95, 0.96, 0.98) });
    page.drawText("Team Report", { x: leftTextX, y: leftSubY, size: leftSubSize, font, color: rgb(0.75, 0.79, 0.86) });

    const rightTitleSize = 20;
    const rightSubSize = 9;
    const rightGap = 4;
    const rightBlockH = rightTitleSize + rightGap + rightSubSize;
    const rightTitleY = headerY + (headerH - rightBlockH) / 2 + rightSubSize + rightGap - 1;
    const rightSubY = rightTitleY - rightSubSize - rightGap + 1;
    const rightMargin = 26;
    const providerText = `${provider}/${slug}`;
    const orgTextW = fontBold.widthOfTextAtSize(orgName, rightTitleSize);
    const providerTextW = font.widthOfTextAtSize(providerText, rightSubSize);
    const textBlockW = Math.max(orgTextW, providerTextW);
    const textX = 842 - rightMargin - textBlockW;
    page.drawText(orgName, { x: textX, y: rightTitleY, size: rightTitleSize, font: fontBold, color: rgb(0.97, 0.98, 1) });
    page.drawText(providerText, { x: textX, y: rightSubY, size: rightSubSize, font, color: rgb(0.8, 0.84, 0.9) });
  };

  const addInternalLink = (srcPage: any, x: number, y: number, w: number, h: number, targetPage: any) => {
    const link = pdf.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [x, y, x + w, y + h],
      Border: [0, 0, 0],
      Dest: [targetPage.ref, "Fit"],
    });
    const linkRef = pdf.context.register(link);
    const annotsKey = PDFName.of("Annots");
    const existing = srcPage.node.lookup(annotsKey);
    if (existing instanceof PDFArray) {
      existing.push(linkRef);
    } else {
      const arr = pdf.context.obj([linkRef]);
      srcPage.node.set(annotsKey, arr);
    }
  };

  const newPage = () => {
    page = pdf.addPage(pageSize);
    drawHeader();
    y = contentTop;
  };

  drawHeader();
  y = contentTop;

  const t = totals(rows);
  const cards = [
    { k: "Sessions", v: String(t.sessions) },
    { k: "Tokens In", v: t.tokensIn.toLocaleString() },
    { k: "Tokens Out", v: t.tokensOut.toLocaleString() },
    { k: "Messages", v: t.messages.toLocaleString() },
    { k: "Errors", v: t.errors.toLocaleString() },
  ];

  page.drawText(`Org: ${orgName}`, { x: left, y, size: 11, font: fontBold, color: rgb(0.12, 0.14, 0.18) });
  page.drawText(`Range: ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}  |  Mode: ${mode}`, {
    x: left, y: y - 14, size: 9, font, color: rgb(0.34, 0.37, 0.43),
  });
  y -= 44;

  const cardW = 154;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const x = left + i * (cardW + 8);
    page.drawRectangle({ x, y: y - 40, width: cardW, height: 36, color: rgb(0.95, 0.96, 0.98) });
    page.drawText(c.k, { x: x + 8, y: y - 16, size: 8, font, color: rgb(0.39, 0.43, 0.5) });
    page.drawText(c.v, { x: x + 8, y: y - 32, size: 12, font: fontBold, color: rgb(0.12, 0.14, 0.18) });
  }
  y -= 58;

  const byMember = new Map<string, ExportRow[]>();
  for (const r of rows) byMember.set(r.userName, [...(byMember.get(r.userName) ?? []), r]);
  const members = [...byMember.entries()]
    .map(([name, rs]) => ({ name, rows: rs, total: totals(rs) }))
    .sort((a, b) => b.total.tokensOut - a.total.tokensOut);

  page.drawText(mode === "team" ? "Team Table of Contents" : "Member Summary", {
    x: left, y, size: 11, font: fontBold, color: rgb(0.12, 0.14, 0.18),
  });
  y -= 16;
  const tocEntries: Array<{ name: string; x: number; y: number; w: number; h: number }> = [];
  for (const m of members) {
    if (y < 48) newPage();
    if (mode === "team") {
      page.drawRectangle({ x: left, y: y - 20, width: 790, height: 24, color: rgb(0.96, 0.97, 0.99) });
      const nameX = left + 8;
      const nameY = y - 12;
      const nameSize = 14;
      page.drawText(m.name, { x: nameX, y: nameY, size: nameSize, font: fontBold, color: rgb(0.08, 0.33, 0.82) });
      const nameW = fontBold.widthOfTextAtSize(m.name, nameSize);
      page.drawLine({
        start: { x: nameX, y: nameY - 1.5 },
        end: { x: nameX + nameW, y: nameY - 1.5 },
        thickness: 0.8,
        color: rgb(0.08, 0.33, 0.82),
      });
      page.drawText(`sessions ${m.total.sessions} · out ${m.total.tokensOut.toLocaleString()} · msgs ${m.total.messages.toLocaleString()} · errors ${m.total.errors}`, {
        x: left + 230, y: y - 11, size: 9, font, color: rgb(0.26, 0.3, 0.37),
      });
      tocEntries.push({ name: m.name, x: left, y: y - 20, w: 790, h: 24 });
      y -= 28;
    } else {
      const text = `${m.name}: sessions ${m.total.sessions}, out ${m.total.tokensOut.toLocaleString()}, msgs ${m.total.messages.toLocaleString()}, errors ${m.total.errors}`;
      page.drawText(text, { x: left, y, size: 9, font, color: rgb(0.18, 0.2, 0.24) });
      y -= 12;
    }
  }
  y -= 8;

  page.drawText(mode === "team" ? "Sessions by member" : "Sessions", { x: left, y, size: 11, font: fontBold, color: rgb(0.12, 0.14, 0.18) });
  y -= 14;
  const cols = [
    { label: "Date", x: left, w: 96 },
    { label: "Member", x: left + 100, w: 150 },
    { label: "Repo", x: left + 254, w: 230 },
    { label: "Model", x: left + 488, w: 95 },
    { label: "Out", x: left + 587, w: 70 },
    { label: "Msgs", x: left + 661, w: 48 },
    { label: "Err", x: left + 713, w: 36 },
  ];
  const drawTableHeader = () => {
    page.drawRectangle({ x: left, y: y - 14, width: 790, height: 16, color: rgb(0.91, 0.93, 0.96) });
    for (const c of cols) {
      page.drawText(c.label, { x: c.x + 3, y: y - 10, size: 8, font: fontBold, color: rgb(0.19, 0.22, 0.28) });
    }
    y -= 18;
  };
  const drawRow = (r: ExportRow, i: number) => {
    if (y < 36) {
      newPage();
      drawTableHeader();
    }
    if (i % 2 === 0) page.drawRectangle({ x: left, y: y - 12, width: 790, height: 14, color: rgb(0.98, 0.985, 0.992) });
    const vals = [
      r.startedAt.toISOString().slice(0, 10),
      r.userName.slice(0, 26),
      r.repo.slice(0, 44),
      (r.model ?? "").slice(0, 16),
      r.tokensOut.toLocaleString(),
      String(r.messages),
      String(r.errors),
    ];
    vals.forEach((v, idx) => page.drawText(v, { x: cols[idx].x + 3, y: y - 9, size: 8, font, color: rgb(0.18, 0.2, 0.24) }));
    y -= 14;
  };

  if (mode === "team") {
    let zebra = 0;
    const memberStartPage = new Map<string, any>();
    for (const m of members) {
      if (y < 52) newPage();
      memberStartPage.set(m.name, page);
      page.drawRectangle({ x: left, y: y - 14, width: 790, height: 16, color: rgb(0.93, 0.95, 0.98) });
      page.drawText(`${m.name} (${m.rows.length} sessions)`, { x: left + 4, y: y - 10, size: 9, font: fontBold, color: rgb(0.14, 0.17, 0.22) });
      y -= 18;
      drawTableHeader();
      for (const r of m.rows.slice(0, 120)) drawRow(r, zebra++);
      y -= 6;
    }
    for (const t of tocEntries) {
      const target = memberStartPage.get(t.name);
      if (target) addInternalLink(tocPage, t.x, t.y, t.w, t.h, target);
    }
  } else {
    drawTableHeader();
    const view = rows.slice(0, 300);
    for (let i = 0; i < view.length; i++) drawRow(view[i], i);
  }

  return pdf.save();
}

async function makeStyledXlsx(args: {
  orgName: string;
  provider: string;
  slug: string;
  mode: "team" | "member";
  from: Date;
  to: Date;
  rows: ExportRow[];
}): Promise<Buffer> {
  const { orgName, provider, slug, mode, from, to, rows } = args;
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Report", {
    views: [{ state: "frozen", ySplit: 8 }],
  });

  const iconPath = path.join(process.cwd(), "app", "icon.png");
  try {
    const bytes = await readFile(iconPath);
    const imageId = workbook.addImage({ base64: `data:image/png;base64,${bytes.toString("base64")}`, extension: "png" });
    sheet.addImage(imageId, {
      tl: { col: 0, row: 0 },
      ext: { width: 34, height: 34 },
    });
  } catch {}

  sheet.getCell("B1").value = "Telemetryc Report";
  sheet.getCell("B1").font = { bold: true, size: 16, color: { argb: "FF0E1726" } };
  sheet.getCell("B2").value = `${orgName} · ${provider}/${slug}`;
  sheet.getCell("B2").font = { size: 11, color: { argb: "FF334155" } };
  sheet.getCell("B3").value = `Range: ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)} · Mode: ${mode}`;
  sheet.getCell("B3").font = { size: 10, color: { argb: "FF475569" } };

  sheet.columns = [
    { width: 22 },
    { width: 26 },
    { width: 14 },
    { width: 30 },
    { width: 18 },
    { width: 22 },
    { width: 22 },
    { width: 12 },
    { width: 12 },
    { width: 14 },
    { width: 14 },
    { width: 10 },
    { width: 10 },
    { width: 8 },
  ];

  const t = totals(rows);
  let r = 5;
  sheet.getRow(r).values = ["Summary", "Sessions", "Tokens In", "Tokens Out", "Messages", "User Turns", "Errors"];
  sheet.getRow(r).font = { bold: true, color: { argb: "FF0F172A" } };
  sheet.getRow(r).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F5" } };
  r++;
  sheet.getRow(r).values = ["Team", t.sessions, t.tokensIn, t.tokensOut, t.messages, t.userTurns, t.errors];
  r += 2;

  const detailHeader = [
    "user_name",
    "user_id",
    "source",
    "repo",
    "model",
    "started_at",
    "ended_at",
    "tokens_in",
    "tokens_out",
    "tokens_cache_read",
    "tokens_cache_write",
    "messages",
    "user_turns",
    "errors",
  ];

  const writeDetailRows = (detailRows: ExportRow[]) => {
    const hr = sheet.getRow(r);
    hr.values = detailHeader;
    hr.font = { bold: true, color: { argb: "FF0F172A" } };
    hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    r++;
    for (const row of detailRows) {
      sheet.getRow(r).values = [
        row.userName,
        row.userId,
        row.source,
        row.repo,
        row.model ?? "",
        row.startedAt.toISOString(),
        row.endedAt.toISOString(),
        row.tokensIn,
        row.tokensOut,
        row.tokensCacheRead,
        row.tokensCacheWrite,
        row.messages,
        row.userTurns,
        row.errors,
      ];
      r++;
    }
  };

  if (mode === "team") {
    const byMember = new Map<string, ExportRow[]>();
    for (const row of rows) {
      const key = `${row.userName}||${row.userId}`;
      byMember.set(key, [...(byMember.get(key) ?? []), row]);
    }
    const members = [...byMember.entries()]
      .map(([k, rs]) => {
        const [name, uid] = k.split("||");
        return { name, uid, rows: rs, total: totals(rs) };
      })
      .sort((a, b) => b.total.tokensOut - a.total.tokensOut);

    for (const m of members) {
      sheet.mergeCells(`A${r}:G${r}`);
      const title = sheet.getCell(`A${r}`);
      title.value = `${m.name} (${m.rows.length} sessions)`;
      title.font = { bold: true, size: 12, color: { argb: "FF1E293B" } };
      title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
      r++;
      sheet.getRow(r).values = ["member", "user_id", "sessions", "tokens_in", "tokens_out", "messages", "errors"];
      sheet.getRow(r).font = { bold: true };
      r++;
      sheet.getRow(r).values = [m.name, m.uid, m.total.sessions, m.total.tokensIn, m.total.tokensOut, m.total.messages, m.total.errors];
      r++;
      writeDetailRows(m.rows);
      r += 2;
    }
  } else {
    writeDetailRows(rows);
  }

  for (let rr = 1; rr <= sheet.rowCount; rr++) {
    const row = sheet.getRow(rr);
    for (let c = 1; c <= 14; c++) {
      const cell = row.getCell(c);
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    }
  }

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

export async function GET(req: Request, { params }: { params: Promise<{ provider: string; slug: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { provider, slug } = await params;
  if (provider !== "github" && provider !== "gitlab") return NextResponse.json({ error: "bad provider" }, { status: 400 });

  const [member] = await db
    .select({ orgId: schema.org.id, role: schema.membership.role, orgName: schema.org.name })
    .from(schema.membership)
    .innerJoin(schema.org, eq(schema.membership.orgId, schema.org.id))
    .where(and(eq(schema.membership.userId, session.user.id), eq(schema.org.provider, provider), eq(schema.org.slug, slug)))
    .limit(1);

  if (!member || member.role !== "manager") return NextResponse.json({ error: "not a manager of this org" }, { status: 403 });

  const url = new URL(req.url);
  const inline = url.searchParams.get("inline") === "1";
  const metaOnly = url.searchParams.get("meta") === "1";
  const formatRaw = url.searchParams.get("format");
  const format = (formatRaw === "csv" || formatRaw === "xlsx" ? formatRaw : "pdf") as "csv" | "pdf" | "xlsx";
  const mode = (url.searchParams.get("mode") === "member" ? "member" : "team") as "member" | "team";

  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") || 30)));
  const from = fromRaw ? new Date(`${fromRaw}T00:00:00.000Z`) : new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const to = toRaw ? new Date(`${toRaw}T23:59:59.999Z`) : new Date();

  const selectedMemberIds = url.searchParams.getAll("member").filter(Boolean);
  const userFilter = selectedMemberIds.length > 0 ? inArray(schema.sessionEvent.userId, selectedMemberIds) : undefined;

  const whereBase = [
    eq(schema.sessionEvent.orgId, member.orgId),
    gte(schema.sessionEvent.startedAt, from),
    lte(schema.sessionEvent.startedAt, to),
  ];

  const rowsRaw = await db
    .select({
      userId: schema.sessionEvent.userId,
      userName: schema.user.name,
      source: schema.sessionEvent.source,
      repo: schema.sessionEvent.repo,
      model: schema.sessionEvent.model,
      startedAt: schema.sessionEvent.startedAt,
      endedAt: schema.sessionEvent.endedAt,
      tokensIn: schema.sessionEvent.tokensIn,
      tokensOut: schema.sessionEvent.tokensOut,
      tokensCacheRead: schema.sessionEvent.tokensCacheRead,
      tokensCacheWrite: schema.sessionEvent.tokensCacheWrite,
      messages: schema.sessionEvent.messages,
      userTurns: schema.sessionEvent.userTurns,
      errors: schema.sessionEvent.errors,
    })
    .from(schema.sessionEvent)
    .innerJoin(schema.user, eq(schema.sessionEvent.userId, schema.user.id))
    .where(and(...whereBase, ...(userFilter ? [userFilter] : [])))
    .orderBy(desc(schema.sessionEvent.startedAt));

  const rows: ExportRow[] = rowsRaw.map((r) => ({
    userId: r.userId,
    userName: r.userName,
    source: r.source,
    repo: r.repo,
    model: r.model,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    tokensIn: Number(r.tokensIn),
    tokensOut: Number(r.tokensOut),
    tokensCacheRead: Number(r.tokensCacheRead),
    tokensCacheWrite: Number(r.tokensCacheWrite),
    messages: r.messages,
    userTurns: r.userTurns,
    errors: r.errors,
  }));

  const stamp = new Date().toISOString().slice(0, 10);
  const baseName = `telemetryc-${provider}-${slug}-${stamp}`;

  const byMemberForMeta = new Map<string, ExportRow[]>();
  for (const r of rows) byMemberForMeta.set(r.userName, [...(byMemberForMeta.get(r.userName) ?? []), r]);
  const memberNames = [...byMemberForMeta.keys()];
  const toc = memberNames.map((name, i) => ({ name, page: mode === "team" ? i + 2 : 2 }));

  if (metaOnly) {
    return NextResponse.json({
      orgName: member.orgName,
      mode,
      rowsCount: rows.length,
      from: from.toISOString(),
      to: to.toISOString(),
      toc,
    });
  }

  if (format === "csv") {
    const lines: string[] = [];
    lines.push(["org", esc(member.orgName)].join(","));
    lines.push(["from", esc(from.toISOString())].join(","));
    lines.push(["to", esc(to.toISOString())].join(","));
    lines.push(["mode", esc(mode)].join(","));
    lines.push("");

    if (mode === "team") {
      const t = totals(rows);
      lines.push("summary,sessions,tokens_in,tokens_out,messages,user_turns,errors");
      lines.push(["team", t.sessions, t.tokensIn, t.tokensOut, t.messages, t.userTurns, t.errors].map(esc).join(","));
      lines.push("");
    } else {
      lines.push("member,user_id,sessions,tokens_in,tokens_out,messages,user_turns,errors");
      const byMember = new Map<string, ExportRow[]>();
      for (const r of rows) {
        const key = `${r.userName}||${r.userId}`;
        byMember.set(key, [...(byMember.get(key) ?? []), r]);
      }
      for (const [k, rs] of byMember) {
        const [name, uid] = k.split("||");
        const t = totals(rs);
        lines.push([name, uid, t.sessions, t.tokensIn, t.tokensOut, t.messages, t.userTurns, t.errors].map(esc).join(","));
      }
      lines.push("");
    }

    const detailHeader = "user_name,user_id,source,repo,model,started_at,ended_at,tokens_in,tokens_out,tokens_cache_read,tokens_cache_write,messages,user_turns,errors";
    if (mode === "team") {
      const byMember = new Map<string, ExportRow[]>();
      for (const r of rows) {
        const key = `${r.userName}||${r.userId}`;
        byMember.set(key, [...(byMember.get(key) ?? []), r]);
      }
      const members = [...byMember.entries()]
        .map(([k, rs]) => {
          const [name, uid] = k.split("||");
          return { name, uid, rows: rs, total: totals(rs) };
        })
        .sort((a, b) => b.total.tokensOut - a.total.tokensOut);

      for (const m of members) {
        lines.push(`member:${esc(m.name)}`);
        lines.push("member,user_id,sessions,tokens_in,tokens_out,messages,user_turns,errors");
        lines.push([m.name, m.uid, m.total.sessions, m.total.tokensIn, m.total.tokensOut, m.total.messages, m.total.userTurns, m.total.errors].map(esc).join(","));
        lines.push(detailHeader);
        for (const r of m.rows) {
          lines.push([
            r.userName,
            r.userId,
            r.source,
            r.repo,
            r.model ?? "",
            r.startedAt.toISOString(),
            r.endedAt.toISOString(),
            r.tokensIn,
            r.tokensOut,
            r.tokensCacheRead,
            r.tokensCacheWrite,
            r.messages,
            r.userTurns,
            r.errors,
          ].map(esc).join(","));
        }
        lines.push("");
      }
    } else {
      lines.push(detailHeader);
      for (const r of rows) {
        lines.push([
          r.userName,
          r.userId,
          r.source,
          r.repo,
          r.model ?? "",
          r.startedAt.toISOString(),
          r.endedAt.toISOString(),
          r.tokensIn,
          r.tokensOut,
          r.tokensCacheRead,
          r.tokensCacheWrite,
          r.messages,
          r.userTurns,
          r.errors,
        ].map(esc).join(","));
      }
    }

    return new Response(lines.join("\n"), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `${inline ? "inline" : "attachment"}; filename=\"${baseName}-${mode}.csv\"`,
        "cache-control": "no-store",
      },
    });
  }

  if (format === "xlsx") {
    const xlsx = await makeStyledXlsx({
      orgName: member.orgName,
      provider,
      slug,
      mode,
      from,
      to,
      rows,
    });
    return new Response(Buffer.from(xlsx), {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `${inline ? "inline" : "attachment"}; filename=\"${baseName}-${mode}.xlsx\"`,
        "cache-control": "no-store",
      },
    });
  }

  const pdf = await makeStyledPdf({
    orgName: member.orgName,
    provider,
    slug,
    mode,
    from,
    to,
    rows,
  });
  return new Response(Buffer.from(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename=\"${baseName}-${mode}.pdf\"`,
      "cache-control": "no-store",
    },
  });
}
