-- ByGether — Bloque 1: Fuentes dominicanas 70/30
-- Datos únicamente: public.fuentes_noticias
-- No modifica Edge Functions.
-- Estado aplicado en Supabase: 36 activas = 25 RD + 11 internacionales.

BEGIN;

INSERT INTO public.fuentes_noticias (tema,nombre,sitio_url,feed_url,activa)
SELECT v.tema,v.nombre,v.sitio_url,v.feed_url,v.activa
FROM (VALUES
('viajes','Diario Libre - Economía','https://www.diariolibre.com','https://www.diariolibre.com/rss/economia.xml',true),
('ciencia','Diario Libre - Planeta','https://www.diariolibre.com','https://www.diariolibre.com/rss/planeta.xml',true),
('moda','Diario Libre - Revista','https://www.diariolibre.com','https://www.diariolibre.com/rss/revista.xml',true),
('actualidad','Radio República - Actualidad','https://www.radiorepublica.do','https://www.radiorepublica.do/rss/actualidad/',true),
('actualidad','Remolacha.net','https://remolacha.net','https://remolacha.net/feed/',true),
('tecnología','Remolacha - Tecnología','https://remolacha.net','https://remolacha.net/category/tecnologia/feed/',true),
('deportes','Remolacha - Deportes','https://remolacha.net','https://remolacha.net/category/deportes/feed/',true),
('salud y bienestar','Remolacha - Salud y Bienestar','https://remolacha.net','https://remolacha.net/category/salud/feed/',true),
('cine y series','Remolacha - Espectáculos','https://remolacha.net','https://remolacha.net/category/espectaculos/feed/',true),
('automóviles','Remolacha - Carros','https://remolacha.net','https://remolacha.net/category/carros/feed/',true),
('actualidad','GenteTuya.com','https://gentetuya.com','https://www.gentetuya.com/feed',true),
('actualidad','AlMomento.net','https://almomento.net','https://almomento.net/feed/',true),
('arte y fotografía','AlMomento.net - Variedades','https://almomento.net','https://almomento.net/categoria/variedades/feed',true),
('deportes','AlMomento.net - Deportes','https://almomento.net','https://almomento.net/categoria/deportes/feed',true),
('salud y bienestar','AlMomento.net - Salud','https://almomento.net','https://almomento.net/categoria/salud/feed',true),
('tecnología','AlMomento.net - Ciencia y Tecnología','https://almomento.net','https://almomento.net/categoria/ciencia-y-tecnologia/feed',true),
('educación','El Nuevo Diario','https://elnuevodiario.com.do','https://elnuevodiario.com.do/feed/',true),
('tecnología','El Nuevo Diario - Tecnología','https://elnuevodiario.com.do','https://elnuevodiario.com.do/category/tecnologia/feed/',true),
('actualidad','El Día','https://eldia.com.do','https://eldia.com.do/feed/',true),
('deportes','N Digital - Deportes','https://n.com.do','https://n.com.do/category/deportes/feed/',true),
('actualidad','Noticias SIN','https://noticiassin.com','https://noticiassin.com/feed/',true)
) AS v(tema,nombre,sitio_url,feed_url,activa)
WHERE NOT EXISTS (SELECT 1 FROM public.fuentes_noticias f WHERE f.feed_url=v.feed_url);

-- El mismo RSS de Diario Libre Economía cubre dos temas definidos en el plan.
INSERT INTO public.fuentes_noticias (tema,nombre,sitio_url,feed_url,activa)
SELECT 'finanzas personales','Diario Libre - Economía (Finanzas personales)','https://www.diariolibre.com','https://www.diariolibre.com/rss/economia.xml',true
WHERE NOT EXISTS (
  SELECT 1 FROM public.fuentes_noticias
  WHERE tema='finanzas personales' AND sitio_url='https://www.diariolibre.com'
);

-- Conservar las 36 fuentes objetivo y desactivar el exceso internacional sin borrar histórico.
UPDATE public.fuentes_noticias
SET activa=false
WHERE activa=true AND feed_url IS NOT NULL
AND feed_url NOT IN (
'https://www.diariolibre.com/rss/portada.xml','https://www.eldinero.com.do/feed/','https://www.diariolibre.com/rss/deportes.xml',
'https://www.diariolibre.com/rss/economia.xml','https://www.diariolibre.com/rss/planeta.xml','https://www.diariolibre.com/rss/revista.xml',
'https://www.radiorepublica.do/rss/actualidad/','https://remolacha.net/feed/','https://remolacha.net/category/tecnologia/feed/','https://remolacha.net/category/deportes/feed/',
'https://remolacha.net/category/salud/feed/','https://remolacha.net/category/espectaculos/feed/','https://remolacha.net/category/carros/feed/','https://www.gentetuya.com/feed',
'https://almomento.net/feed/','https://almomento.net/categoria/variedades/feed','https://almomento.net/categoria/deportes/feed','https://almomento.net/categoria/salud/feed',
'https://almomento.net/categoria/ciencia-y-tecnologia/feed','https://elnuevodiario.com.do/feed/','https://elnuevodiario.com.do/category/tecnologia/feed/','https://eldia.com.do/feed/',
'https://n.com.do/category/deportes/feed/','https://noticiassin.com/feed/',
'https://www.directoalpaladar.com/index.xml','https://www.indiehoy.com/feed/','https://www.vogue.es/feed/rss','https://www.hosteltur.com/rss',
'https://www.espinof.com/index.xml','https://www.vidaextra.com/index.xml','https://www.emprendedores.es/feed/','https://www.zendalibros.com/feed/',
'https://www.xatakafoto.com/index.xml','https://www.motorpasion.com/index.xml','https://www.animalesmascotas.com/feed'
);

COMMIT;
