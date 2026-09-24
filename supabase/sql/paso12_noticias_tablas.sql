-- ByGether - PASO 12 / bloque 1: base de datos para que las cuentas automaticas con nombre de persona
-- publiquen noticias reales (texto + enlace + foto) en lugar de imagenes generadas.
-- Las cuentas canal (Athlem Sport, Cronus Sport, VibeSee, Alex Deportes) NO usan estas tablas.

-- 1) Fuentes por tema (el tema coincide con profiles.config_cuenta_automatica->>'tema_principal')
create table if not exists public.fuentes_noticias (
  id bigserial primary key,
  tema text not null,
  nombre text not null,
  sitio_url text not null,
  feed_url text,
  activa boolean not null default true,
  fallos_seguidos integer not null default 0,
  ultimo_ok_at timestamptz,
  ultimo_error text,
  created_at timestamptz not null default now(),
  unique (tema, sitio_url)
);
create index if not exists fuentes_noticias_tema_idx on public.fuentes_noticias (tema) where activa;

-- 2) Noticias ya publicadas por las cuentas (evita repetir la misma noticia)
create table if not exists public.noticias_usadas (
  id bigserial primary key,
  url_normalizada text not null unique,
  fuente_id bigint references public.fuentes_noticias(id) on delete set null,
  agent_email text,
  post_id bigint,
  titulo text,
  created_at timestamptz not null default now()
);
create index if not exists noticias_usadas_agente_idx on public.noticias_usadas (agent_email, created_at desc);

-- 3) Solo el servidor (service_role) las usa: RLS activo sin politicas y sin permisos para anon/authenticated
alter table public.fuentes_noticias enable row level security;
alter table public.noticias_usadas enable row level security;
revoke all on public.fuentes_noticias from anon, authenticated;
revoke all on public.noticias_usadas from anon, authenticated;
revoke all on sequence public.fuentes_noticias_id_seq from anon, authenticated;
revoke all on sequence public.noticias_usadas_id_seq from anon, authenticated;

-- 4) Arreglo: worker_completar_post tenia dos versiones (5 y 6 argumentos) y PostgREST fallaba con
--    "Could not choose the best candidate function". La de 6 argumentos (con p_metadata DEFAULT NULL) cubre
--    tambien las llamadas de 5, asi que se elimina la de 5.
drop function if exists public.worker_completar_post(bigint, text, text, text, text);
