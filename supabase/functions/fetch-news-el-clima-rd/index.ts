import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CUENTA = "El Clima RD";
const USER_EMAIL = "elclimard@worldigi.app";
const headers = {
  "User-Agent": "Mozilla/5.0 (compatible; ByGether-ClimateBot/1.0)",
  "Accept": "application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
};

function clean(v: string | null): string | null {
  if (!v) return null;
  return v.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").trim();
}

function htmlToText(v: string | null): string {
  if (!v) return "";
  return v.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ").trim();
}

function meta(html: string, key: string): string | null {
  const sq = String.fromCharCode(39);
  const dq = String.fromCharCode(34);
  const c = "[^" + dq + sq + "]+";
  const r1 = new RegExp("<meta[^>]*(?:property|name)=" + dq + key + dq + "[^>]*content=" + dq + "(" + c + ")" + dq + "[^>]*>", "i");
  const r2 = new RegExp("<meta[^>]*content=" + dq + "(" + c + ")" + dq + "[^>]*(?:property|name)=" + dq + key + dq + "[^>]*>", "i");
  const r3 = new RegExp("<meta[^>]*(?:property|name)=" + sq + key + sq + "[^>]*content=" + sq + "(" + c + ")" + sq + "[^>]*>", "i");
  const r4 = new RegExp("<meta[^>]*content=" + sq + "(" + c + ")" + sq + "[^>]*(?:property|name)=" + sq + key + sq + "[^>]*>", "i");
  return clean(html.match(r1)?.[1] ?? html.match(r2)?.[1] ?? html.match(r3)?.[1] ?? html.match(r4)?.[1] ?? null);
}

function hashText(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function extractRss(xml: string) {
  const items = [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)].map(m => m[0]);
  return items.map(item => {
    const link = clean(item.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? null);
    const title = clean(item.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null);
    const desc = clean(item.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1] ?? null);
    const media = item.match(/<media:content[^>]*url=["']([^"']+)["']/i)?.[1] ?? null;
    const enclosure = item.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*>/i)?.[1] ?? null;
    return { link, title, desc, image: media || enclosure };
  }).filter(x => x.link && x.title);
}

async function fetchPage(url: string) {
  const r = await fetch(url, { headers, redirect: "follow" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.text();
}

async function imageFromPage(url: string): Promise<string | null> {
  try { return meta(await fetchPage(url), "og:image"); } catch { return null; }
}

Deno.serve(async (_req: Request) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: fuentes, error: fuentesError } = await supabase
    .from("news_sources").select("*").eq("cuenta", CUENTA).eq("activo", true)
    .order("last_checked", { ascending: true, nullsFirst: true });

  if (fuentesError || !fuentes?.length) {
    return new Response(JSON.stringify({publicado:false,razon:"sin fuentes activas",error:fuentesError?.message ?? null}), {headers:{"Content-Type":"application/json"}});
  }

  const candidatos: any[] = [];

  for (const fuente of fuentes) {
    try {
      const body = await fetchPage(fuente.feed_url);
      const isRSS = /<item[\s>]/i.test(body) || /<rss[\s>]/i.test(body) || /<feed[\s>]/i.test(body);

      if (isRSS) {
        for (const item of extractRss(body)) {
          const {data: existente} = await supabase.from("news_published").select("id")
            .eq("cuenta",CUENTA).eq("article_url",item.link).limit(1).maybeSingle();
          if (existente) continue;

          const imagen = item.image || await imageFromPage(item.link!);
          const descripcion = htmlToText(item.desc).slice(0,900);
          candidatos.push({
            fuente,titulo:item.title,enlace:item.link,imagen,lockUrl:item.link,
            contenido:"🌀 " + item.title + "\n\n" + (descripcion ? descripcion + "\n\n" : "") + "Fuente: " + fuente.nombre + " — " + item.link,
            prioridad:/NHC|NOAA/i.test(fuente.nombre) ? 100 : 60
          });
        }
      } else {
        const title = meta(body,"og:title") || "Actualización meteorológica";
        const desc = meta(body,"og:description") || "";
        const image = meta(body,"og:image");
        if (!desc && !image) continue;

        const fingerprint = hashText(title + "|" + desc + "|" + image);
        const lockUrl = fuente.feed_url + "#bg-" + fingerprint;
        const {data:existente} = await supabase.from("news_published").select("id")
          .eq("cuenta",CUENTA).eq("article_url",lockUrl).limit(1).maybeSingle();
        if (existente) continue;

        candidatos.push({
          fuente,titulo:title,enlace:fuente.feed_url,imagen:image,lockUrl,
          contenido:"🌦️ " + title + "\n\n" + htmlToText(desc) + "\n\nFuente: " + fuente.nombre + " — " + fuente.feed_url,
          prioridad:/INDOMET/i.test(fuente.nombre) ? 90 : 40
        });
      }
    } catch (e) {
      console.error("Fuente " + fuente.nombre + ": " + String(e));
    }
  }

  candidatos.sort((a,b) => b.prioridad - a.prioridad);
  if (!candidatos.length) {
    await supabase.from("news_sources").update({last_checked:new Date().toISOString()}).eq("cuenta",CUENTA).eq("activo",true);
    return new Response(JSON.stringify({publicado:false,razon:"sin contenido nuevo"}), {headers:{"Content-Type":"application/json"}});
  }

  const elegido = candidatos[0];
  const {data:post,error:postError} = await supabase.from("posts").insert({
    user_name:CUENTA,user_email:USER_EMAIL,content:elegido.contenido,image_url:elegido.imagen
  }).select("id").single();

  if (postError) return new Response(JSON.stringify({publicado:false,error:postError.message}), {headers:{"Content-Type":"application/json"}});

  const {error:lockError} = await supabase.from("news_published").insert({cuenta:CUENTA,article_url:elegido.lockUrl});
  if (lockError) {
    await supabase.from("posts").delete().eq("id",post.id);
    return new Response(JSON.stringify({publicado:false,error:lockError.message}), {headers:{"Content-Type":"application/json"}});
  }

  await supabase.from("news_sources").update({last_checked:new Date().toISOString()}).eq("id",elegido.fuente.id);

  return new Response(JSON.stringify({
    publicado:true,cuenta:CUENTA,fuente:elegido.fuente.nombre,titulo:elegido.titulo,
    imagen:elegido.imagen,enlace:elegido.enlace,post_id:post.id
  }), {headers:{"Content-Type":"application/json"}});
});
