#!/usr/bin/env python3
"""
ByGether - PASO 2: generador y sembrador de identidades sinteticas.

Crea cuentas automaticas (perfil + foto + portada + bio) directamente en Supabase.
  * Idempotente: los mismos indices generan siempre las mismas cuentas; las que ya existen se saltan.
  * Emails en dominio reservado (.invalid): nunca pueden chocar con un usuario real.
  * Fotos: DiceBear (avatar) y Picsum (portada). Se DESCARGAN y se suben al bucket
    'profile-images' (carpeta auto/<handle>/), asi la plataforma no depende de servicios externos.
  * Bios: un llamado a Gemini por cada 10 cuentas (100 cuentas = 10 llamadas). Si no hay
    GEMINI_API_KEY o falla, usa plantillas locales.

Variables de entorno:
  SUPABASE_SERVICE_ROLE_KEY  (obligatoria, salvo --dry-run)
  SUPABASE_URL               (opcional, por defecto el proyecto ByKonet/ByGether)
  GEMINI_API_KEY             (opcional, para las bios)
  GEMINI_MODEL               (opcional, por defecto gemini-flash-lite-latest)

Uso:
  python seed_cuentas.py --count 100
  python seed_cuentas.py --count 5 --dry-run
  python seed_cuentas.py --purge --yes     # borra TODAS las cuentas automaticas y lo que generaron
"""
import argparse
import json
import os
import random
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://aiymadawznadvavzspxj.supabase.co").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-lite-latest")

DOMAIN = "sim.bygether.invalid"
BUCKET = "profile-images"
BATCH = 10
SEED = 2026

# Los ids deben coincidir con el catalogo de personalidades del Paso 3.
PERSONAS = [
    "debatidor", "experto_tecnico", "sarcastico", "curioso", "moderado", "entusiasta",
    "esceptico", "humorista", "nostalgico", "motivador", "critico_constructivo", "novato",
]
TEMAS = [
    "tecnologia", "deportes", "musica", "cine y series", "cocina", "viajes", "ciencia",
    "emprendimiento", "arte y fotografia", "salud y bienestar", "videojuegos", "libros",
    "educacion", "actualidad", "moda", "mascotas", "automoviles", "finanzas personales",
]
NOMBRES = """Carlos Maria Luis Ana Jose Laura Miguel Sofia Pedro Camila Juan Valentina Rafael Daniela
Andres Isabella Fernando Gabriela Ricardo Paola Manuel Natalia Javier Carolina Diego Mariana Alejandro
Lucia Sergio Patricia Hector Andrea Victor Claudia Ramon Yolanda Eduardo Rosa Angel Elena Francisco
Marisol Roberto Karina Julio Diana Oscar Milagros Cesar Nicole Antonio Pamela Emilio Yesenia Gabriel
Raquel Samuel Leticia Ivan Adriana Joel Katherine Enrique Jennifer Henry Stephanie Wilson Massiel""".split()
APELLIDOS = """Garcia Rodriguez Martinez Fernandez Lopez Gonzalez Perez Sanchez Ramirez Torres Diaz Reyes
Morales Jimenez Herrera Medina Castillo Vargas Romero Suarez Mendoza Rojas Ortiz Guerrero Peña Cabrera
Nuñez Santana Batista Almonte Polanco Rosario Ventura Peralta Mejia Cruz Flores Delgado Acosta Sosa
Mora Paulino Beltre Encarnacion Tavarez Familia Guzman Montero Pimentel Duran Espinal Valdez Taveras
Checo Lantigua Matos Frias Disla Genao Bautista Canela Adames""".split()

FALLBACK_BIOS = [
    "Aficionad@ a {tema}. Comparto lo que voy aprendiendo.",
    "Curios@ por naturaleza. {tema} es lo mio.",
    "Opino de {tema} sin filtro, pero con respeto.",
    "Aqui por {tema} y buenas conversaciones.",
    "Dia a dia entre {tema} y cafe.",
]


def slugify(txt: str) -> str:
    txt = unicodedata.normalize("NFKD", txt).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "", txt.lower())


