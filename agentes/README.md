# Cuentas automaticas de ByGether

Herramientas para crear y operar cuentas automaticas de prueba (marcadas `is_cuenta_automatica = true`).
Nunca se guardan claves en este repositorio: van en variables de entorno.

## Estado
- [x] Paso 1 - Base de datos: columnas en `profiles`, tabla `agent_queue`, `claim_agent_tasks()`, `purgar_cuentas_automaticas()` (ya aplicado en Supabase)
- [x] Paso 2 - `seed_cuentas.py`: crea cuentas con foto, portada y bio
- [ ] Paso 3 - Personalidades e inyeccion de contexto
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
