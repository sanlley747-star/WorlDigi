// ByGether - PASO 12 / bloque 3: busca una noticia real para una cuenta-persona.
// Feed RSS/Atom de la tabla fuentes_noticias -> entrada reciente no publicada -> pagina del articulo -> OG (titulo, descripcion, foto).
// No escribe nada en la base de datos (el bloque 5 publica).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const UA = "Mozilla/5.0 (compatible; ByGetherBot/1.0)";
const MAX_FEED = 1_500_000, MAX_HTML = 400_000, MAX_IMG = 5_000_000;
const TIEMPO_MAX_MS = 55_000;

// deno-lint-ignore no-explicit-any
type Fila = Record<string, any>;
export interface Item { titulo: string; url: string; urlNorm: string; publicada: string | null; descripcion: string }
export interface OG { title?: string; description?: string; image?: string; siteName?: string; canonical?: string }

// Fuentes generalistas (cultura / ciencia): solo entradas afines al tema.
const FILTRO_TEMA: Record<string, RegExp> = {
  libros: /libro|novela|autor|autora|escritor|escritora|literatur|poes[ií]a|editorial|cuento|ensayo|biblioteca|lectur/i,
  ciencia: /cient[ií]fic|investigaci|estudio|descubr|astr|espacio|f[ií]sica|biolog|clima|universo|especie|planeta|gen[eé]tic|cerebro/i,
  // Bloque 1 (fuentes dominicanas 70/30): filtros nuevos para las secciones compartidas de Diario Libre
  // (un solo feed -planeta.xml, revista.xml, economia.xml- sirve a varios temas; sin filtro mostraría lo mismo en todos).
  "tecnología": /tecnolog|aplicaci[oó]n\b|\bapp\b|software|smartphone|celular|inteligencia artificial|internet|gadget|dispositivo|rob[oó]t|inform[aá]tic/i,
  moda: /\bmoda\b|dise[ñn]ador|colecci[oó]n|pasarela|tendencia (de )?(ropa|estilo)|belleza|maquillaje|desfile/i,
  "música": /m[uú]sica|canci[oó]n|[aá]lbum|cantante|artista musical|concierto|banda\b|ritmo|g[eé]nero musical/i,
  "cine y series": /pel[ií]cula|\bcine\b|\bserie\b|estreno|actor\b|actriz|director(a)? de cine|Netflix|Disney|HBO|temporada|taquilla/i,
  viajes: /turis|\bviaj|destino tur[ií]stico|\bhotel\b|\bplaya\b|\bvuelo\b|aerol[ií]nea|excursi[oó]n|crucero/i,
};
const GENERALISTAS = /Vanguardia|ABC|elDiario|Diario Libre/i;

export const hostPublico = (u: URL): boolean => {
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.includes(":") || h.startsWith("[")) return false;
  return !/^\d+\.\d+\.\d+\.\d+$/.test(h);
};

function mezclar<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

async function leerTexto(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const partes: Uint8Array[] = []; let total = 0;
  while (total < max) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    partes.push(value); total += value.length;
  }
  try { await reader.cancel(); } catch { /* ya cerrado */ }
  const buf = new Uint8Array(total); let o = 0;
  for (const p of partes) { buf.set(p, o); o += p.length; }
  const cs = /charset=([\w-]+)/i.exec(res.headers.get("content-type") ?? "")?.[1]?.toLowerCase();
  try { return new TextDecoder(cs ?? "utf-8").decode(buf); } catch { return new TextDecoder().decode(buf); }
}

async function pedir(url: string, max: number, ms: number, accept: string) {
  const u = new URL(url);
  if (!hostPublico(u)) throw new Error("url no permitida");
  const res = await fetch(u, { headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "es" }, redirect: "follow", signal: AbortSignal.timeout(ms) });
  const fin = new URL(res.url || u.href);
  if (!hostPublico(fin)) throw new Error("redireccion no permitida");
  const texto = res.ok ? await leerTexto(res, max) : "";
  return { status: res.status, texto, finalUrl: fin.href, ctype: res.headers.get("content-type") ?? "" };
}

