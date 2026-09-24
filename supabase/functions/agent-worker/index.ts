// ByGether - PASO 4: orquestador (worker) de las cuentas automaticas, 100 % en Supabase.
//
// pg_cron lo invoca cada minuto (job 'agent-worker'). En cada ejecucion:
//   1. worker_iniciar()  -> candado (nunca dos ejecuciones a la vez) y estado (activo / en pausa / en prueba)
//   2. worker_cupo()     -> cuantas llamadas a Gemini toca hacer AHORA (limite por minuto + presupuesto diario + curva horaria)
//   3. claim_agent_tasks -> toma tareas COMMENT / POST de agent_queue (los likes/follows/reposts son del Paso 5, SQL puro)
//   4. por cada tarea: contexto del hilo -> prompt -> Gemini -> validacion minima -> publica y cierra la tarea (1 transaccion)
//   5. si Gemini responde 429/503/sobrecarga: se PAUSA todo (30s, 60s, 120s... tope 5 min, + jitter), las tareas vuelven a
//      'pending' sin gastar intentos y nunca se marcan como failed por culpa de la API. Al vencer la pausa la siguiente
//      ejecucion hace UNA llamada de prueba; si sale bien, se reanuda a ritmo normal (sin ráfagas compensatorias).
//
// PASO 7: las tareas POST con payload.imagen = true generan ademas una foto propia (imagen.ts, modelo_imagen de agent_config)
//   que se sube al bucket posts-images. Las imagenes tienen su propio cupo (worker_cupo_imagen) y si fallan la
//   publicacion sale igual, solo con texto.
//
// Autenticacion: encabezado x-worker-token = secreto AGENT_WORKER_TOKEN del Vault (verify_jwt desactivado a proposito,
// porque pg_cron no tiene un JWT de usuario; sin el token la funcion responde 401 y no toca nada).
//
// Solicitud opcional (todas requieren el token):
//   {}                                               ciclo normal
//   {"modo":"diagnostico"}                           estado, cupo, modelos disponibles (nunca devuelve secretos)
//   {"dry_run":"comentario","post_id":62,"agent_email":"...","responder_a":3}   genera pero NO publica ni toca la cola
//   {"dry_run":"post","agent_email":"...","tema":"moda"}
//   {"dry_run":"imagen","tema":"cocina","texto":"..."}   genera una imagen y la sube a posts-images/_pruebas (no publica)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import {
  imagenDelPost, limpiarSalida, PROMPT_DESCRIPCION_IMAGEN, promptComentario, promptPublicacion,
} from "./prompts.ts";
import type { Agente, Catalogo, Ctx, Prompt } from "./prompts.ts";
import { generar, GeminiError, listarModelos } from "./gemini.ts";
import type { Imagen } from "./gemini.ts";
import { crearImagenPost } from "./imagen.ts";
import { extractOpenGraph, generateLinkComment } from "./enlaces.ts";

const TIEMPO_MAX_MS = 100_000;          // margen bajo el limite de la funcion
const TIPOS_IA = ["POST", "COMMENT"];
const IMG_MAX_BYTES = 4_000_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const responder = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Fila = Record<string, any>;
class SinCupo extends Error {}

interface Sesion {
  sb: SupabaseClient; key: string; modelo: string; modeloImagen: string; cat: Catalogo;
  restantes: number; espaciadoMs: number; ultima: number; llamadas: number;
}

// ------------------------------------------------------------------ seguridad y configuracion
let tokenCache: { valor: string; hasta: number } | null = null;
async function tokenEsperado(sb: SupabaseClient): Promise<string | null> {
  if (tokenCache && tokenCache.hasta > Date.now()) return tokenCache.valor;
  const { data } = await sb.rpc("get_app_secret", { secret_name: "AGENT_WORKER_TOKEN" });
  if (!data) return null;
  tokenCache = { valor: String(data), hasta: Date.now() + 10 * 60_000 };
  return tokenCache.valor;
}
function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function claveGemini(sb: SupabaseClient): Promise<{ key: string | null; origen: string | null }> {
  for (const n of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_API_KEY"]) {
    const v = Deno.env.get(n);
    if (v) return { key: v, origen: `env:${n}` };
  }
  for (const n of ["GEMINI_API_KEY", "gemini_api_key"]) {
    const { data } = await sb.rpc("get_app_secret", { secret_name: n });
    if (data) return { key: String(data), origen: `vault:${n}` };
  }
  return { key: null, origen: null };
}

