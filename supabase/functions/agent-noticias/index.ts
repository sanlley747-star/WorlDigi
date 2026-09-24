// ByGether - PASO 12 / bloque 3: agent-noticias (parte 1).
// Busca una noticia real (feed RSS + OG con foto) para una cuenta automatica CON NOMBRE DE PERSONA.
// Solo prueba en seco: no publica ni escribe nada. Nunca toca cuentas canal (Athlem Sport, Cronus Sport, VibeSee, Alex Deportes).
//
// Autenticacion: igual que agent-worker, encabezado x-worker-token = secreto AGENT_WORKER_TOKEN del Vault (verify_jwt desactivado).
// Solicitudes (todas requieren el token):
//   {"modo":"diagnostico"}                                        fuentes activas por tema y cuentas-persona disponibles
//   {"dry_run":"noticia","agent_email":"...","max_horas":96}      busca una noticia para el tema de esa cuenta
//   {"dry_run":"noticia","tema":"cocina"}                         idem, indicando el tema a mano
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { buscarNoticia } from "./noticias.ts";

const responder = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
// deno-lint-ignore no-explicit-any
type Fila = Record<string, any>;

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

/** Solo cuentas automaticas con nombre de persona (correo @sim.bygether.invalid y persona_id). Las cuentas canal no pasan este filtro. */
async function agentePersona(sb: SupabaseClient, email: string): Promise<Fila | null> {
  const { data } = await sb.from("profiles").select("user_email,user_name,persona_id,config_cuenta_automatica")
    .eq("user_email", email).eq("is_cuenta_automatica", true).like("user_email", "%@sim.bygether.invalid").not("persona_id", "is", null).maybeSingle();
  return data ?? null;
}

async function diagnostico(sb: SupabaseClient) {
  const { data: f } = await sb.from("fuentes_noticias").select("tema,activa");
  const porTema: Fila = {};
  for (const r of (f ?? []) as Fila[]) if (r.activa) porTema[r.tema] = (porTema[r.tema] ?? 0) + 1;
  const { count } = await sb.from("profiles").select("user_email", { count: "exact", head: true })
    .eq("is_cuenta_automatica", true).like("user_email", "%@sim.bygether.invalid").not("persona_id", "is", null);
  const { count: usadas } = await sb.from("noticias_usadas").select("id", { count: "exact", head: true });
  return { version: "bloque-3 (solo dry_run)", fuentes_activas_por_tema: porTema, cuentas_persona: count, noticias_usadas: usadas };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return responder({ error: "usa POST" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const enviado = req.headers.get("x-worker-token") ?? "";
  const esperado = await tokenEsperado(sb);
  if (!esperado || !enviado || !iguales(enviado, esperado)) return responder({ error: "no autorizado" }, 401);

  const body: Fila = await req.json().catch(() => ({}));
  try {
    if (body.modo === "diagnostico") return responder(await diagnostico(sb));
    if (body.dry_run === "noticia") {
      let tema: string | null = body.tema ? String(body.tema) : null;
      let email: string | null = null;
      if (body.agent_email) {
        const ag = await agentePersona(sb, String(body.agent_email));
        if (!ag) return responder({ error: "cuenta inexistente o no es una cuenta automatica con nombre de persona" }, 400);
        email = ag.user_email;
        tema = tema ?? ag.config_cuenta_automatica?.tema_principal ?? null;
      }
      if (!tema) return responder({ error: "indica agent_email o tema" }, 400);
      return responder(await buscarNoticia(sb, { tema, agentEmail: email, maxHoras: body.max_horas ? Number(body.max_horas) : undefined }));
    }
    return responder({ error: "en esta version solo existen modo=diagnostico y dry_run=noticia" }, 400);
  } catch (e) {
    console.error("agent-noticias:", e);
    return responder({ estado: "error", mensaje: e instanceof Error ? e.message : String(e) }, 500);
  }
});
