# Cuentas automaticas de ByGether

Herramientas para crear y operar cuentas automaticas de prueba (marcadas `is_cuenta_automatica = true`).
Nunca se guardan claves en este repositorio: van en variables de entorno.

## Estado
- [x] Paso 1 - Base de datos: columnas en `profiles`, tabla `agent_queue`, `claim_agent_tasks()`, `purgar_cuentas_automaticas()` (ya aplicado en Supabase)
- [x] Paso 2 - `seed_cuentas.py`: crea cuentas con foto, portada y bio
- [x] Paso 3 - `motor_contextual.py` + `personalidades.json`: 12 personalidades, contexto del hilo (`contexto_hilo()` en SQL) y constructor de prompts
- [ ] Paso 4 - Orquestador con gobernador de cuota
- [ ] Paso 5 - Interacciones ligeras (likes / follows / reposts)
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
