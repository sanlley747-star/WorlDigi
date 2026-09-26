-- ByGether — Canal La Noticia RD: cron del mismo motor de cuentas canal existentes.
select cron.schedule(
  'publicar_la_noticia_rd_noticias',
  '1,16,31,46 * * * *',
  $job$
  select net.http_post(
    url := 'https://aiymadawznadvavzspxj.supabase.co/functions/v1/fetch-news-la-noticia-rd',
    headers := jsonb_build_object(
      'Authorization', 'Bearer sb_publishable_fL7vTXJ4NLhC2CJs9nPVAg_fvzWbfCY',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $job$
);
