// ByGether - PASO 7: fotos propias para las publicaciones de las cuentas automaticas.
// Genera la imagen con Gemini (modelo_imagen), la sube al bucket publico posts-images y devuelve su URL.
// Nunca lanza: si algo falla devuelve { imagen: null, motivo } y el worker publica solo el texto.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { decodeBase64 } from "jsr:@std/encoding@1/base64";
import { GeminiError } from "./gemini.ts";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const BUCKET = "posts-images";
const MAX_BYTES = 4_800_000; // el bucket admite 5 MB

export interface ImagenPost { url: string; desc: string }
export interface ResultadoImagen { imagen: ImagenPost | null; motivo?: string; bytes?: number; mime?: string }

export function promptImagen(tema: string, texto: string): string {
  const t = texto.replace(/\s+/g, " ").trim().slice(0, 180);
  return (
    "A realistic amateur smartphone photo showing exactly ONE single centered subject. " +
    `Natural lighting, everyday scene about "${tema}" inspired by: "${t}". ` +
    "Single item, symmetrical, clean real-life perspective. " +
    "STRICT CONSTRAINTS: Only one main object or entity, no extra limbs, no duplicated features, no double handles, " +
    "no two heads, no text, no logos, no watermarks, no collages, no surreal elements, no fantasy."
  );
}

async function pedirImagen(key: string, model: string, prompt: string): Promise<{ mime: string; b64: string }> {
  // deno-lint-ignore no-explicit-any
  const cuerpo = (conAspecto: boolean): any => ({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { 
      responseModalities: ["IMAGE"], 
      // FUERZA RESOLUCIÓN CUADRADA NATIVA (1:1) PARA ELIMINAR DUPLICACIONES
      ...(conAspecto ? { imageConfig: { aspectRatio: "1:1" } } : {}) 
    },
  });

  const enviar = async (conAspecto: boolean) => {
    let res: Response;
    try {
      res = await fetch(`${BASE}/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(cuerpo(conAspecto)),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      throw new GeminiError("sobrecarga", 0, `red/timeout: ${e instanceof Error ? e.message : e}`);
    }
    const crudo = await res.text();
    // deno-lint-ignore no-explicit-any
    let json: any = {};
    try { json = JSON.parse(crudo); } catch { /* respuesta no JSON */ }
    return { res, json, crudo };
  };

  let { res, json, crudo } = await enviar(true);
  if (res.status === 400 && /imageConfig|aspect/i.test(String(json?.error?.message ?? crudo))) ({ res, json, crudo } = await enviar(false));

  if (!res.ok) {
    const msg: string = String(json?.error?.message ?? crudo.slice(0, 300));
    if (res.status === 429) throw new GeminiError("cuota", 429, msg);
    if ([500, 502, 503, 504].includes(res.status)) throw new GeminiError("sobrecarga", res.status, msg);
    if ([401, 403, 404].includes(res.status)) throw new GeminiError("credencial", res.status, msg);
    throw new GeminiError("otro", res.status, msg);
  }
  if (json?.promptFeedback?.blockReason) throw new GeminiError("bloqueo", 200, `prompt bloqueado: ${json.promptFeedback.blockReason}`);
  const cand = json?.candidates?.[0];
  // deno-lint-ignore no-explicit-any
  const parte = (cand?.content?.parts ?? []).find((p: any) => (p.inlineData ?? p.inline_data)?.data);
  const dato = parte?.inlineData ?? parte?.inline_data;
  if (!dato?.data) throw new GeminiError("bloqueo", 200, `sin imagen en la respuesta (finishReason=${cand?.finishReason ?? "?"})`);
  return { mime: String(dato.mimeType ?? dato.mime_type ?? "image/png"), b64: String(dato.data) };
}

export async function crearImagenPost(
  sb: SupabaseClient,
  o: { key: string; modelo: string; agenteEmail: string; tema: string; texto: string; prueba?: boolean },
): Promise<ResultadoImagen> {
  const { data: cupo } = await sb.rpc("worker_cupo_imagen");
  if (!o.prueba && !cupo?.ok) return { imagen: null, motivo: "sin cupo de imagenes" };

  const { data: fila } = await sb.from("agent_llm_calls").insert({ agent_id: o.agenteEmail, tipo: "imagen", modelo: o.modelo }).select("id").single();
  const t0 = Date.now();
  // deno-lint-ignore no-explicit-any
  const cerrar = async (campos: Record<string, any>) => {
    if (fila?.id) await sb.from("agent_llm_calls").update({ ...campos, ms: Date.now() - t0 }).eq("id", fila.id);
  };

  try {
    const img = await pedirImagen(o.key, o.modelo, promptImagen(o.tema, o.texto));
    const bytes = decodeBase64(img.b64);
    await cerrar({ status: 200, ok: true });
    if (bytes.length > MAX_BYTES) return { imagen: null, motivo: `imagen demasiado grande (${bytes.length} bytes)` };

    const ext = /jpe?g/i.test(img.mime) ? "jpg" : /webp/i.test(img.mime) ? "webp" : "png";
    const carpeta = o.prueba ? "_pruebas" : (o.agenteEmail.split("@")[0].replace(/[^a-z0-9._-]/gi, "") || "cuenta");
    const ruta = `${carpeta}/auto-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(ruta, bytes, { contentType: img.mime, upsert: false });
    if (error) return { imagen: null, motivo: `storage: ${error.message}` };
    const url = sb.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl;
    return {
      imagen: { url, desc: `Foto casual tomada con un celular, relacionada con ${o.tema}.` },
      bytes: bytes.length, mime: img.mime,
    };
  } catch (e) {
    if (e instanceof GeminiError) {
      await cerrar({ status: e.status, ok: false, error: e.message.slice(0, 300) });
      return { imagen: null, motivo: `${e.tipo} ${e.status}: ${e.message.slice(0, 160)}` };
    }
    const msg = e instanceof Error ? e.message : String(e);
    await cerrar({ ok: false, error: msg.slice(0, 300) });
    return { imagen: null, motivo: msg.slice(0, 160) };
  }
}
