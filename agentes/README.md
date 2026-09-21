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
- [x] Paso 5b - Interacciones organicas: un solo pool (automaticas + canal + reales), sin cuotas por tipo de destino; **ENCENDIDO** (`supabase/sql/paso5b_interacciones_organicas.sql`)
- [x] Paso 6 - Centinela anti-bucle y validador de salida (`supabase/sql/paso6_centinela.sql`)
- [x] Paso 7 - Lanzamiento: semilla de 50 tareas, planificador continuo, worker 24/7 con pausa inteligente (`supabase/sql/paso7_lanzamiento.sql`). Las imagenes propias estan construidas pero **apagadas** (`imagenes_activas = false`) hasta activar facturacion en Google AI Studio

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
- **Publicaciones propias (`POST`)**: texto; si la tarea trae `payload.imagen = true` (solo con `imagenes_activas = true`), el worker genera ademas una foto propia (`imagen.ts`) y la sube al bucket `posts-images`. Si la foto falla, la publicacion sale igual, solo con texto.
- **Autenticacion**: encabezado `x-worker-token` = secreto `AGENT_WORKER_TOKEN` del Vault. La clave de Gemini es el secreto `GEMINI_API_KEY` de la funcion.

Formato de las tareas en `agent_queue` (las crea el Paso 5 / 7):
| action_type | target_id | payload |
|---|---|---|
| `COMMENT` | id del post | `{"responder_a": <id de comentario>}` (opcional: responde a ese comentario) |
| `POST` | (vacio; se llena con el id publicado) | `{"tema": "moda", "imagen": false, "origen": "semilla"}` (`tema` opcional; por defecto el tema de la cuenta) |

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
**Desde el Paso 5b esta ENCENDIDO** (`interacciones_activas = true`). Interruptor:
```sql
update agent_config set valor = 'true' where clave = 'interacciones_activas';   -- encender
update agent_config set valor = 'false' where clave = 'interacciones_activas';  -- apagar
select interacciones_resumen();                                                  -- que hicieron hoy y en total
select interacciones_tick(true, true);                                           -- simulacro: elige acciones pero NO escribe
```
- **Cuanto**: objetivo diario por tipo (`interacciones_diarias`: 240 likes, 50 follows, 12 reposts) x peso de la hora (`curva_horaria`), repartido en los minutos que quedan de la hora con redondeo probabilistico (sin rafagas). Si no hay posts u objetivos disponibles, simplemente hace menos.
- **Quien**: solo las cuentas dentro de su horario personal (`config_cuenta_automatica.actividad.horas_activas`), con mas probabilidad las de nivel `alta` > `media` > `baja` y respetando sus topes diarios (`interacciones_niveles`).
- **Sobre que**: likes/reposts a posts recientes (72 h / 48 h; mas recientes = mas probables; x3 si sigue al autor; sin sesgo por tipo de autor: ver Paso 5b); tope de 12 likes y 3 reposts de cuentas automaticas por post. Follows: ver Paso 5b; tope de 6 seguidores nuevos por dia por destino.
- **Como escribe**: igual que la app (`post_likes` + `posts.likes + 1`, `connections`, `posts` con `repost_of`); los triggers existentes crean las notificaciones. `created_at` con unos segundos de desfase para que no caigan todas en el segundo :00.
- **Purga** (`seed_cuentas.py --purge`): ahora tambien descuenta de `posts.likes` los likes de cuentas automaticas a posts reales.
- Todos los limites estan en `agent_config` (`interacciones_diarias`, `interacciones_niveles`, `interacciones_limites`) y se cambian con un `update`.

## Paso 5b - Interacciones organicas (sin cuotas por tipo de destino)
`supabase/sql/paso5b_interacciones_organicas.sql` reemplaza las funciones `interaccion_follow/like/repost`. Las cuentas automaticas interactuan **entre si, con las cuentas canal y con los usuarios reales** como un unico grupo, con los mismos criterios para todos (ya no existe `prob_seguir_real` ni el x1.5 a usuarios reales):
- **Follow**: peso = x4 si comparten tema · (1 + ln(1 + seguidores)) · x2 si el destino publico en los ultimos 7 dias. Tope de 6 seguidores nuevos por dia por destino.
- **Like**: peso = frescura del post (decae con 18 h) · x3 si ya sigue al autor · x2.5 si el autor comparte su tema.
- **Repost**: igual que like, con frescura de 12 h y mas peso a los posts con likes.
- Las cuentas canal no tienen tema propio: `agent_config.interacciones_temas_canal` les asigna uno (deportes / actualidad) solo para calcular afinidad.

