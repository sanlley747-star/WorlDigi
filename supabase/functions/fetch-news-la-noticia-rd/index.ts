import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CUENTA = "La Noticia RD";
const USER_EMAIL = "lanoticiard@worldigi.app";

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const horaRD = (new Date().getUTCHours() - 4 + 24) % 24;
  if (horaRD < 7 || horaRD > 22) {
    return new Response(JSON.stringify({ publicado: false, razon: "fuera de horario activo" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: ultimoPost } = await supabase
    .from("posts")
    .select("created_at")
    .eq("user_name", CUENTA)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const forzarManual = new URL(_req.url).searchParams.get("force") === "1";
  if (ultimoPost && !forzarManual) {
    const minutosDesdeUltimo = (Date.now() - new Date(ultimoPost.created_at).getTime()) / 60000;
    if (minutosDesdeUltimo < 90) {
      return new Response(JSON.stringify({ publicado: false, razon: "en periodo de espera" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  if (!forzarManual && Math.random() > 0.15) {
    return new Response(JSON.stringify({ publicado: false, razon: "no le toco esta vez" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: fuentes, error: fuentesError } = await supabase
    .from("news_sources")
    .select("*")
    .eq("cuenta", CUENTA)
    .eq("activo", true)
    .order("last_checked", { ascending: true, nullsFirst: true })
    .limit(1);

  if (fuentesError || !fuentes || fuentes.length === 0) {
    return new Response(JSON.stringify({ publicado: false, razon: "sin fuentes activas" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const fuente = fuentes[0];
  let publicado = false;
  let tituloPublicado: string | null = null;
  let imagenPublicada: string | null = null;
  let enlacePublicado: string | null = null;

  try {
    const res = await fetch(fuente.feed_url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ByGetherBot/1.0)" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
    const xml = await res.text();
    const items = [...xml.matchAll(/<item[\s\S]*?<\/item>/g)].map((m) => m[0]);

    for (const item of items) {
      const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
      const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
      const link = linkMatch ? linkMatch[1].trim() : null;
      const title = titleMatch ? titleMatch[1].trim() : null;

      if (!link || !title) continue;

      const { data: existente } = await supabase
        .from("news_published")
        .select("id")
        .eq("cuenta", CUENTA)
        .eq("article_url", link)
        .limit(1)
        .maybeSingle();

      if (existente) continue;

      let imagen: string | null = null;
      const mediaMatch = item.match(/<media:content[^>]*url=["']([^"']+)["']/i);
      const enclosureMatch = item.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*type=["']image[^"']*["']/i);
      if (mediaMatch) imagen = mediaMatch[1];
      else if (enclosureMatch) imagen = enclosureMatch[1];

      if (!imagen) {
        try {
          const artRes = await fetch(link, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; ByGetherBot/1.0)" },
            redirect: "follow",
          });
          const artHtml = await artRes.text();
          const ogMatch =
            artHtml.match(/<meta[^>]*(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
            artHtml.match(/<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image["']/i);
          if (ogMatch) imagen = ogMatch[1];
        } catch (_e) {
          imagen = null;
        }
      }

      const contenido = `📰 ${title}\n\nFuente: ${fuente.nombre} — ${link}`;

      const { error: insertError } = await supabase.from("posts").insert({
        user_name: CUENTA,
        user_email: USER_EMAIL,
        content: contenido,
        image_url: imagen,
      });

      if (!insertError) {
        const { error: lockError } = await supabase
          .from("news_published")
          .insert({ cuenta: CUENTA, article_url: link });

        if (!lockError) {
          publicado = true;
          tituloPublicado = title;
          imagenPublicada = imagen;
          enlacePublicado = link;
        } else {
          await supabase
            .from("posts")
            .delete()
            .eq("user_name", CUENTA)
            .eq("user_email", USER_EMAIL)
            .eq("content", contenido);
        }
      }

      if (publicado) break;
    }
  } catch (e) {
    return new Response(JSON.stringify({ publicado: false, fuente: fuente.nombre, error: String(e) }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  await supabase
    .from("news_sources")
    .update({ last_checked: new Date().toISOString() })
    .eq("id", fuente.id);

  return new Response(
    JSON.stringify({
      publicado,
      cuenta: CUENTA,
      fuente: fuente.nombre,
      titulo: tituloPublicado,
      imagen: imagenPublicada,
      enlace: enlacePublicado,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
