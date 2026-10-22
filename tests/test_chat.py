"""tests/test_chat.py — reglas puras del chat (servicios/chat.py): menciones, clave del
directo, entidades válidas, permisos por clase de canal y texto de un mensaje automático.
Sin base de datos. Uso: cd backend && .venv/bin/python -m pytest -q tests/test_chat.py
"""
import os
from types import SimpleNamespace as NS

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x:y@127.0.0.1/z")
os.environ.setdefault("JWT_SECRET", "prueba")

from rimay import chat  # noqa: E402


def test_menciones_clave_directo_y_entidades():
    assert chat.menciones("Hola @ana y @luis.perez, mira @nadie", {"ana", "luis.perez"}) == ["ana", "luis.perez"]
    assert chat.clave_directo(7, 2) == chat.clave_directo(2, 7) == "u:2-u:7"
    assert chat.entidad_valida("doc:95") and chat.entidad_valida("comision:educacion") and chat.entidad_valida("entrada:12")
    assert not chat.entidad_valida("doc") and not chat.entidad_valida("x:1") and not chat.entidad_valida("")


def test_permisos_por_clase_de_canal():
    admin, asesor, invitado = NS(rol="administrador"), NS(rol="asesor"), NS(rol="invitado")
    tema = NS(clase="tema", visibilidad="equipo", archivado=False)
    grupo = NS(clase="grupo", visibilidad="privado", archivado=False)
    archivado = NS(clase="tema", visibilidad="equipo", archivado=True)
    assert chat.puede_leer(tema, asesor, False) and chat.puede_escribir(tema, asesor, False)
    assert not chat.puede_leer(tema, invitado, True)
    assert not chat.puede_leer(grupo, asesor, False) and chat.puede_leer(grupo, asesor, True)
    assert chat.puede_leer(archivado, admin, False) and not chat.puede_escribir(archivado, admin, False)
    assert not chat.puede_leer(archivado, asesor, False)