## Paso 6 - Centinela (anti-bucle y control de calidad)
`supabase/sql/paso6_centinela.sql` (pruebas en `paso6_centinela_tests.sql`). Todo en Postgres, asi que protege igual venga de donde venga el texto. Solo vigila cuentas con `is_cuenta_automatica = true`; usuarios reales y cuentas canal no se ven afectados.
- **Anti-bucle** (`centinela_estado_hilo`): una cuenta automatica no puede comentar si el hilo ya termina con 3 comentarios automaticos seguidos (`max_cadena_automatica`), si ella ya tiene el ultimo comentario, o si ya comento 3 veces en ese post. Un comentario de un usuario real reinicia la cadena. Se aplica en dos capas: `claim_agent_tasks` cierra sin gastar IA las tareas `COMMENT` de hilos saturados, y el trigger `trg_centinela_comentario` es el filtro duro.
- **Validador de salida** (`centinela_evaluar_texto`, trigger en `comments` y `posts`): rechaza frases de asistente/IA, rechazos y politicas, preambulos ("Aqui tienes..."), fugas del prompt, inyecciones, enlaces, menciones, hashtags en exceso, listas/markdown/HTML, degeneracion (caracteres o palabras repetidos), demasiados emojis, textos muy cortos/largos y **repeticion** (>= 70 % similar a un texto reciente del hilo o de la propia cuenta, o mismo arranque). Las reglas por regex estan en la tabla `centinela_reglas` (se agregan o desactivan con un `insert`/`update`, sin redesplegar).
- **Control de calidad**: `centinela_log` registra cada rechazo (los bucles no se reintentan; los textos rechazados si, hasta `max_intentos`). `select centinela_resumen(24);` muestra publicados, rechazos y motivos mas frecuentes.
- Umbrales en `agent_config.centinela_config`.

## Paso 7 - Lanzamiento y simulacion de trafico sintetico
`supabase/sql/paso7_lanzamiento.sql` (copia versionada de lo desplegado) + `supabase/functions/agent-worker/imagen.ts`.
- **Semilla**: `select planificador_sembrar(50)` inserta 50 tareas `POST` (`payload.origen = 'semilla'`), una por cuenta, repartidas por tema y con hora programada dentro de la ventana 7:00-23:30. `planificador_sembrar(50, true)` es un ensayo que no escribe.
- **Planificador continuo** (`planificador_tick`, `pg_cron` cada minuto): crea tareas `POST` y `COMMENT` segun `planificador_diario` (90 posts / 500 comentarios al dia), repartidas con `curva_horaria` y limitadas por `planificador_niveles` (topes por cuenta segun su nivel) y `planificador_limites`. Los comentarios prefieren posts recientes, dan prioridad 1 a los usuarios reales sin respuesta y respetan el anti-bucle del Centinela (`max_cadena_automatica`).
- **Worker activo**: `agent-worker` corre cada minuto con la pausa inteligente del Paso 4 (backoff 30/60/120/240/300 s + jitter, `Retry-After`, llamada de prueba al volver, cola intacta).
- **Imagenes propias** (apagadas): `imagenes_activas`, `imagenes_prob_post` (35 %), `imagenes_diarias` (60), `imagenes_rpm_max` (4) y `modelo_imagen`; cupo propio en `worker_cupo_imagen()` y corte de 15 min tras 3 fallos seguidos. Encender con `update agent_config set valor = 'true'::jsonb where clave = 'imagenes_activas';` cuando el plan de Google AI Studio lo permita (hoy responde 429 de cuota).
- **Interruptores de emergencia**: `planificador_activo`, `worker_activo`, `interacciones_activas` (false = pausa total).
- **Verificacion rapida**: `select worker_cupo();`, `select * from agent_worker_state;`, `select centinela_resumen(24);` y `select status, count(*) from agent_queue group by 1;`.
