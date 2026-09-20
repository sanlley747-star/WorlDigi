// ByGether - cliente minimo de Gemini (Google AI Studio) para el worker.
// Clasifica los errores para que el orquestador decida: pausar (cuota / sobrecarga / credencial)
// o fallar solo la tarea (bloqueo de contenido, salida vacia, peticion invalida).

export type TipoError =
  | "cuota"       // 429: limite de tasa o de cuota  -> PAUSA global con backoff
  | "sobrecarga"  // 500/502/503/504 o error de red   -> PAUSA global con backoff
  | "credencial"  // 401/403/404 (clave o modelo mal)  -> PAUSA global (no sirve reintentar rapido)
  | "bloqueo"     // filtro de seguridad / salida vacia -> falla la TAREA
  | "otro";       // 400 por el contenido de la peticion -> falla la TAREA

export class GeminiError extends Error {
  constructor(public tipo: TipoError, public status: number, message: string, public esperaSeg?: number) {
    super(message);
  }
  /** Los errores de la API pausan a todo el worker; los de contenido solo afectan a la tarea. */
  get pausaGlobal(): boolean { return this.tipo === "cuota" || this.tipo === "sobrecarga" || this.tipo === "credencial"; }
}

export interface Imagen { mime: string; b64: string }
export interface Resultado { texto: string; status: number; tokensIn?: number; tokensOut?: number; finish?: string; pensamiento?: number }

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export async function generar(o: {
  key: string; model: string; system?: string; user: string; imagen?: Imagen | null;
  maxTokens?: number; temperature?: number;
}): Promise<Resultado> {
  // deno-lint-ignore no-explicit-any
  const partes: any[] = [];
  if (o.imagen) partes.push({ inline_data: { mime_type: o.imagen.mime, data: o.imagen.b64 } });
  partes.push({ text: o.user });

  // deno-lint-ignore no-explicit-any
  const body: any = {
    contents: [{ role: "user", parts: partes }],
    generationConfig: { temperature: o.temperature ?? 0.9, topP: 0.95, maxOutputTokens: o.maxTokens ?? 400 },
  };
  if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };
  if (/2\.5/.test(o.model)) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };

  let res: Response;
  try {
    res = await fetch(`${BASE}/models/${o.model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": o.key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(40_000),
    });
  } catch (e) {
    throw new GeminiError("sobrecarga", 0, `red/timeout: ${e instanceof Error ? e.message : e}`);
  }

  const crudo = await res.text();
  // deno-lint-ignore no-explicit-any
  let json: any = {};
  try { json = JSON.parse(crudo); } catch { /* respuesta no JSON */ }

  if (!res.ok) {
    const msg: string = String(json?.error?.message ?? crudo.slice(0, 300));
    let espera = Number(res.headers.get("retry-after")) || undefined;           // encabezado HTTP
    // deno-lint-ignore no-explicit-any
    const info = (json?.error?.details ?? []).find((d: any) => String(d["@type"]).includes("RetryInfo")); // retryDelay: "30s"
    if (info?.retryDelay) espera = Math.max(espera ?? 0, parseFloat(String(info.retryDelay)) || 0);
    if (res.status === 429) throw new GeminiError("cuota", 429, msg, espera);
    if ([500, 502, 503, 504].includes(res.status)) throw new GeminiError("sobrecarga", res.status, msg, espera);
    if ([401, 403, 404].includes(res.status) || /api key|api_key|not found|is not supported/i.test(msg)) {
      throw new GeminiError("credencial", res.status, msg);
    }
    throw new GeminiError("otro", res.status, msg);
  }

  if (json?.promptFeedback?.blockReason) {
    throw new GeminiError("bloqueo", 200, `prompt bloqueado: ${json.promptFeedback.blockReason}`);
  }
  const cand = json?.candidates?.[0];
  const texto = String(
    // deno-lint-ignore no-explicit-any
    (cand?.content?.parts ?? []).filter((p: any) => !p.thought && typeof p.text === "string").map((p: any) => p.text).join(""),
  ).trim();
  if (!texto) throw new GeminiError("bloqueo", 200, `respuesta vacia (finishReason=${cand?.finishReason ?? "?"})`);

  return {
    texto, status: res.status, finish: cand?.finishReason,
    tokensIn: json?.usageMetadata?.promptTokenCount, tokensOut: json?.usageMetadata?.candidatesTokenCount,
    pensamiento: json?.usageMetadata?.thoughtsTokenCount,
  };
}

/** Modelos que la clave puede usar con generateContent (solo nombres). */
export async function listarModelos(key: string): Promise<string[]> {
  const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new GeminiError("credencial", res.status, (await res.text()).slice(0, 200));
  const j = await res.json();
  // deno-lint-ignore no-explicit-any
  return (j.models ?? []).filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    // deno-lint-ignore no-explicit-any
    .map((m: any) => String(m.name).replace(/^models\//, ""));
}
