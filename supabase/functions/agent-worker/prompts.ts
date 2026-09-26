// ByGether - constructor de prompts (puerto a TypeScript de agentes/motor_contextual.py, Paso 3).
// No llama al LLM: solo arma {system, user, meta}. Sin dependencias de Deno, se puede probar con Node.

export interface Estilo { prob_emoji?: number; palabras_max?: number; prob_pregunta?: number }
export interface Persona { nombre: string; descripcion?: string; system_prompt: string; estilo: Estilo }
export interface Catalogo { base: string; personas: Record<string, Persona> }
export interface Agente {
  user_email: string;
  user_name: string;
  persona_id: string;
  // deno-lint-ignore no-explicit-any
  config_cuenta_automatica?: Record<string, any> | null;
}
// deno-lint-ignore no-explicit-any
export type Ctx = Record<string, any>;
export interface Prompt { system: string; user: string; meta: Record<string, unknown> }

const MAX_POST = 700;
const MAX_COMENTARIO = 350;
const MAX_IMG_DESC = 300;

/** Envuelve texto de usuarios en <dato>: sin caracteres de control ni etiquetas <dato> (aunque intenten reconstruirlas). */
export function dato(texto: unknown, max: number): string {
  let t = String(texto ?? "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  const tag = /<\s*\/?\s*dato\s*>/gi;
  let previo: string;
  do { previo = t; t = t.replace(tag, ""); } while (t !== previo); // "<<dato>dato>" no puede rearmar una etiqueta
  t = t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (t.length > max) t = t.slice(0, max).trimEnd() + "…";
  return `<dato>${t}</dato>`;
}

// ---- aleatoriedad reproducible por (cuenta, tarea): un reintento arma el mismo prompt ----
function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) { h ^= c.codePointAt(0)!; h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rngPara(clave: string): () => number {
  let a = hash(clave);
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function maxCaracteres(estilo: Estilo): number {
  const pw = Number(estilo.palabras_max ?? 45);
  return Math.max(140, Math.min(Math.floor(pw * 6.5) + 40, 420));
}

function directivas(estilo: Estilo, rng: () => number): string[] {
  const d: string[] = [];
  if (estilo.palabras_max) d.push(`Usa como máximo ${Math.floor(estilo.palabras_max)} palabras.`);
  d.push(rng() < (estilo.prob_pregunta ?? 0.15) ? "Cierra con una pregunta concreta." : "No termines con una pregunta.");
  d.push(rng() < (estilo.prob_emoji ?? 0.1) ? "Puedes usar un emoji." : "No uses emojis esta vez.");
  return d;
}

function instruccionAcento(cfg: Record<string, any>): string {
  if (cfg.acento === "RD") {
    return "Escribes con la idiosincrasia dominicana natural: usa expresiones y cadencia propias de República Dominicana de forma sutil, sin jergas, sin vulgaridades y sin errores ortográficos. Debe sentirse natural, nunca caricaturesco ni forzado.";
  }
  if (cfg.acento === "latam_mixto") {
    return "Escribes en español latinoamericano natural y neutro. Puedes alternar sutilmente entre registros regionales latinoamericanos (por ejemplo, caribeño, mexicano o rioplatense) sin caricaturizar acentos, sin jergas, sin vulgaridades y sin errores ortográficos.";
  }
  return "";
}

function perfil(agente: Agente): string {
  const cfg = agente.config_cuenta_automatica ?? {};
  const p = [`Te llamas ${agente.user_name || "un usuario"}.`];
  if (cfg.genero_aparente === "F" || cfg.genero_aparente === "M") {
    p.push("Escribes en género " + (cfg.genero_aparente === "F" ? "femenino." : "masculino."));
  }
  if (cfg.edad_aparente) p.push(`Tienes unos ${Math.floor(Number(cfg.edad_aparente))} años.`);
  if (cfg.tema_principal) p.push(`Tu tema favorito es ${cfg.tema_principal}.`);
  if (cfg.bio) p.push(`Tu bio pública: ${dato(cfg.bio, 200)}`);
  const acento = instruccionAcento(cfg);
  if (acento) p.push(acento);
  return p.join(" ");
}

function sistema(cat: Catalogo, persona: Persona, agente: Agente): string {
  return `${cat.base}\n\nTU PERSONALIDAD (${persona.nombre}):\n${persona.system_prompt}\n\nTU PERFIL:\n${perfil(agente)}`;
}

export function personaDe(cat: Catalogo, id: string): Persona {
  const p = cat.personas[id];
  if (!p) throw new Error(`Personalidad desconocida o inactiva: ${id}`);
  return p;
}

/** URL de la imagen a describir (la del post o la del post original si es un repost). */
export function imagenDelPost(ctx: Ctx): string | null {
  return ctx.post?.imagen_url ?? ctx.post?.repost_de?.imagen_url ?? null;
}

/** Prompt para un COMMENT (comentario nuevo o respuesta). `objetivo` = comentario al que se responde, si aplica. */
export function promptComentario(
  ctx: Ctx, agente: Agente, cat: Catalogo,
  opts: { responderA?: number | null; objetivo?: { id: number; autor?: string; contenido?: string } | null } = {},
): Prompt {
  const persona = personaDe(cat, agente.persona_id);
  const post = ctx.post;
  const rng = rngPara(`${agente.user_email}|c|${post.id}|${opts.responderA ?? ""}`);

  const l: string[] = [`PUBLICACIÓN de ${post.autor || "un usuario"}:`];
  if (post.contenido) l.push(dato(post.contenido, MAX_POST));
  if (post.cita) l.push(`Al compartirla añadió: ${dato(post.cita, MAX_COMENTARIO)}`);
  const orig = post.repost_de;
  if (orig) {
    l.push(`Es un repost de una publicación de ${orig.autor || "un usuario"}:`);
    l.push(dato(orig.contenido || "(sin texto)", MAX_POST));
  }
  const tieneImagen = Boolean(post.imagen_url || orig?.imagen_url);
  if (tieneImagen) {
    if (post.imagen_descripcion) {
      l.push(`La publicación incluye una imagen. Descripción de la imagen: ${dato(post.imagen_descripcion, MAX_IMG_DESC)}`);
    } else {
      l.push("La publicación incluye una imagen que no puedes ver: no describas ni inventes su contenido; reacciona solo al texto.");
    }
  }

  const comentarios: Ctx[] = ctx.ultimos_comentarios ?? [];
  if (comentarios.length) {
    l.push("\nÚLTIMOS COMENTARIOS DEL HILO (del más antiguo al más reciente):");
    comentarios.forEach((c, i) => l.push(`${i + 1}. ${c.autor || "Usuario"}: ${dato(c.contenido, MAX_COMENTARIO)}`));
  } else {
    l.push("\nAún no hay comentarios en este hilo.");
  }

  let objetivo = opts.objetivo ?? null;
  if (opts.responderA != null) {
    const enHilo = comentarios.find((c) => c.id === opts.responderA);
    if (enHilo) objetivo = { id: enHilo.id, autor: enHilo.autor, contenido: enHilo.contenido };
  }
  if (objetivo) {
    l.push(`\nTAREA: responde directamente al comentario de ${objetivo.autor || "un usuario"}: ${dato(objetivo.contenido, MAX_COMENTARIO)}`);
  } else {
    l.push("\nTAREA: escribe un comentario nuevo sobre la publicación.");
  }
  l.push("Indicaciones para esta vez: " + directivas(persona.estilo, rng).join(" "));
  l.push("Escribe solo el texto del comentario.");

  return {
    system: sistema(cat, persona, agente),
    user: l.join("\n"),
    meta: {
      tipo: objetivo ? "respuesta" : "comentario",
      post_id: post.id,
      agent_email: agente.user_email,
      persona_id: agente.persona_id,
      responde_a_comentario: objetivo?.id ?? null,
      cadena_automatica: ctx.cadena_automatica ?? 0,
      comentarios_previos_del_agente: ctx.comentarios_previos_del_agente ?? 0,
      tiene_imagen: tieneImagen,
      imagen_descrita: Boolean(post.imagen_descripcion),
      max_caracteres: maxCaracteres(persona.estilo),
    },
  };
}

/** Prompt para un POST original de la cuenta. */
export function promptPublicacion(
  agente: Agente, cat: Catalogo,
  opts: { tema?: string | null; previas?: string[]; conImagen?: boolean } = {},
): Prompt {
  const persona = personaDe(cat, agente.persona_id);
  const tema = opts.tema || agente.config_cuenta_automatica?.tema_principal || "lo que te apasiona";
  const previas = opts.previas ?? [];
  const rng = rngPara(`${agente.user_email}|p|${tema}|${previas.length}|${previas[0] ?? ""}`);

  const l = [`TAREA: escribe una publicación original para tu perfil sobre este tema: ${tema}.`];
  l.push("Comparte una opinión, una vivencia breve o una pregunta para tus contactos; que suene a algo que de verdad te pasó o piensas, no a un anuncio.");
  if (opts.conImagen) l.push("La publicación irá acompañada de una foto cotidiana que tomaste tú, relacionada con el tema. Escribe el texto que la acompaña sin describir la foto como si fuera un catálogo.");
  if (previas.length) {
    l.push("\nTus publicaciones anteriores (no repitas ideas ni fórmulas):");
    previas.slice(0, 3).forEach((p) => l.push("- " + dato(p, MAX_COMENTARIO)));
  }
  l.push("Indicaciones para esta vez: " + directivas(persona.estilo, rng).join(" "));
  l.push("Escribe solo el texto de la publicación.");

  return {
    system: sistema(cat, persona, agente),
    user: l.join("\n"),
    meta: { tipo: "publicacion", agent_email: agente.user_email, persona_id: agente.persona_id, tema,
            con_imagen: Boolean(opts.conImagen), max_caracteres: maxCaracteres(persona.estilo) },
  };
}

export const PROMPT_DESCRIPCION_IMAGEN =
  "Describe de forma objetiva y breve, en español, lo que se ve en esta imagen: sujetos, objetos, lugar y ambiente. " +
  "Máximo 2 frases y 250 caracteres. Sin opiniones, sin adivinar nombres de personas y sin mencionar que es una imagen. " +
  "Responde solo con la descripción.";

// ---------------------------------------------------------------------------------------------
// Validador de salida MINIMO (el Paso 6 lo amplia): evita publicar frases de asistente, texto vacio o desmesurado.
const FRASES_DE_ASISTENTE = [
  /como (un )?modelo de lenguaje/i, /como (un )?asistente (virtual|de ia|de inteligencia)/i, /soy (una?|un) (ia|inteligencia artificial|bot|asistente|modelo)\b/i,
  /\bcomo (una )?ia\b/i, /as an? (ai|language model|assistant)/i, /language model/i,
  /aqu[ií] tienes/i, /claro,? aqu[ií]/i, /espero que esto (te )?(ayude|sirva)/i,
  /excelente pregunta/i, /<\/?\s*dato/i,
];

export function limpiarSalida(bruto: string, maxChars: number): { ok: boolean; texto: string; motivo?: string } {
  let t = String(bruto ?? "").trim();
  t = t.replace(/^```[a-z]*\n?|```$/gi, "").trim();
  t = t.replace(/^(comentario|respuesta|publicaci[oó]n|post|texto)\s*:\s*/i, "");
  t = t.replace(/^["'“”«»]+|["'“”«»]+$/g, "").trim();
  t = t.replace(/\*\*|__/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) return { ok: false, texto: "", motivo: "salida vacia" };
  const frase = FRASES_DE_ASISTENTE.find((r) => r.test(t));
  if (frase) return { ok: false, texto: t, motivo: `frase de asistente (${frase.source})` };
  if (t.length > maxChars * 1.25) {
    // intenta cortar en el ultimo fin de oracion que quepa; si no hay, se rechaza
    const corte = Math.max(t.lastIndexOf(". ", maxChars), t.lastIndexOf("? ", maxChars), t.lastIndexOf("! ", maxChars));
    if (corte < maxChars * 0.4) return { ok: false, texto: t, motivo: `demasiado largo (${t.length} > ${maxChars})` };
    t = t.slice(0, corte + 1).trim();
  }
  return { ok: true, texto: t };
}