// ---------------------------------------------------------------- texto
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const cp = (n: number) => { try { return String.fromCodePoint(n); } catch { return ""; } };
function decodificar(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => cp(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => cp(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
const limpiar = (s: string) => decodificar(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (b: string, name: string) => new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(b)?.[1];

export function normalizarUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol === "http:") u.protocol = "https:";
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|xtor|at_|ref$|source$)/i.test(k)) u.searchParams.delete(k);
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return hostPublico(new URL(s)) ? s : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- feed RSS / Atom
export function parsearFeed(xml: string): Item[] {
  const out: Item[] = [];
  for (const m of xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const b = m[0];
    const titulo = limpiar(tag(b, "title") ?? "");
    let link = limpiar(tag(b, "feedburner:origLink") ?? "") || limpiar(tag(b, "link") ?? "");
    if (!/^https?:\/\//i.test(link)) {
      const a = /<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(b) ?? /<link\b[^>]*href=["']([^"']+)["']/i.exec(b);
      const guid = limpiar(tag(b, "guid") ?? "");
      link = a ? decodificar(a[1]) : (/^https?:\/\//i.test(guid) ? guid : "");
    }
    const urlNorm = link ? normalizarUrl(link) : null;
    if (!titulo || !urlNorm) continue;
    const f = tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date");
    const t = f ? new Date(limpiar(f)) : null;
    const descripcion = limpiar(tag(b, "description") ?? tag(b, "summary") ?? tag(b, "content:encoded") ?? "").slice(0, 400);
    out.push({ titulo, url: link, urlNorm, publicada: t && !isNaN(t.getTime()) ? t.toISOString() : null, descripcion });
  }
  return out;
}

// ---------------------------------------------------------------- OG de la pagina del articulo
function meta(html: string, prop: string): string | undefined {
  const a = new RegExp(`<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${prop}["'][^>]*content\\s*=\\s*["']([^"']*)["'][^>]*>`, "i").exec(html);
  const b = new RegExp(`<meta\\b[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${prop}["'][^>]*>`, "i").exec(html);
  const v = a?.[1] ?? b?.[1];
  return v ? limpiar(v) || undefined : undefined;
}

export function extraerOG(html: string, base: string): OG {
  const abs = (v?: string) => { if (!v) return undefined; try { const u = new URL(decodificar(v), base); return hostPublico(u) ? u.href : undefined; } catch { return undefined; } };
  const canon = /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1];
  const imgLink = /<link\b[^>]*rel=["']image_src["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1];
  return {
    title: meta(html, "og:title") ?? meta(html, "twitter:title") ?? limpiar(tag(html, "title") ?? "") ?? undefined,
    description: meta(html, "og:description") ?? meta(html, "twitter:description") ?? meta(html, "description"),
    image: abs(meta(html, "og:image:secure_url") ?? meta(html, "og:image") ?? meta(html, "twitter:image") ?? imgLink),
    siteName: meta(html, "og:site_name"),
    canonical: abs(canon),
  };
}

async function verificarImagen(url: string): Promise<{ ok: boolean; motivo?: string; tipo?: string; bytes?: number | null }> {
  try {
    const u = new URL(url);
    if (!hostPublico(u)) return { ok: false, motivo: "url de imagen no permitida" };
    const archivo = u.pathname.split("/").pop() ?? "";
    if (/(logo|favicon|placeholder|avatar|sprite|blank)/i.test(archivo) || /^default/i.test(archivo)) return { ok: false, motivo: "parece logo o imagen generica" };
    const res = await fetch(u, { headers: { "User-Agent": UA, Range: "bytes=0-2047", Accept: "image/*" }, redirect: "follow", signal: AbortSignal.timeout(10_000) });
    let tipo = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const cr = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "");
    const bytes = cr ? Number(cr[1]) : (Number(res.headers.get("content-length") ?? 0) || null);
    try { await res.body?.cancel(); } catch { /* ya cerrado */ }
    if (!res.ok) return { ok: false, motivo: `http ${res.status}` };
    if (!/^image\/(jpeg|png|webp|gif)$/.test(tipo)) {
      const porExt = ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" } as Record<string, string>)[u.pathname.split(".").pop()?.toLowerCase() ?? ""];
      if (!porExt) return { ok: false, motivo: `tipo no soportado (${tipo || "?"})` };
      tipo = porExt;
    }
    if (bytes && bytes > MAX_IMG) return { ok: false, motivo: `demasiado grande (${bytes} bytes)` };
    return { ok: true, tipo, bytes };
  } catch (e) { return { ok: false, motivo: e instanceof Error ? e.message : String(e) }; }
}

