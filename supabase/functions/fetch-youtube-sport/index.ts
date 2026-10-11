import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CUENTA = "Cronus Sport";
const USER_EMAIL = "cronussport@worldigi.app";

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

  if (ultimoPost) {
    const minutosDesdeUltimo = (Date.now() - new Date(ultimoPost.created_at).getTime()) / 60000;
    if (minutosDesdeUltimo < 90) {
      return new Response(JSON.stringify({ publicado: false, razon: "en periodo de espera" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  if (Math.random() > 0.15) {
    return new Response(JSON.stringify({ publicado: false, razon: "no le toco esta vez" }), {
      headers: { "Content-Type": "application/json" },
    });
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

    for (const item of items) {
      const videoId = item.id?.videoId;
      const title = item.snippet?.title;
      const thumb = item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url;
      const link = videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;

      if (!videoId || !title || !link) continue;

      const { error: candadoError } = await supabase
        .from("youtube_published")
        .insert({ cuenta: CUENTA, video_id: videoId });

      if (candadoError) continue;

      const imagen = thumb || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      const contenido = `\ud83c\udfa5 ${title}\n\nCanal: ${fuente.channel_name} \u2014 ${link}`;

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
    JSON.stringify({ publicado, canal: fuente.channel_name, titulo: tituloPublicado }),
    { headers: { "Content-Type": "application/json" } },
  );
});