def build_identities(count: int):
    """Identidades deterministas: mismo SEED + mismo indice = misma cuenta."""
    rng = random.Random(SEED)
    usados, out = set(), []
    for i in range(count):
        nombre, apellido = rng.choice(NOMBRES), rng.choice(APELLIDOS)
        while True:
            handle = f"{slugify(nombre)}.{slugify(apellido)}{rng.randint(10, 99)}"
            if handle not in usados:
                usados.add(handle)
                break
        out.append({
            "handle": handle,
            "email": f"{handle}@{DOMAIN}",
            "nombre": f"{nombre} {apellido}",
            "persona_id": PERSONAS[i % len(PERSONAS)],
            "tema": rng.choice(TEMAS),
            "nivel": rng.choice(["baja", "media", "media", "alta"]),
            "horas": sorted(rng.sample(range(7, 24), 2)),
        })
    return out


# ---------- Supabase ----------
def sb_headers(extra=None):
    h = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}
    h.update(extra or {})
    return h


def existing_auto_emails():
    r = requests.get(f"{SUPABASE_URL}/rest/v1/profiles",
                     params={"select": "user_email", "is_cuenta_automatica": "eq.true"},
                     headers=sb_headers(), timeout=30)
    r.raise_for_status()
    return {x["user_email"] for x in r.json()}


def upload(path: str, data: bytes, content_type: str) -> str:
    r = requests.post(f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}", data=data,
                      headers=sb_headers({"Content-Type": content_type, "x-upsert": "true"}), timeout=60)
    r.raise_for_status()
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{path}"


def upsert_profiles(rows):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/profiles", params={"on_conflict": "user_email"},
                      data=json.dumps(rows),
                      headers=sb_headers({"Content-Type": "application/json",
                                          "Prefer": "resolution=merge-duplicates,return=minimal"}),
                      timeout=60)
    r.raise_for_status()


# ---------- Assets ----------
def fetch(url: str, tries=3) -> bytes:
    err = None
    for k in range(tries):
        try:
            r = requests.get(url, timeout=45, headers={"User-Agent": "ByGether-seeder/1.0"})
            r.raise_for_status()
            if len(r.content) < 500:
                raise ValueError("respuesta demasiado pequena")
            return r.content
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(2 * (k + 1))
    raise RuntimeError(f"no se pudo descargar {url}: {err}")


def make_assets(ident):
    seed = ident["handle"]
    avatar = fetch(f"https://api.dicebear.com/9.x/lorelei/png?seed={seed}&size=256"
                   "&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf")
    cover = fetch(f"https://picsum.photos/seed/{seed}/1500/500")
    base = f"auto/{seed}"
    return upload(f"{base}/avatar.png", avatar, "image/png"), upload(f"{base}/cover.jpg", cover, "image/jpeg")


# ---------- Bios (Gemini, 1 llamada por lote) ----------
def gemini_bios(batch):
    if not GEMINI_KEY:
        return None
    pedido = [{"i": n, "nombre": b["nombre"], "tema": b["tema"], "personalidad": b["persona_id"]}
              for n, b in enumerate(batch)]
    prompt = (
        "Escribe una bio corta de perfil de red social en espanol para cada persona de la lista. "
        "Maximo 120 caracteres, tono natural y cotidiano, acorde a su tema y personalidad. "
        "Sin hashtags, sin mencionar IA ni bots, como mucho un emoji. "
        f"Responde SOLO con un arreglo JSON de {len(batch)} strings en el mismo orden.\n"
        + json.dumps(pedido, ensure_ascii=False)
    )
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    r = requests.post(url, headers={"x-goog-api-key": GEMINI_KEY, "Content-Type": "application/json"},
                      json={"contents": [{"parts": [{"text": prompt}]}],
                            "generationConfig": {"responseMimeType": "application/json", "temperature": 1.0}},
                      timeout=60)
    if r.status_code == 429:
        wait = int(r.headers.get("Retry-After", "60"))
        print(f"  Gemini 429: espero {wait}s y uso plantillas para este lote")
        time.sleep(wait)
        return None
    r.raise_for_status()
    texto = r.json()["candidates"][0]["content"]["parts"][0]["text"]
    bios = json.loads(texto)
    if not (isinstance(bios, list) and len(bios) == len(batch) and all(isinstance(x, str) for x in bios)):
        return None
    return [b.strip()[:160] for b in bios]