async function cargarConfig(sb: SupabaseClient): Promise<Fila> {
  const { data, error } = await sb.from("agent_config").select("clave,valor");
  if (error) throw new Error(`agent_config: ${error.message}`);
  return Object.fromEntries((data ?? []).map((f: Fila) => [f.clave, f.valor]));
}

let catCache: { cat: Catalogo; hasta: number } | null = null;
async function cargarCatalogo(sb: SupabaseClient): Promise<Catalogo> {
  if (catCache && catCache.hasta > Date.now()) return catCache.cat;
  const { data, error } = await sb.from("agent_personas").select("persona_id,nombre,descripcion,system_prompt,estilo,activa");
  if (error) throw new Error(`agent_personas: ${error.message}`);
  let base = "";
  const personas: Catalogo["personas"] = {};
  for (const f of (data ?? []) as Fila[]) {
    if (f.persona_id === "_base") base = f.system_prompt;
    else if (f.activa !== false) {
      personas[f.persona_id] = { nombre: f.nombre, descripcion: f.descripcion, system_prompt: f.system_prompt, estilo: f.estilo ?? {} };
    }
  }
  if (!base || !Object.keys(personas).length) throw new Error("catalogo de personalidades incompleto");
  catCache = { cat: { base, personas }, hasta: Date.now() + 5 * 60_000 };
  return catCache.cat;
}

// ------------------------------------------------------------------ llamadas a Gemini (gobernador)
/** Toda llamada a Gemini pasa por aqui: respeta el cupo de la ejecucion, el espaciado y deja registro en agent_llm_calls. */
async function llamar(
  s: Sesion, tipo: string, agentId: string,
  p: { system?: string; user: string; imagen?: Imagen | null; maxTokens?: number; temperature?: number },
) {
  if (s.restantes <= 0) throw new SinCupo();
  const espera = s.espaciadoMs - (Date.now() - s.ultima);
  if (s.ultima && espera > 0) await sleep(espera + Math.floor(Math.random() * 700)); // jitter: nunca en rafagas exactas
  s.restantes--; s.llamadas++; s.ultima = Date.now();

  const { data: fila } = await s.sb.from("agent_llm_calls").insert({ agent_id: agentId, tipo, modelo: s.modelo }).select("id").single();
  const t = Date.now();
  const cerrar = async (campos: Fila) => {
    if (fila?.id) await s.sb.from("agent_llm_calls").update({ ...campos, ms: Date.now() - t }).eq("id", fila.id);
  };
  try {
    const r = await generar({ key: s.key, model: s.modelo, ...p });
    await cerrar({ status: r.status, ok: true, tokens_in: r.tokensIn, tokens_out: r.tokensOut });
    await s.sb.rpc("worker_exito_api"); // 200 OK: reinicia contadores de error y levanta la pausa
    return r;
  } catch (e) {
    if (e instanceof GeminiError) await cerrar({ status: e.status, ok: false, error: e.message.slice(0, 300) });
    throw e;
  }
}