// ---------------------------------------------------------------- flujo principal
export async function buscarNoticia(
  sb: SupabaseClient, o: { tema: string; agentEmail?: string | null; maxHoras?: number; fuenteId?: number | null },
): Promise<Fila> {
  const t0 = Date.now();
  const log: Fila[] = [];
  const agotado = () => Date.now() - t0 > TIEMPO_MAX_MS;

  let q = sb.from("fuentes_noticias").select("id,tema,nombre,sitio_url,feed_url").eq("activa", true).not("feed_url", "is", null);
  q = o.fuenteId ? q.eq("id", o.fuenteId) : q.eq("tema", o.tema);
  const { data: fuentes, error } = await q;
  if (error) throw new Error(`fuentes_noticias: ${error.message}`);
  if (!fuentes?.length) return { ok: false, motivo: `sin fuentes activas para el tema: ${o.tema}` };

  const maxMs = (o.maxHoras ?? 96) * 3_600_000;
  for (const f of mezclar(fuentes as Fila[]).slice(0, 4)) {
    if (agotado()) break;
    let items: Item[];
    try {
      const r = await pedir(f.feed_url, MAX_FEED, 12_000, "application/rss+xml, application/atom+xml, application/xml, text/xml, */*");
      if (r.status !== 200) { log.push({ fuente: f.nombre, paso: "feed", error: `http ${r.status}` }); continue; }
      items = parsearFeed(r.texto);
    } catch (e) { log.push({ fuente: f.nombre, paso: "feed", error: e instanceof Error ? e.message : String(e) }); continue; }
    if (!items.length) { log.push({ fuente: f.nombre, paso: "feed", error: "sin entradas" }); continue; }

    const ahora = Date.now();
    let cand = items.filter((i) => !i.publicada || ahora - Date.parse(i.publicada) <= maxMs);
    const filtro = FILTRO_TEMA[f.tema];
    if (filtro && GENERALISTAS.test(f.nombre)) cand = cand.filter((i) => filtro.test(`${i.titulo} ${i.descripcion}`));
    cand = cand.slice(0, 30);
    if (!cand.length) { log.push({ fuente: f.nombre, paso: "filtro", error: "ninguna entrada reciente y afin al tema" }); continue; }

    const { data: usadas } = await sb.rpc("noticias_ya_publicadas", { p_urls: cand.map((c) => c.urlNorm) });
    const ya = new Set<string>(usadas ?? []);
    cand = cand.filter((c) => !ya.has(c.urlNorm));
    if (!cand.length) { log.push({ fuente: f.nombre, paso: "dedupe", error: "todas ya publicadas" }); continue; }

    for (const c of mezclar(cand.slice(0, 8)).slice(0, 4)) {
      if (agotado()) break;
      try {
        const p = await pedir(c.url, MAX_HTML, 12_000, "text/html,application/xhtml+xml");
        if (p.status !== 200 || !/html/i.test(p.ctype)) { log.push({ fuente: f.nombre, url: c.urlNorm, paso: "pagina", error: `http ${p.status} ${p.ctype}` }); continue; }
        const og = extraerOG(p.texto, p.finalUrl);
        if (!og.image) { log.push({ fuente: f.nombre, url: c.urlNorm, paso: "og", error: "sin og:image" }); continue; }
        const img = await verificarImagen(og.image);
        if (!img.ok) { log.push({ fuente: f.nombre, url: c.urlNorm, paso: "imagen", error: img.motivo }); continue; }
        return {
          ok: true, tema: o.tema, agent_email: o.agentEmail ?? null,
          fuente: { id: f.id, nombre: f.nombre, feed_url: f.feed_url },
          noticia: {
            titulo: og.title || c.titulo, url: c.urlNorm, url_normalizada: c.urlNorm, publicada: c.publicada,
            descripcion: og.description || c.descripcion, sitio: og.siteName ?? f.nombre,
          },
          imagen: { url: og.image, tipo: img.tipo, bytes: img.bytes },
          intentos: log, ms: Date.now() - t0,
        };
      } catch (e) { log.push({ fuente: f.nombre, url: c.urlNorm, paso: "pagina", error: e instanceof Error ? e.message : String(e) }); }
    }
  }
  return { ok: false, motivo: "no se encontro una noticia valida (con foto) en las fuentes probadas", intentos: log, ms: Date.now() - t0 };
}
