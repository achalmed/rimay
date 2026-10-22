"""tests/test_rimay_sola.py — el chat arranca SOLO, con el anfitrión mínimo de Tiqsi, sin Qillqa ni la base
documental (proyecto Rimay R3; fase 10.2b, 2026-10-20; app/rimay_sola.py). Sin base de datos: lo que la necesita se
prueba en vivo contra una vacía (qillqa/scripts/verde.sh sola-rimay).
"""
import json
import os
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
SECRETO = "k" * 40


def _entorno_limpio(tmp_path) -> dict:
    return {"HOME": os.environ.get("HOME", "/tmp"), "PATH": os.environ.get("PATH", ""),
            "RIMAY_DATABASE_URL": "postgresql+asyncpg://nadie:nada@127.0.0.1:1/rimay_prueba",
            "RIMAY_DIR": str(tmp_path / "rimay"), "JWT_SECRET": SECRETO}


def test_solo_no_carga_nada_de_qillqa(tmp_path):
    codigo = ("import sys, json; import rimay.sola as m; "
              "print(json.dumps({'ajenos': sorted(x for x in sys.modules if x == 'app' or x.startswith('app.')), "
              "'informe': m.app.state.anfitrion.informe(), 'capacidades': m.app.state.anfitrion.capacidades.ofrecidas()}))")
    r = subprocess.run([sys.executable, "-c", codigo], cwd=RAIZ, env=_entorno_limpio(tmp_path),
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    datos = json.loads(r.stdout.strip().splitlines()[-1])
    assert datos["ajenos"] == []                                    # nada de Qillqa
    assert datos["informe"] == [{"id": "chat", "nombre": "Chat", "version": "0.1.0"}]
    assert set(datos["capacidades"]) == {"identidad.v1", "conversaciones.v1"}


def test_solo_sin_su_base_no_arranca(tmp_path):
    entorno = {k: v for k, v in _entorno_limpio(tmp_path).items() if k != "RIMAY_DATABASE_URL"}
    r = subprocess.run([sys.executable, "-c", "import rimay.sola"], cwd=RAIZ, env=entorno,
                       capture_output=True, text=True, timeout=120)
    assert r.returncode != 0 and "RIMAY_DATABASE_URL" in r.stderr


def test_solo_atiende_con_su_propia_sesion_y_la_ficha_del_socket(tmp_path):
    import asyncio

    from fastapi.testclient import TestClient
    from tiqsi import Manifiesto
    from tiqsi.minimo import Cuentas, crear_app

    from rimay.manifiesto import MANIFIESTO

    cuentas = tmp_path / "cuentas.json"
    Cuentas(cuentas).crear("ana", "clave-larga-1", "administrador", "Ana Pérez")
    copia = Manifiesto(**{**MANIFIESTO.__dict__, "al_arrancar": [], "tareas": [], "bandeja": None})   # sin base aquí
    c = TestClient(crear_app([copia], nombre="Chat", secreto=SECRETO, cuentas=cuentas))
    assert c.get("/api/health").json()["anfitrion"] == "Chat"
    assert c.get("/api/chat/canales").status_code == 401
    ficha = c.post("/api/auth/login", json={"usuario": "ana", "clave": "clave-larga-1"}).json()["token"]
    from tiqsi.modulo import opcional

    identidad = opcional("identidad.v1")   # el del anfitrión mínimo, activo al crearse
    u = asyncio.run(identidad.de_ficha(ficha))
    assert (u.id, u.nombre_usuario, u.nombre_completo, u.rol) == (1, "ana", "Ana Pérez", "administrador")
    assert asyncio.run(identidad.de_ficha("no-vale")) is None
    rutas = {x.path for x in c.app.routes}
    assert {"/api/chat/canales", "/api/chat/ws", "/api/chat/canales/{cid}/mensajes"} <= rutas


