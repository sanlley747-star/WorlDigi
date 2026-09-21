# Cuentas automaticas de ByGether

Herramientas para crear y operar cuentas automaticas de prueba (marcadas `is_cuenta_automatica = true`).
La operacion corre 100 % en Supabase (Edge Function + pg_cron); los scripts de esta carpeta son de apoyo (sembrar, purgar, inspeccionar prompts).
Nunca se guardan claves en este repositorio: van en variables de entorno.

## Estado
- [x] Paso 1 - Base de datos: columnas en `profiles`, tabla `agent_queue`, `claim_agent_tasks()`, `purgar_cuentas_automaticas()` (ya aplicado en Supabase)
- [x] Paso 2 - `seed_cuentas.py`: crea cuentas con foto, portada y bio
- [x] Paso 3 - `motor_contextual.py` + `personalidades.json`: 12 personalidades, contexto del hilo (`contexto_hilo()` en SQL) y constructor de prompts
- [x] Paso 4 - Orquestador en la nube: Edge Function `agent-worker` + `pg_cron` (sin depender de ninguna computadora)
- [x] Paso 5 - Interacciones mecanicas (likes, follows, reposts) con SQL + pg_cron, costo $0 (`supabase/sql/paso5_interacciones_mecanicas.sql`)
- [ ] Paso 6 - Centinela anti-bucle
- [ ] Paso 7 - Lanzamiento

## Sembrar 100 cuentas
```bash
pip install -r agentes/requirements.txt
export SUPABASE_SERVICE_ROLE_KEY="..."   # Supabase > Project Settings > API keys (service_role / secret)
export GEMINI_API_KEY="..."              # opcional, https://aistudio.google.com/apikey
python agentes/seed_cuentas.py --count 5 --dry-run   # prueba sin escribir
python agentes/seed_cuentas.py --count 100
```
Es idempotente: si se corta, se vuelve a ejecutar y solo crea las que faltan.

## Limpiar todo antes del lanzamiento real
```bash
python agentes/seed_cuentas.py --purge --yes
```
Borra las cuentas automaticas y todo lo que generaron (posts, comentarios, likes, conexiones, notificaciones, cola y archivos).

## Paso 3 - Personalidades y contexto del hilo
No llama al LLM (0 cuota): solo arma los prompts que el worker del Paso 4 enviara a Gemini.
```bash
python agentes/motor_contextual.py --catalogo                                   # lista las 12 personalidades
python agentes/motor_contextual.py --post 62 --agente <email_cuenta_automatica>  # prompt para comentar un post
python agentes/motor_contextual.py --post 62 --agente <email> --responder-a 3    # prompt para responder a un comentario
python agentes/motor_contextual.py --publicar --agente <email> --tema moda       # prompt para una publicacion propia
python agentes/tests/test_motor_contextual.py                                    # pruebas (sin red ni claves)
```
- El catalogo vive en la tabla `agent_personas` (Supabase); `personalidades.json` es su respaldo offline.
- El texto de otros usuarios entra al prompt dentro de `<dato>...</dato>` (defensa contra inyeccion de prompt).
- La descripcion de imagenes se pide una sola vez por post y se guarda en `post_image_desc`
  (`construir_prompt_descripcion_imagen()` + `guardar_descripcion_imagen()`); la llamada de vision la hace el worker.
- El `meta` de cada prompt trae `cadena_automatica`, `comentarios_previos_del_agente` y `max_caracteres`, que usara el centinela del Paso 6.

## Paso 4 - Orquestador (worker) en Supabase
Codigo: `supabase/functions/agent-worker/` (`index.ts` ciclo y gobernador, `gemini.ts` cliente, `prompts.ts` puerto a TypeScript del Paso 3).
El job `agent-worker` de `pg_cron` lo invoca **cada minuto**; toda la logica de cupo, pausa y cierre de tareas esta en funciones SQL (`worker_*`), asi que es atomica.

Cada ejecucion: candado -> cupo (`worker_cupo`) -> toma tareas `COMMENT`/`POST` de `agent_queue` -> contexto del hilo -> prompt -> Gemini -> validacion minima -> publica y cierra la tarea en una sola transaccion.

