#!/usr/bin/env python3
"""
ByGether - PASO 3: matriz de personalidades y motor de inyeccion contextual.

Este modulo NO llama al LLM: solo arma los prompts (0 llamadas de cuota). El worker del
Paso 4 toma el resultado y hace la llamada a Gemini bajo el gobernador de 10 RPM.

Que hace
  * Catalogo de personalidades: se lee de la tabla `agent_personas` de Supabase y, si no hay
    conexion, del respaldo `personalidades.json` (mismo contenido).
  * Contexto del hilo: la funcion SQL `contexto_hilo(post_id, agent_email)` devuelve en UNA
    consulta el post (texto, imagen, descripcion de imagen, repost/cita), los ultimos 3
    comentarios y los contadores que usara el centinela del Paso 6.
  * Prompts listos para el LLM:
      - construir_prompt_comentario()   -> COMMENT (comentario nuevo o respuesta a un comentario)
      - construir_prompt_publicacion()  -> POST (publicacion original de la cuenta)
      - construir_prompt_descripcion_imagen() + guardar_descripcion_imagen()
        (una sola llamada de vision por post, guardada en `post_image_desc` para reutilizarla)

Seguridad (inyeccion de prompt)
  Todo texto escrito por usuarios entra al prompt dentro de <dato>...</dato>, sin poder cerrar
  esa etiqueta, y las reglas comunes (`base`) ordenan tratarlo como material, nunca como orden.

Variables de entorno (las mismas del Paso 2)
  SUPABASE_SERVICE_ROLE_KEY  (obligatoria para leer de la base de datos)
  SUPABASE_URL               (opcional, por defecto el proyecto de ByGether)

Uso rapido (imprime el prompt, no consume cuota):
  python motor_contextual.py --catalogo
  python motor_contextual.py --post 62 --agente adriana.polanco70@sim.bygether.invalid
  python motor_contextual.py --post 62 --agente <email> --responder-a 3
  python motor_contextual.py --publicar --agente <email> --tema moda
  python motor_contextual.py --post 62 --agente <email> --json
"""
import argparse
import base64
import json
import os
import random
import re
import sys
import zlib
from pathlib import Path

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://aiymadawznadvavzspxj.supabase.co").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
CATALOGO_JSON = Path(__file__).with_name("personalidades.json")

MAX_POST_CHARS = 700          # texto del post que entra al prompt
MAX_COMENTARIO_CHARS = 350    # cada comentario del hilo
MAX_IMG_DESC_CHARS = 300
MAX_IMAGEN_BYTES = 4_000_000  # tope al descargar una imagen para describirla
TIMEOUT = 30

_CACHE = {}