async function descargarImagen(url: string): Promise<Imagen | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || /^(localhost|\d+\.\d+\.\d+\.\d+|\[)/i.test(u.hostname)) return null;
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    if (Number(r.headers.get("content-length") ?? 0) > IMG_MAX_BYTES) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > IMG_MAX_BYTES) return null;
    let mime = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const ext = u.pathname.split(".").pop()?.toLowerCase() ?? "";
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) {
      mime = ({ jfif: "image/jpeg", jpg: "image/jpeg", jpeg: "image/jpeg", pjpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" } as Record<string, string>)[ext] ?? "";
      if (!mime) return null;
    }
    return { mime, b64: encodeBase64(buf) };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ preparacion de prompts (lee BD, no escribe salvo la cache de descripciones)
async function agenteDe(s: Sesion, email: string): Promise<Agente | null> {
  const { data } = await s.sb.from("profiles").select("user_email,user_name,persona_id,config_cuenta_automatica")
    .eq("user_email", email).eq("is_cuenta_automatica", true).maybeSingle();
  return (data as Agente | null) ?? null;
}

async function prepararComentario(
  s: Sesion, postId: number, agenteEmail: string, responderA: number | null,
): Promise<{ agente: Agente; ctx: Ctx; prompt: Prompt } | { error: string }> {
  const agente = await agenteDe(s, agenteEmail);
  if (!agente) return { error: `cuenta automatica inexistente: ${agenteEmail}` };
  const { data: ctx } = await s.sb.rpc("contexto_hilo", { p_post_id: postId, p_agent_email: agenteEmail });
  if (!ctx) return { error: `post inexistente: ${postId}` };

  // Descripcion de la imagen: una sola llamada de vision por post, guardada en post_image_desc.
  const url = imagenDelPost(ctx);
  if (url && !ctx.post.imagen_descripcion && s.restantes > 0) {
    const img = await descargarImagen(url);
    if (img) {
      try {
        const r = await llamar(s, "vision", agenteEmail, { user: PROMPT_DESCRIPCION_IMAGEN, imagen: img, maxTokens: 200, temperature: 0.2 });
        const desc = r.texto.replace(/\s+/g, " ").trim().slice(0, 300);
        await s.sb.from("post_image_desc").upsert({ post_id: postId, descripcion: desc, modelo: s.modelo }, { onConflict: "post_id" });
        ctx.post.imagen_descripcion = desc;
      } catch (e) {
        if (e instanceof SinCupo || (e instanceof GeminiError && e.pausaGlobal)) throw e;
        // fallo de contenido en la vision: se comenta sin descripcion (el prompt ya avisa que no se ve la imagen)
      }
    }
  }

  // Comentario al que se responde, si no esta entre los ultimos 3 del hilo
  let objetivo: { id: number; autor?: string; contenido?: string } | null = null;
  if (responderA != null && !(ctx.ultimos_comentarios ?? []).some((c: Fila) => c.id === responderA)) {
    const { data: c } = await s.sb.from("comments").select("id,post_id,user_name,content").eq("id", responderA).maybeSingle();
    if (c && c.post_id === postId) objetivo = { id: c.id, autor: c.user_name, contenido: c.content };
  }
  return { agente, ctx, prompt: promptComentario(ctx, agente, s.cat, { responderA, objetivo }) };
}

async function prepararPost(
  s: Sesion, agenteEmail: string, tema: string | null, conImagen = false,
): Promise<{ agente: Agente; prompt: Prompt } | { error: string }> {
  const agente = await agenteDe(s, agenteEmail);
  if (!agente) return { error: `cuenta automatica inexistente: ${agenteEmail}` };
  const { data } = await s.sb.from("posts").select("content").eq("user_email", agenteEmail)
    .is("repost_of", null).order("created_at", { ascending: false }).limit(3);
  const previas = (data ?? []).map((f: Fila) => String(f.content ?? "")).filter(Boolean);
  // conImagen: el texto se redacta como pie de una foto propia (la foto la genera crearImagenPost despues)
  return { agente, prompt: promptPublicacion(agente, s.cat, { tema, previas, conImagen }) };
}

async function generarTexto(s: Sesion, agenteEmail: string, prompt: Prompt, tipo: string) {
  const r = await llamar(s, tipo, agenteEmail, { system: prompt.system, user: prompt.user, maxTokens: 400, temperature: 0.95 });
  return { r, validacion: limpiarSalida(r.texto, Number(prompt.meta.max_caracteres ?? 280)) };
}

// ------------------------------------------------------------------ una tarea de la cola
type Resultado = "completada" | "reintento" | "fallida";

async function procesarTarea(s: Sesion, t: Fila): Promise<Resultado> {
  const fallar = async (msg: string, definitivo = false): Promise<Resultado> => {
    const { data } = await s.sb.rpc("worker_fallar_tarea", { p_task_id: t.id, p_error: msg, p_definitivo: definitivo });
    return data === "failed" ? "fallida" : "reintento";
  };

  if (t.action_type === "COMMENT") {
    const postId = Number(t.target_id);
    if (!Number.isFinite(postId)) return fallar(`target_id invalido: ${t.target_id}`, true);
    const responderA = t.payload?.responder_a != null ? Number(t.payload.responder_a) : null;
    const prep = await prepararComentario(s, postId, t.agent_id, responderA);
    if ("error" in prep) return fallar(prep.error, true);
    const { validacion } = await generarTexto(s, t.agent_id, prep.prompt, "comentario");
    if (!validacion.ok) return fallar(`salida rechazada: ${validacion.motivo}`);
    const { error } = await s.sb.rpc("worker_completar_comentario", {
      p_task_id: t.id, p_post_id: postId, p_agent_email: t.agent_id, p_content: validacion.texto,
    });
    if (error) return fallar(`no se pudo publicar: ${error.message}`, /inexistente/.test(error.message));
    return "completada";
  }

  if (t.action_type === "POST") {
    const esNoticia = t.payload?.tipo === "noticia" || t.payload?.origen === "agent-noticias" || t.payload?.noticia === true;
    if (esNoticia) {
      const url = Deno.env.get("SUPABASE_URL")!;
      const token = await tokenEsperado(s.sb);
      if (!token) return fallar("no hay AGENT_WORKER_TOKEN para conectar agent-noticias", true);
      const r = await fetch(`${url}/functions/v1/agent-noticias`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-worker-token": token },
        body: JSON.stringify({ modo: "publicar", agent_email: t.agent_id, tema: t.payload?.tema ?? null, max_horas: Number(t.payload?.max_horas ?? 96) }),
        signal: AbortSignal.timeout(80_000),
      });
      const raw = await r.text(); let json: Fila = {};
      try { json = JSON.parse(raw); } catch {}
      if (!r.ok || json.ok !== true) return fallar(`agent-noticias: ${String(json.error ?? json.etapa ?? raw.slice(0, 300))}`);
      const { error } = await s.sb.rpc("worker_completar_post", {
        p_task_id: t.id, p_agent_email: t.agent_id, p_content: String(json.salida ?? ""),
        p_image_url: json.imagen?.public_url ?? null, p_image_desc: null, p_metadata: json.metadata ?? null,
      });
      if (error) return fallar(`no se pudo cerrar tarea noticia: ${error.message}`);
      return "completada";
    }
    const prep = await prepararPost(s, t.agent_id, t.payload?.tema ?? null, false);
    if ("error" in prep) return fallar(prep.error, true);
    const { validacion } = await generarTexto(s, t.agent_id, prep.prompt, "post");
    if (!validacion.ok) return fallar(`salida rechazada: ${validacion.motivo}`);
    const enlace = await extractOpenGraph(validacion.texto);
    const metadata = enlace ? { ...enlace, comment: generateLinkComment(enlace) } : null;
    const { error } = await s.sb.rpc("worker_completar_post", {
      p_task_id: t.id, p_agent_email: t.agent_id, p_content: validacion.texto,
      p_image_url: null, p_image_desc: null, p_metadata: metadata,
    });
    if (error) return fallar(`no se pudo publicar: ${error.message}`);
    return "completada";
  }
  return fallar(`action_type no soportado por el worker: ${t.action_type}`, true);
}

const devolver = (sb: SupabaseClient, id: number, segundos = 0) =>
  sb.rpc("worker_devolver_tarea", { p_task_id: id, p_segundos: segundos, p_devolver_intento: true });

// ------------------------------------------------------------------ ciclo principal
async function ciclo(sb: SupabaseClient) {
  const t0 = Date.now();
  const { data: ini, error: eIni } = await sb.rpc("worker_iniciar", { p_lock_seg: 110 });
  if (eIni) throw new Error(`worker_iniciar: ${eIni.message}`);
  if (!ini?.puede) return { estado: "omitido", ...ini };

  try {
    const { data: cupo } = await sb.rpc("worker_cupo");
    const n = ini.en_prueba ? Math.min(1, cupo?.n ?? 0) : (cupo?.n ?? 0); // tras una pausa: UNA llamada de prueba
    if (n <= 0) return { estado: "sin_cupo", cupo };

    const { data: tareas, error: eClaim } = await sb.rpc("claim_agent_tasks", { p_limit: n, p_types: TIPOS_IA });
    if (eClaim) throw new Error(`claim_agent_tasks: ${eClaim.message}`);
    if (!tareas?.length) return { estado: "cola_vacia", cupo };
    const lista = tareas as Fila[];

    const cfg = await cargarConfig(sb);
    const { key, origen } = await claveGemini(sb);
    if (!key) {
      const seg = await sb.rpc("worker_error_api", { p_status: 0, p_espera_seg: null, p_detalle: "credencial: no hay GEMINI_API_KEY (ni en secretos de la funcion ni en el Vault)" });
      for (const t of lista) await devolver(sb, t.id);
      return { estado: "pausa", motivo: "sin clave de Gemini", pausa_seg: seg.data };
    }

    const s: Sesion = {
      sb, key, modelo: String(cfg.modelo ?? "gemini-flash-lite-latest"), modeloImagen: String(cfg.modelo_imagen ?? "gemini-2.5-flash-image"),
      cat: await cargarCatalogo(sb),
      restantes: n, espaciadoMs: Number(cfg.espaciado_segundos ?? 6) * 1000, ultima: 0, llamadas: 0,
    };
    const res = { estado: "ok", cupo, clave: origen, completadas: 0, reintentos: 0, falladas: 0, devueltas: 0, pausa_seg: null as number | null, llamadas: 0 };

    for (let i = 0; i < lista.length; i++) {
      const t = lista[i];
      const devolverResto = async () => { for (const r of lista.slice(i + 1)) { await devolver(sb, r.id); res.devueltas++; } };

      if (Date.now() - t0 > TIEMPO_MAX_MS) { for (const r of lista.slice(i)) { await devolver(sb, r.id); res.devueltas++; } break; }
      try {
        const r = await procesarTarea(s, t);
        if (r === "completada") res.completadas++; else if (r === "fallida") res.falladas++; else res.reintentos++;
      } catch (e) {
        if (e instanceof SinCupo) {                               // se acabo el cupo de esta ejecucion: sigue en la proxima
          await devolver(sb, t.id, 30); res.devueltas++; await devolverResto(); break;
        }
        if (e instanceof GeminiError && e.pausaGlobal) {           // 429 / 503 / sobrecarga: se congela el worker, la cola queda intacta
          const { data: seg } = await sb.rpc("worker_error_api", {
            p_status: e.status, p_espera_seg: e.esperaSeg ? Math.ceil(e.esperaSeg) : null, p_detalle: `${e.tipo}: ${e.message}`,
          });
          res.pausa_seg = seg ?? null; res.estado = "pausa";
          await devolver(sb, t.id); res.devueltas++; await devolverResto(); break;
        }
        const msg = e instanceof Error ? e.message : String(e);   // error de contenido u otro: falla solo esta tarea
        await sb.rpc("worker_fallar_tarea", { p_task_id: t.id, p_error: msg.slice(0, 400), p_definitivo: false });
        res.falladas++;
      }
    }
    res.llamadas = s.llamadas;
    return res;
  } finally {
    await sb.rpc("worker_liberar");
  }
}

// ------------------------------------------------------------------ dry-run y diagnostico
async function dryRun(sb: SupabaseClient, body: Fila) {
  const cfg = await cargarConfig(sb);
  const { key } = await claveGemini(sb);
  if (!key) return { error: "no hay clave de Gemini" };
  if (body.dry_run === "imagen") {
    return await crearImagenPost(sb, {
      key, modelo: String(body.modelo ?? cfg.modelo_imagen ?? "gemini-2.5-flash-image"),
      agenteEmail: String(body.agent_email ?? "prueba"), tema: String(body.tema ?? "cocina"),
      texto: String(body.texto ?? "Hoy probé una receta nueva en casa y quedó mejor de lo que esperaba"), prueba: true,
    });
  }
  const s: Sesion = {
    sb, key, modelo: String(body.modelo ?? cfg.modelo ?? "gemini-flash-lite-latest"), modeloImagen: String(cfg.modelo_imagen ?? "gemini-2.5-flash-image"),
    cat: await cargarCatalogo(sb),
    restantes: 3, espaciadoMs: 0, ultima: 0, llamadas: 0,
  };
  try {
    const prep = body.dry_run === "post"
      ? await prepararPost(s, String(body.agent_email), body.tema ?? null, body.con_imagen === true)
      : await prepararComentario(s, Number(body.post_id), String(body.agent_email), body.responder_a != null ? Number(body.responder_a) : null);
    if ("error" in prep) return { error: prep.error };
    const { r, validacion } = await generarTexto(s, String(body.agent_email), prep.prompt, "prueba");
    return { modelo: s.modelo, prompt: prep.prompt, generado: r.texto, validacion, tokens: { entrada: r.tokensIn, salida: r.tokensOut, pensamiento: r.pensamiento }, finish: r.finish, llamadas: s.llamadas };
  } catch (e) {
    if (e instanceof GeminiError) return { error_gemini: { tipo: e.tipo, status: e.status, mensaje: e.message.slice(0, 300), espera_seg: e.esperaSeg } };
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function diagnostico(sb: SupabaseClient) {
  const { key, origen } = await claveGemini(sb);
  const out: Fila = { clave_gemini: { presente: Boolean(key), origen } };
  const cfg = await cargarConfig(sb);
  out.modelo_configurado = cfg.modelo;
  out.modelo_imagen = cfg.modelo_imagen;
  if (key) {
    try { out.modelos_generateContent = await listarModelos(key); }
    catch (e) { out.error_modelos = e instanceof GeminiError ? { tipo: e.tipo, status: e.status, mensaje: e.message.slice(0, 200) } : String(e); }
  }
  out.estado = (await sb.from("agent_worker_state").select("*").eq("id", 1).single()).data;
  out.cupo = (await sb.rpc("worker_cupo")).data;
  out.cupo_imagen = (await sb.rpc("worker_cupo_imagen")).data;
  const { data: cola } = await sb.from("agent_queue").select("status,action_type");
  const conteo: Fila = {};
  for (const f of (cola ?? []) as Fila[]) conteo[`${f.action_type}:${f.status}`] = (conteo[`${f.action_type}:${f.status}`] ?? 0) + 1;
  out.cola = conteo;
  try { out.personalidades = Object.keys((await cargarCatalogo(sb)).personas).length; } catch (e) { out.error_catalogo = String(e); }
  return out;
}

// ------------------------------------------------------------------ HTTP
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return responder({ error: "usa POST" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const enviado = req.headers.get("x-worker-token") ?? "";
  const esperado = await tokenEsperado(sb);
  if (!esperado || !enviado || !iguales(enviado, esperado)) return responder({ error: "no autorizado" }, 401);

  // deno-lint-ignore no-explicit-any
  const body: Fila = await req.json().catch(() => ({}));
  try {
    if (body.modo === "diagnostico") return responder(await diagnostico(sb));
    if (body.dry_run) return responder(await dryRun(sb, body));
    return responder(await ciclo(sb));
  } catch (e) {
    console.error("agent-worker:", e);
    return responder({ estado: "error", mensaje: e instanceof Error ? e.message : String(e) }, 500);
  }
});