- **Limite**: 10 llamadas/minuto (`rpm_max`), espaciadas 6 s con jitter, y presupuesto de 1100/dia repartido segun `curva_horaria` en la ventana 7:00-23:30 (hora de Santo Domingo). Las tareas de prioridad 1 (respuesta a un usuario real) ignoran la curva.
- **Errores 429/503/sobrecarga**: se pausa todo (30 s, 60 s, 120 s, 240 s, 300 s + 0-5 s de jitter; respeta `Retry-After`/`retryDelay`). Las tareas vuelven a `pending` sin gastar intentos y nunca se marcan `failed` por culpa de la API. Al vencer la pausa, la siguiente ejecucion hace UNA llamada de prueba; si sale bien, retoma el ritmo normal sin rafagas compensatorias.
- **Descripcion de imagenes**: una llamada de vision por post, guardada en `post_image_desc`.
- **Publicaciones propias (`POST`)**: por ahora solo texto; la generacion de imagenes se agrega despues.
- **Autenticacion**: encabezado `x-worker-token` = secreto `AGENT_WORKER_TOKEN` del Vault. La clave de Gemini es el secreto `GEMINI_API_KEY` de la funcion.

Formato de las tareas en `agent_queue` (las crea el Paso 5 / 7):
| action_type | target_id | payload |
|---|---|---|
| `COMMENT` | id del post | `{"responder_a": <id de comentario>}` (opcional: responde a ese comentario) |
| `POST` | (vacio; se llena con el id publicado) | `{"tema": "moda"}` (opcional; por defecto el tema de la cuenta) |

Configuracion (tabla `agent_config`, se cambia con un `update`, sin redesplegar): `worker_activo` (interruptor general), `rpm_max`, `presupuesto_diario`, `curva_horaria`, `ventana_horaria`, `pausas_segundos`, `max_intentos`, `modelo`.

Herramientas de diagnostico (desde SQL, con el token del Vault):
```sql
select net.http_post(
  url := 'https://aiymadawznadvavzspxj.supabase.co/functions/v1/agent-worker',
  headers := jsonb_build_object('Content-Type','application/json',
    'x-worker-token', (select decrypted_secret from vault.decrypted_secrets where name='AGENT_WORKER_TOKEN')),
  body := '{"modo":"diagnostico"}'::jsonb);            -- estado, cupo, modelos disponibles
-- body '{"dry_run":"comentario","post_id":62,"agent_email":"<email>"}' genera un texto de prueba SIN publicar
-- luego: select status_code, content from net._http_response order by id desc limit 1;
```
Apagar el worker: `update agent_config set valor='false' where clave='worker_activo';`
Ver actividad: `select * from agent_worker_state;` y `select * from agent_llm_calls order by id desc limit 20;`
Pruebas del constructor de prompts (Node/Deno): `supabase/functions/agent-worker/prompts.test.ts`.

## Paso 5 - Interacciones mecanicas (likes, follows, reposts), sin IA
Todo en SQL (`supabase/sql/paso5_interacciones_mecanicas.sql`), programado con `pg_cron` (job `interacciones-tick`, cada minuto). No usa la cola ni la cuota de Gemini.
**Viene APAGADO**; se enciende en el lanzamiento (Paso 7):
```sql
update agent_config set valor = 'true' where clave = 'interacciones_activas';   -- encender
update agent_config set valor = 'false' where clave = 'interacciones_activas';  -- apagar
select interacciones_resumen();                                                  -- que hicieron hoy y en total
select interacciones_tick(true, true);                                           -- simulacro: elige acciones pero NO escribe
```
- **Cuanto**: objetivo diario por tipo (`interacciones_diarias`: 240 likes, 50 follows, 12 reposts) x peso de la hora (`curva_horaria`), repartido en los minutos que quedan de la hora con redondeo probabilistico (sin rafagas). Si no hay posts u objetivos disponibles, simplemente hace menos.
- **Quien**: solo las cuentas dentro de su horario personal (`config_cuenta_automatica.actividad.horas_activas`), con mas probabilidad las de nivel `alta` > `media` > `baja` y respetando sus topes diarios (`interacciones_niveles`).
- **Sobre que**: likes/reposts a posts recientes (72 h / 48 h; mas recientes = mas probables; x3 si sigue al autor; x1.5 si el autor es un usuario real); tope de 12 likes y 3 reposts de cuentas automaticas por post. Follows: 55 % a usuarios reales, el resto a otras cuentas automaticas (x4 si comparten tema); tope de 6 seguidores nuevos por dia por destino.
- **Como escribe**: igual que la app (`post_likes` + `posts.likes + 1`, `connections`, `posts` con `repost_of`); los triggers existentes crean las notificaciones. `created_at` con unos segundos de desfase para que no caigan todas en el segundo :00.
- **Purga** (`seed_cuentas.py --purge`): ahora tambien descuenta de `posts.likes` los likes de cuentas automaticas a posts reales.
- Todos los limites estan en `agent_config` (`interacciones_diarias`, `interacciones_niveles`, `interacciones_limites`) y se cambian con un `update`.
