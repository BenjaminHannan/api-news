const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : "#"; } catch { return "#"; } };
const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local

const store = {
  get: (k) => new Promise((r) => chrome.storage.local.get(k, r)),
  set: (o) => new Promise((r) => chrome.storage.local.set(o, r)),
};

function status(msg, err) {
  const el = $("status");
  el.hidden = false;
  el.className = err ? "err" : "";
  el.textContent = msg;
}

async function topSites(days) {
  const items = await chrome.history.search({ text: "", startTime: Date.now() - days * 864e5, maxResults: 2000 });
  const byHost = new Map();
  for (const it of items) {
    let u; try { u = new URL(it.url); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    const host = u.hostname.replace(/^www\./, "");
    if (/^(localhost|127\.|192\.168\.)/.test(host) || /google\.[a-z.]+$/.test(host) && u.pathname === "/search") continue;
    const h = byHost.get(host) || { host, visits: 0, titles: [] };
    h.visits += it.visitCount || 1;
    if (it.title && h.titles.length < 5) h.titles.push(it.title);
    byHost.set(host, h);
  }
  return [...byHost.values()].sort((a, b) => b.visits - a.visits).slice(0, 12);
}

async function frontPage(host) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 7000);
  try {
    const res = await fetch(`https://${host}/`, { signal: ctl.signal, credentials: "omit" });
    if (!res.ok) return [];
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const out = [];
    for (const a of doc.querySelectorAll("h1 a, h2 a, h3 a, article a")) {
      const text = a.textContent.replace(/\s+/g, " ").trim();
      if (text.length < 25 || text.length > 160) continue;
      let href; try { href = new URL(a.getAttribute("href"), `https://${host}/`).href; } catch { continue; }
      if (!out.some((o) => o.title === text)) out.push({ title: text, url: href });
      if (out.length >= 10) break;
    }
    return out;
  } catch { return []; } finally { clearTimeout(t); }
}

async function gather(days) {
  const sites = await topSites(days);
  if (!sites.length) throw new Error("No browsing history found to build an edition from.");
  const pages = await Promise.all(sites.slice(0, 8).map((s) => frontPage(s.host)));
  return sites.map((s, i) => ({ host: s.host, visits: s.visits, recentlyRead: s.titles, headlines: pages[i] || [] }));
}

const SYSTEM = `You are the editor of "The Morning Tab", a personal daily newspaper front page built from the sites one person reads.
You receive their most-visited sites, titles of pages they recently read, and current front-page headlines from those sites.
Write an edition in the voice of a classic newspaper: concise, warm, a little witty, never sensational. Use only the supplied material; do not invent facts, quotes, numbers, or URLs. Each story must come from supplied headlines and reuse a supplied URL. Summaries should paraphrase the headline and context and stay modest about what you don't know.
Respond with ONLY a JSON object, no markdown fences, with this shape:
{"tagline": string (optional new tagline, <60 chars),
 "stories": [{"section": string (e.g. "Technology", "Local", "Essay"), "headline": string, "dek": string (1-2 sentence summary), "source": string (hostname), "url": string}],  // 8-12 stories; first is the lead
 "readingList": [{"title": string, "url": string}],  // 4-6 picks worth reading
 "pattern": string  // one sentence on what the reader's recent attention says about them
}`;

async function generate(data, cfg) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: cfg.model || "claude-sonnet-5-5",
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: "user", content: `Today is ${new Date().toDateString()}.\n\n${JSON.stringify(data)}` }],
    }),
  });
  if (!res.ok) {
    let detail = ""; try { detail = (await res.json()).error?.message; } catch {}
    throw new Error(`Anthropic API error ${res.status}${detail ? ": " + detail : ""}`);
  }
  const body = await res.json();
  const text = body.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("The editor returned something that wasn't an edition.");
  return JSON.parse(m[0]);
}

function render(ed, n) {
  const stories = ed.stories || [];
  const link = (s, cls, tag) => `<article class="${cls}"><div class="kicker">${esc(s.section)}</div>
    <a href="${esc(safeUrl(s.url))}"><h2>${esc(s.headline)}</h2></a><p>${esc(s.dek)}</p>
    <div class="src">via ${esc(s.source)}</div></article>`;
  const [lead, ...rest] = stories;
  const mid = rest.slice(0, 4), low = rest.slice(4);
  $("content").innerHTML = `
    <div class="col">${lead ? link(lead, "lead") : ""}${low.map((s) => link(s, "small")).join("")}</div>
    <div class="col">${mid.map((s) => link(s, "small")).join("")}</div>
    <div class="col">
      <div class="box"><h3>Reading list</h3><ul>${(ed.readingList || []).map((r) => `<li><a href="${esc(safeUrl(r.url))}">${esc(r.title)}</a></li>`).join("")}</ul></div>
      <div class="box"><h3>Your pattern</h3><p style="font-size:13px;line-height:1.5;margin:0">${esc(ed.pattern)}</p></div>
    </div>`;
  if (ed.tagline) document.querySelector(".tag").textContent = `“${ed.tagline}”`;
  $("content").hidden = false;
  $("status").hidden = true;
}

async function load(force) {
  $("date").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const cfg = await store.get(["apiKey", "model", "days", "edition", "editionDate", "count"]);
  const n = (cfg.count || 0) + (force || cfg.editionDate !== today() ? 1 : 0);
  $("vol").textContent = `Vol. I · No. ${n || 1}`;
  $("edition").textContent = "Morning Edition";
  if (!force && cfg.edition && cfg.editionDate === today()) return render(cfg.edition, n);
  if (!cfg.apiKey) {
    status("Add your Anthropic API key in Settings to print today's edition.", true);
    if (cfg.edition) render(cfg.edition, n), status("Showing the last edition. Add an API key in Settings to refresh.", true);
    return;
  }
  try {
    $("content").hidden = true;
    status("Reading your history and the sites you read…");
    const data = await gather(cfg.days || 7);
    status("The editor is writing today's edition…");
    const ed = await generate(data, cfg);
    await store.set({ edition: ed, editionDate: today(), count: n });
    render(ed, n);
  } catch (e) {
    status(e.message || String(e), true);
    if (cfg.edition) render(cfg.edition, n), status(`${e.message} — showing the last edition.`, true);
  }
}

$("regen").onclick = (e) => { e.preventDefault(); load(true); };
load(false);
