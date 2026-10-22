"""tests/test_chat_encuestas.py — reglas puras de lo que el chat suma en la fase 9.6
(servicios/chat.py): encuestas (opciones, votar o quitar el voto, resumen con porcentaje y
anonimato, cierre por hora), notas de voz (cómo se reconocen y con qué tipo se sirven), la
vista previa de la lista de chats, el anuncio de una tarea o actividad creada desde el chat y
que el chat reconozca TODOS los formatos de `esquemas/pegado/*.yml`.
Sin base de datos. Uso: cd backend && .venv/bin/python -m pytest -q tests/test_chat_encuestas.py
"""
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace as NS

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x:y@127.0.0.1/z")
os.environ.setdefault("JWT_SECRET", "prueba")

from rimay import chat  # noqa: E402


def test_opciones_limpias_sin_repetidas_y_entre_dos_y_diez():
    assert chat.limpiar_opciones(["  Lunes ", "martes", "Lunes", "", "lunes"]) == ["Lunes", "martes"]
    with pytest.raises(ValueError):
        chat.limpiar_opciones(["Sí", "sí", " "])
    with pytest.raises(ValueError):
        chat.limpiar_opciones([f"Opción {i}" for i in range(11)])
    assert len(chat.limpiar_opciones([f"Opción {i}" for i in range(10)])) == 10


def test_votar_cambiar_y_quitar_en_respuesta_unica():
    assert chat.aplicar_voto(set(), 1, False, 3) == {1}
    assert chat.aplicar_voto({1}, 2, False, 3) == {2}        # tocar otra cambia el voto
    assert chat.aplicar_voto({2}, 2, False, 3) == set()      # tocar la mía la quita
    with pytest.raises(ValueError):
        chat.aplicar_voto(set(), 3, False, 3)
    with pytest.raises(ValueError):
        chat.aplicar_voto(set(), -1, False, 3)


def test_votar_varias_respuestas_suma_y_alterna():
    assert chat.aplicar_voto({0}, 2, True, 3) == {0, 2}
    assert chat.aplicar_voto({0, 2}, 0, True, 3) == {2}


def _encuesta(**k):
    base = dict(id=7, mensaje_id=70, pregunta="¿Qué día?", opciones=["Lunes", "Martes", "Miércoles"], multiple=False,
                anonima=False, cierra_en=None, cerrada=False, creado_por=1)
    base.update(k)
    return NS(**base)


def test_resumen_con_porcentaje_sobre_quienes_votaron_y_la_mia():
    votos = [(1, 0), (2, 0), (3, 1), (3, 2)]  # 3 personas; la 3 votó dos (encuesta de varias)
    r = chat.resumen_encuesta(_encuesta(multiple=True), votos, {1: "Ana", 2: "Luis", 3: "Eva"}, yo=3)
    assert r["votantes"] == 3
    assert [o["votos"] for o in r["opciones"]] == [2, 1, 1]
    assert [o["porcentaje"] for o in r["opciones"]] == [67, 33, 33]
    assert [o["mia"] for o in r["opciones"]] == [False, True, True]
    assert [v["nombre"] for v in r["opciones"][0]["votantes"]] == ["Ana", "Luis"]


def test_resumen_anonimo_no_dice_quien_y_sin_votos_da_cero():
    r = chat.resumen_encuesta(_encuesta(anonima=True), [(1, 0), (2, 1)], {1: "Ana", 2: "Luis"}, yo=1)
    assert all(o["votantes"] == [] for o in r["opciones"]) and r["opciones"][0]["mia"]
    vacia = chat.resumen_encuesta(_encuesta(), [], {}, yo=None)
    assert vacia["votantes"] == 0 and all(o["porcentaje"] == 0 and not o["mia"] for o in vacia["opciones"])


def test_cierre_a_mano_o_al_pasar_la_hora():
    ahora = datetime(2026, 10, 12, 15, 0, tzinfo=timezone.utc)
    assert chat.encuesta_cerrada(True, None, ahora)
    assert not chat.encuesta_cerrada(False, None, ahora)
    assert chat.encuesta_cerrada(False, ahora - timedelta(minutes=1), ahora)
    assert not chat.encuesta_cerrada(False, ahora + timedelta(hours=1), ahora)
    r = chat.resumen_encuesta(_encuesta(cierra_en=ahora - timedelta(seconds=1)), [], {}, None, ahora)
    assert r["cerrada"] is True


def test_nota_de_voz_y_su_tipo():
    assert chat.es_nota_de_voz("nota-de-voz-20261012-101500.webm") and chat.es_nota_de_voz("Nota-de-voz-1.m4a")
    assert not chat.es_nota_de_voz("reunion.webm") and not chat.es_nota_de_voz("nota-de-voz.pdf")
    assert chat.tipo_de_archivo("nota-de-voz-1.webm") == "audio/webm"
    assert chat.tipo_de_archivo("reunion.webm") == "video/webm"   # un video webm sigue siendo video
    assert chat.tipo_de_archivo("nota-de-voz-1.m4a") == "audio/mp4"
    assert chat.tipo_de_archivo("audio.opus") == "audio/ogg"
    assert chat.tipo_de_archivo("x.desconocido") == "application/octet-stream"
    # Una nota de voz no ofrece «Guardar en la Mediateca» (un .webm cualquiera, sí: es un video).
    assert chat.acciones_de_archivo(NS(id=1, nombre="nota-de-voz-1.webm")) == []


def test_vista_previa_de_la_lista():
    assert chat.vista_previa("¿Qué día?", encuesta=True) == "Encuesta: ¿Qué día?"
    assert chat.vista_previa("", "nota-de-voz-1.webm") == "Nota de voz"
    assert chat.vista_previa("", "oficio.pdf") == "oficio.pdf"
    assert chat.vista_previa("Hola", "oficio.pdf") == "Hola"


def test_anuncio_de_tarea_y_de_actividad():
    assert chat.texto_anuncio("tarea", "Revisar el oficio", "lun 14/10", "Ana") == "Tarea creada: Revisar el oficio · vence lun 14/10 · Ana"
    assert chat.texto_anuncio("tarea", "Llamar") == "Tarea creada: Llamar"
    assert chat.texto_anuncio("evento", "Comisión", "mar 15/10 10:00", lugar="Sala 2") == "Actividad agendada: Comisión · mar 15/10 10:00 · Sala 2"
    lima = chat.cuando_legible(datetime(2026, 10, 14, 15, 30, tzinfo=timezone.utc))  # 10:30 en Lima
    assert lima == "mié 14/10 10:30"
    assert chat.cuando_legible(datetime(2026, 10, 14, 15, 30, tzinfo=timezone.utc), con_hora=False) == "mié 14/10"
    assert chat.cuando_legible(None) == ""


