import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Configuración de World News 24/7: valores fáciles de ajustar.
const CUENTA = "World News 24/7";
const USER_EMAIL = "worldnews247@worldigi.app";
const HORARIO_INICIO_RD = 7;
const HORARIO_FIN_RD = 22;
const PROBABILIDAD_PUBLICACION = 0.15;
const ESPERA_MINUTOS = 90;
const MAX_VIDEOS_POR_EJECUCION = 1;

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);
  const force = new URL(req.url).searchParams.get("force") === "1";

  // force=1 omite exclusivamente horario, probabilidad y espera.
  // La deduplicación de youtube_published permanece siempre activa.
  if (!force) {
    const horaRD = (new Date().getUTCHours() - 4 + 24) % 24;
    if (horaRD < HORARIO_INICIO_RD || horaRD > HORARIO_FIN_RD) {
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

    if (ultimoPost) {
      const minutosDesdeUltimo = (Date.now() - new Date(ultimoPost.created_at).getTime()) / 60000;
      if (minutosDesdeUltimo < ESPERA_MINUTOS) {
        return new Response(JSON.stringify({ publicado: false, razon: "en periodo de espera" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (Math.random() > PROBABILIDAD_PUBLICACION) {
      return new Response(JSON.stringify({ publicado: false, razon: "no le toco esta vez" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const { data: fuentes, error: fuentesError } = await supabase
    .from("youtube_sources")
    .select("*")
    .eq("cuenta", CUENTA)
    .eq("activo", true)
    .order("last_checked", { ascending: true, nullsFirst: true })
    .limit(1);

  if (fuentesError || !fuentes || fuentes.length === 0) {
    return new Response(JSON.stringify({ publicado: false, razon: "sin canales activos" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const fuente = fuentes[0];
  let publicado = false;
  let tituloPublicado: string | null = null;

  try {
    const { data: apiKey, error: secretError } = await supabase.rpc("get_app_secret", {
      secret_name: "youtube_api_key",
    });

    if (secretError || !apiKey) {
      return new Response(JSON.stringify({ publicado: false, razon: "no se pudo leer la api key" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const searchUrl = `https://www.googleapis.com/youtube/v3/search?key=${apiKey}&channelId=${fuente.channel_id}&part=snippet,id&order=date&maxResults=5&type=video`;
    const res = await fetch(searchUrl);
    const json = await res.json();

    if (!res.ok) {
      return new Response(JSON.stringify({ publicado: false, razon: "error api youtube", detalle: json }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const items = json.items || [];
    let videosConsiderados = 0;

    for (const item of items) {
      if (videosConsiderados >= MAX_VIDEOS_POR_EJECUCION) break;
      const videoId = item.id?.videoId;
      const title = item.snippet?.title;
      const thumb = item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url;
      const link = videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;

      if (!videoId || !title || !link) continue;

      // La deduplicación se aplica también con force=1.
      const { error: candadoError } = await supabase
        .from("youtube_published")
        .insert({ cuenta: CUENTA, video_id: videoId });

      if (candadoError) continue;

      videosConsiderados++;
      const imagen = thumb || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      const contenido = `🎥 ${title}\n\nCanal: ${fuente.channel_name} — ${link}`;

      const { error: insertError } = await supabase.from("posts").insert({
        user_name: CUENTA,
        user_email: USER_EMAIL,
        content: contenido,
        image_url: imagen,
      });

      if (!insertError) {
        publicado = true;
        tituloPublicado = title;
      }

      break;
    }
  } catch (e) {
    return new Response(JSON.stringify({ publicado: false, error: String(e) }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  await supabase
    .from("youtube_sources")
    .update({ last_checked: new Date().toISOString() })
    .eq("id", fuente.id);

  return new Response(
    JSON.stringify({ publicado, canal: fuente.channel_name, titulo: tituloPublicado, force }),
    { headers: { "Content-Type": "application/json" } },
  );
});