# --------------------------------------------------------------------------- acceso a Supabase
def _headers():
    if not SERVICE_KEY:
        raise RuntimeError("Falta SUPABASE_SERVICE_ROLE_KEY")
    return {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json"}


def _get(tabla, params):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{tabla}", params=params, headers=_headers(), timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()


def _rpc(nombre, args):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/rpc/{nombre}", json=args, headers=_headers(), timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()


# --------------------------------------------------------------------------- catalogo de personalidades
def _catalogo_desde_json():
    d = json.loads(CATALOGO_JSON.read_text(encoding="utf-8"))
    return {"base": d["base"], "personas": d["personas"], "fuente": "json"}


def _catalogo_desde_db():
    filas = _get("agent_personas", {"select": "persona_id,nombre,descripcion,system_prompt,estilo,activa"})
    base, personas = None, {}
    for f in filas:
        if f["persona_id"] == "_base":
            base = f["system_prompt"]
        elif f.get("activa", True):
            personas[f["persona_id"]] = {"nombre": f["nombre"], "descripcion": f["descripcion"],
                                         "system_prompt": f["system_prompt"], "estilo": f.get("estilo") or {}}
    if not base or not personas:
        raise RuntimeError("Catalogo incompleto en agent_personas")
    return {"base": base, "personas": personas, "fuente": "db"}


def cargar_catalogo(fuente="auto", refrescar=False):
    """Devuelve {'base': str, 'personas': {id: {...}}, 'fuente': 'db'|'json'}.
    fuente: 'auto' (db y, si falla, json) | 'db' | 'json'. Se cachea en memoria."""
    if not refrescar and fuente in _CACHE:
        return _CACHE[fuente]
    if fuente == "json":
        cat = _catalogo_desde_json()
    elif fuente == "db":
        cat = _catalogo_desde_db()
    else:
        try:
            cat = _catalogo_desde_db()
        except Exception:
            cat = _catalogo_desde_json()
    _CACHE[fuente] = cat
    return cat


def obtener_persona(persona_id, catalogo=None):
    cat = catalogo or cargar_catalogo()
    p = cat["personas"].get(persona_id)
    if not p:
        raise ValueError(f"Personalidad desconocida o inactiva: {persona_id!r}")
    return p


# --------------------------------------------------------------------------- lectura de datos
def obtener_agente(agent_email):
    """Perfil de una cuenta automatica (None si no existe o no es automatica)."""
    filas = _get("profiles", {"select": "user_email,user_name,persona_id,config_cuenta_automatica",
                              "user_email": f"eq.{agent_email}", "is_cuenta_automatica": "eq.true"})
    return filas[0] if filas else None


def obtener_contexto(post_id, agent_email=None):
    """Post + ultimos 3 comentarios + contadores, en una sola consulta (funcion SQL contexto_hilo).
    Devuelve None si el post no existe (fue borrado)."""
    return _rpc("contexto_hilo", {"p_post_id": int(post_id), "p_agent_email": agent_email})


def obtener_comentario(comment_id):
    filas = _get("comments", {"select": "id,post_id,user_email,user_name,content", "id": f"eq.{int(comment_id)}"})
    return filas[0] if filas else None


def obtener_posts_recientes_agente(agent_email, n=3):
    filas = _get("posts", {"select": "content", "user_email": f"eq.{agent_email}",
                           "repost_of": "is.null", "order": "created_at.desc", "limit": str(n)})
    return [f["content"] for f in filas if f.get("content")]


# --------------------------------------------------------------------------- utilidades de texto
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_TAG_DATO = re.compile(r"<\s*/?\s*dato\s*>", re.IGNORECASE)


def _dato(texto, max_chars):
    """Envuelve texto de usuarios en <dato>: quita caracteres de control y cualquier intento de
    abrir/cerrar la etiqueta, normaliza espacios y recorta."""
    t = _CTRL.sub("", str(texto or ""))
    t = _TAG_DATO.sub("", t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t).strip()
    if len(t) > max_chars:
        t = t[:max_chars].rstrip() + "…"
    return f"<dato>{t}</dato>"


def _rng_para(agent_email, clave, semilla=None):
    """Aleatoriedad reproducible por (cuenta, tarea): el mismo prompt se arma igual si se reintenta."""
    if semilla is not None:
        return random.Random(semilla)
    return random.Random(zlib.crc32(f"{agent_email}|{clave}".encode()))


def _directivas_de_variacion(estilo, rng):
    """Convierte el 'estilo' de la personalidad en indicaciones puntuales para ESTA respuesta,
    para que dos cuentas con la misma personalidad no suenen calcadas."""
    d = []
    pw = estilo.get("palabras_max")
    if pw:
        d.append(f"Usa como máximo {int(pw)} palabras.")
    if rng.random() < float(estilo.get("prob_pregunta", 0.15)):
        d.append("Cierra con una pregunta concreta.")
    else:
        d.append("No termines con una pregunta.")
    if rng.random() < float(estilo.get("prob_emoji", 0.1)):
        d.append("Puedes usar un emoji.")
    else:
        d.append("No uses emojis esta vez.")
    return d


def _perfil_del_agente(agente):
    cfg = agente.get("config_cuenta_automatica") or {}
    partes = [f"Te llamas {agente.get('user_name', 'un usuario')}."]
    genero = cfg.get("genero_aparente")
    if genero in ("F", "M"):
        partes.append("Escribes en género " + ("femenino." if genero == "F" else "masculino."))
    if cfg.get("edad_aparente"):
        partes.append(f"Tienes unos {int(cfg['edad_aparente'])} años.")
    if cfg.get("tema_principal"):
        partes.append(f"Tu tema favorito es {cfg['tema_principal']}.")
    if cfg.get("bio"):
        partes.append(f"Tu bio pública: {_dato(cfg['bio'], 200)}")
    return " ".join(partes)


def _system(catalogo, persona, agente):
    return (f"{catalogo['base']}\n\n"
            f"TU PERSONALIDAD ({persona['nombre']}):\n{persona['system_prompt']}\n\n"
            f"TU PERFIL:\n{_perfil_del_agente(agente)}")


# --------------------------------------------------------------------------- prompt: comentario
def construir_prompt_comentario(ctx, agente, catalogo=None, responder_a=None, comentario_objetivo=None, semilla=None):
    """Arma el prompt para un COMMENT.

    ctx                  resultado de contexto_hilo() (dict)
    agente               fila de profiles de la cuenta automatica que va a escribir
    responder_a          id de un comentario del hilo al que se responde (None = comentario nuevo)
    comentario_objetivo  dict opcional {'id','autor','contenido'} si el comentario no esta entre los
                         ultimos 3 del contexto (la funcion lo busca en la BD si no se pasa)

    Devuelve {'system', 'user', 'meta'}. 'meta' trae los contadores que necesita el Paso 6.
    """
    cat = catalogo or cargar_catalogo()
    persona = obtener_persona(agente["persona_id"], cat)
    post = ctx["post"]
    rng = _rng_para(agente["user_email"], f"c|{post['id']}|{responder_a}", semilla)

    lineas = [f"PUBLICACIÓN de {post.get('autor') or 'un usuario'}:"]
    if post.get("contenido"):
        lineas.append(_dato(post["contenido"], MAX_POST_CHARS))
    if post.get("cita"):
        lineas.append(f"Al compartirla añadió: {_dato(post['cita'], MAX_COMENTARIO_CHARS)}")
    orig = post.get("repost_de")
    if orig:
        lineas.append(f"Es un repost de una publicación de {orig.get('autor') or 'un usuario'}:")
        lineas.append(_dato(orig.get("contenido") or "(sin texto)", MAX_POST_CHARS))
    if post.get("imagen_url") or (orig and orig.get("imagen_url")):
        if post.get("imagen_descripcion"):
            lineas.append(f"La publicación incluye una imagen. Descripción de la imagen: "
                          f"{_dato(post['imagen_descripcion'], MAX_IMG_DESC_CHARS)}")
        else:
            lineas.append("La publicación incluye una imagen que no puedes ver: no describas ni inventes "
                          "su contenido; reacciona solo al texto.")

    comentarios = list(ctx.get("ultimos_comentarios") or [])
    if comentarios:
        lineas.append("\nÚLTIMOS COMENTARIOS DEL HILO (del más antiguo al más reciente):")
        for i, c in enumerate(comentarios, 1):
            lineas.append(f"{i}. {c.get('autor') or 'Usuario'}: {_dato(c.get('contenido'), MAX_COMENTARIO_CHARS)}")
    else:
        lineas.append("\nAún no hay comentarios en este hilo.")

    objetivo = None
    if responder_a is not None:
        objetivo = next((c for c in comentarios if c.get("id") == responder_a), None) or comentario_objetivo
        if objetivo is None:
            fila = obtener_comentario(responder_a)
            if fila and fila["post_id"] == post["id"]:  # solo comentarios de ESTE hilo
                objetivo = {"id": fila["id"], "autor": fila["user_name"], "contenido": fila["content"]}
    if objetivo:
        lineas.append(f"\nTAREA: responde directamente al comentario de {objetivo.get('autor') or 'un usuario'}: "
                      f"{_dato(objetivo.get('contenido'), MAX_COMENTARIO_CHARS)}")
    else:
        lineas.append("\nTAREA: escribe un comentario nuevo sobre la publicación.")
    lineas.append("Indicaciones para esta vez: " + " ".join(_directivas_de_variacion(persona["estilo"], rng)))
    lineas.append("Escribe solo el texto del comentario.")

    return {
        "system": _system(cat, persona, agente),
        "user": "\n".join(lineas),
        "meta": {
            "tipo": "respuesta" if objetivo else "comentario",
            "post_id": post["id"],
            "agent_email": agente["user_email"],
            "persona_id": agente["persona_id"],
            "responde_a_comentario": objetivo.get("id") if objetivo else None,
            "cadena_automatica": ctx.get("cadena_automatica", 0),
            "comentarios_previos_del_agente": ctx.get("comentarios_previos_del_agente", 0),
            "post_de_cuenta_automatica": bool(post.get("autor_es_automatica")),
            "tiene_imagen": bool(post.get("imagen_url") or (orig and orig.get("imagen_url"))),
            "imagen_descrita": bool(post.get("imagen_descripcion")),
            "max_caracteres": _max_caracteres(persona["estilo"]),
        },
    }


def _max_caracteres(estilo):
    """Tope de caracteres para el validador del Paso 6 (aprox. 6.5 caracteres por palabra, con margen)."""
    pw = int(estilo.get("palabras_max", 45))
    return max(140, min(int(pw * 6.5) + 40, 420))


# --------------------------------------------------------------------------- prompt: publicacion propia
def construir_prompt_publicacion(agente, catalogo=None, tema=None, publicaciones_previas=None,
                                 con_imagen=False, semilla=None):
    """Arma el prompt para un POST original de la cuenta (el LLM devuelve solo el texto).
    publicaciones_previas: ultimos posts de la cuenta, para no repetirse (ver obtener_posts_recientes_agente)."""
    cat = catalogo or cargar_catalogo()
    persona = obtener_persona(agente["persona_id"], cat)
    cfg = agente.get("config_cuenta_automatica") or {}
    tema = tema or cfg.get("tema_principal") or "lo que te apasiona"
    rng = _rng_para(agente["user_email"], f"p|{tema}|{len(publicaciones_previas or [])}", semilla)

    lineas = [f"TAREA: escribe una publicación original para tu perfil sobre este tema: {tema}."]
    lineas.append("Comparte una opinión, una vivencia breve o una pregunta para tus contactos; "
                  "que suene a algo que de verdad te pasó o piensas, no a un anuncio.")
    if con_imagen:
        lineas.append("La publicación llevará una foto tuya. Escribe el texto que la acompaña sin describir "
                      "la foto como si fuera un catálogo.")
    if publicaciones_previas:
        lineas.append("\nTus publicaciones anteriores (no repitas ideas ni fórmulas):")
        for p in publicaciones_previas[:3]:
            lineas.append("- " + _dato(p, MAX_COMENTARIO_CHARS))
    lineas.append("Indicaciones para esta vez: " + " ".join(_directivas_de_variacion(persona["estilo"], rng)))
    lineas.append("Escribe solo el texto de la publicación.")

    return {
        "system": _system(cat, persona, agente),
        "user": "\n".join(lineas),
        "meta": {"tipo": "publicacion", "agent_email": agente["user_email"], "persona_id": agente["persona_id"],
                 "tema": tema, "con_imagen": con_imagen, "max_caracteres": _max_caracteres(persona["estilo"])},
    }


# --------------------------------------------------------------------------- descripcion de imagenes
def construir_prompt_descripcion_imagen():
    """Prompt para UNA llamada de vision por post. El worker adjunta la imagen (ver descargar_imagen)."""
    return ("Describe de forma objetiva y breve, en español, lo que se ve en esta imagen: sujetos, objetos, "
            "lugar y ambiente. Máximo 2 frases y 250 caracteres. Sin opiniones, sin adivinar nombres de "
            "personas y sin mencionar que es una imagen. Responde solo con la descripción.")


def descargar_imagen(url):
    """Descarga una imagen para mandarla al modelo de vision. Devuelve (mime, base64_str) o None."""
    try:
        r = requests.get(url, timeout=TIMEOUT, stream=True, headers={"User-Agent": "ByGether-agentes/1.0"})
        r.raise_for_status()
        mime = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if mime not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
            mime = {"jfif": "image/jpeg", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                    "webp": "image/webp", "gif": "image/gif"}.get(url.rsplit(".", 1)[-1].lower().split("?")[0], "")
        if not mime:
            return None
        datos = r.raw.read(MAX_IMAGEN_BYTES + 1, decode_content=True)
        if len(datos) > MAX_IMAGEN_BYTES:
            return None
        return mime, base64.b64encode(datos).decode()
    except requests.RequestException:
        return None


def guardar_descripcion_imagen(post_id, descripcion, modelo=None):
    """Guarda (o reemplaza) la descripcion en post_image_desc para no volver a gastar cuota en ese post."""
    fila = {"post_id": int(post_id), "descripcion": str(descripcion).strip()[:MAX_IMG_DESC_CHARS], "modelo": modelo}
    h = _headers()
    h["Prefer"] = "resolution=merge-duplicates,return=minimal"
    r = requests.post(f"{SUPABASE_URL}/rest/v1/post_image_desc", params={"on_conflict": "post_id"},
                      json=fila, headers=h, timeout=TIMEOUT)
    r.raise_for_status()


# --------------------------------------------------------------------------- atajo para el worker
def armar_prompt_comentario(post_id, agent_email, responder_a=None, catalogo=None):
    """Todo en uno para el worker: lee agente + contexto y devuelve el prompt de COMMENT.
    Devuelve None si el post ya no existe. Lanza ValueError si la cuenta no es automatica."""
    agente = obtener_agente(agent_email)
    if not agente:
        raise ValueError(f"No existe la cuenta automatica {agent_email!r}")
    ctx = obtener_contexto(post_id, agent_email)
    if ctx is None:
        return None
    return construir_prompt_comentario(ctx, agente, catalogo=catalogo, responder_a=responder_a)


def armar_prompt_publicacion(agent_email, tema=None, con_imagen=False, catalogo=None):
    agente = obtener_agente(agent_email)
    if not agente:
        raise ValueError(f"No existe la cuenta automatica {agent_email!r}")
    return construir_prompt_publicacion(agente, catalogo=catalogo, tema=tema, con_imagen=con_imagen,
                                        publicaciones_previas=obtener_posts_recientes_agente(agent_email))


# --------------------------------------------------------------------------- CLI
def _imprimir(p, como_json):
    if como_json:
        print(json.dumps(p, ensure_ascii=False, indent=2))
        return
    print("=" * 30, "SYSTEM", "=" * 30)
    print(p["system"])
    print("\n" + "=" * 31, "USER", "=" * 31)
    print(p["user"])
    print("\n" + "=" * 31, "META", "=" * 31)
    print(json.dumps(p["meta"], ensure_ascii=False, indent=2))


def main():
    ap = argparse.ArgumentParser(description="Paso 3: construye prompts (no llama al LLM).")
    ap.add_argument("--catalogo", action="store_true", help="lista las personalidades y sale")
    ap.add_argument("--fuente", choices=["auto", "db", "json"], default="auto")
    ap.add_argument("--post", type=int, help="id del post a comentar")
    ap.add_argument("--responder-a", type=int, help="id del comentario al que se responde")
    ap.add_argument("--publicar", action="store_true", help="arma un POST original en vez de un comentario")
    ap.add_argument("--tema", help="tema de la publicacion (por defecto, el de la cuenta)")
    ap.add_argument("--agente", help="email de la cuenta automatica")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    cat = cargar_catalogo(a.fuente)
    if a.catalogo:
        print(f"Fuente: {cat['fuente']} - {len(cat['personas'])} personalidades")
        for pid, p in cat["personas"].items():
            e = p["estilo"]
            print(f"  {pid:22s} {p['nombre']:26s} palabras<={e.get('palabras_max')} "
                  f"pregunta={e.get('prob_pregunta')} emoji={e.get('prob_emoji')}")
        return
    if not a.agente:
        sys.exit("Falta --agente <email>")
    if a.publicar:
        _imprimir(armar_prompt_publicacion(a.agente, tema=a.tema, catalogo=cat), a.json)
    elif a.post:
        p = armar_prompt_comentario(a.post, a.agente, responder_a=a.responder_a, catalogo=cat)
        if p is None:
            sys.exit(f"El post {a.post} no existe")
        _imprimir(p, a.json)
    else:
        sys.exit("Indica --post <id> o --publicar")


if __name__ == "__main__":
    main()