def crear(count, dry_run):
    idents = build_identities(count)
    if dry_run:
        for x in idents[:10]:
            print(x["email"], "|", x["nombre"], "|", x["persona_id"], "|", x["tema"])
        print(f"... dry-run: {len(idents)} identidades generadas, nada se escribio.")
        return
    if not SERVICE_KEY:
        sys.exit("Falta SUPABASE_SERVICE_ROLE_KEY")
    ya = existing_auto_emails()
    pendientes = [x for x in idents if x["email"] not in ya]
    print(f"{len(ya)} cuentas automaticas ya existen; faltan {len(pendientes)} de {count}.")
    lote_id = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    creadas = fallidas = 0
    for i in range(0, len(pendientes), BATCH):
        lote = pendientes[i:i + BATCH]
        try:
            bios = gemini_bios(lote)
        except Exception as e:  # noqa: BLE001
            print(f"  bios por Gemini fallaron ({e}); uso plantillas")
            bios = None
        if bios is None:
            rr = random.Random(i)
            bios = [rr.choice(FALLBACK_BIOS).format(tema=x["tema"]) for x in lote]
        filas = []
        for ident, bio in zip(lote, bios):
            try:
                avatar_url, cover_url = make_assets(ident)
            except Exception as e:  # noqa: BLE001
                print(f"  SALTADA {ident['email']}: {e}")
                fallidas += 1
                continue
            filas.append({
                "user_email": ident["email"], "user_name": ident["nombre"],
                "avatar_url": avatar_url, "cover_url": cover_url,
                "is_cuenta_automatica": True, "persona_id": ident["persona_id"],
                "config_cuenta_automatica": {
                    "bio": bio, "tema_principal": ident["tema"], "idioma": "es",
                    "actividad": {"nivel": ident["nivel"], "zona_horaria": "America/Santo_Domingo",
                                  "horas_activas": ident["horas"]},
                    "origen": {"script": "seed_cuentas.py", "lote": lote_id},
                },
            })
            time.sleep(0.2)
        if filas:
            upsert_profiles(filas)
            creadas += len(filas)
        print(f"  lote {i // BATCH + 1}: +{len(filas)} (total creadas {creadas})")
        if GEMINI_KEY and i + BATCH < len(pendientes):
            time.sleep(7)  # deja el ritmo de Gemini por debajo de 10 RPM
    print(f"Listo. Creadas: {creadas}. Saltadas por error (reintenta y se completan): {fallidas}.")
    print(f"Cuentas automaticas en la base ahora: {len(existing_auto_emails())}")


def purgar(confirmado):
    if not SERVICE_KEY:
        sys.exit("Falta SUPABASE_SERVICE_ROLE_KEY")
    if not confirmado:
        sys.exit("Esto borra TODAS las cuentas automaticas y su contenido. Repite con --yes")
    r = requests.get(f"{SUPABASE_URL}/rest/v1/profiles",
                     params={"select": "avatar_url,cover_url", "is_cuenta_automatica": "eq.true"},
                     headers=sb_headers(), timeout=30)
    r.raise_for_status()
    marca = f"/object/public/{BUCKET}/"
    rutas = [u.split(marca, 1)[1] for x in r.json() for u in (x["avatar_url"], x["cover_url"]) if u and marca in u]
    r = requests.post(f"{SUPABASE_URL}/rest/v1/rpc/purgar_cuentas_automaticas", json={},
                      headers=sb_headers({"Content-Type": "application/json"}), timeout=120)
    r.raise_for_status()
    print("Base de datos:", r.json())
    for k in range(0, len(rutas), 100):
        requests.delete(f"{SUPABASE_URL}/storage/v1/object/{BUCKET}", json={"prefixes": rutas[k:k + 100]},
                        headers=sb_headers({"Content-Type": "application/json"}), timeout=60)
    print(f"Archivos borrados del bucket: {len(rutas)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Sembrador de cuentas automaticas de ByGether")
    ap.add_argument("--count", type=int, default=100)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--purge", action="store_true")
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    purgar(a.yes) if a.purge else crear(a.count, a.dry_run)
