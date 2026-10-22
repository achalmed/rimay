"""tests/test_rimay.py — el chat detrás de su contrato (proyecto Rimay R1; fase 10.2b, 2026-10-20): lo que el
sistema dice en el chat lo compone Qillqa (servicios/avisos_chat.py) y sale por su bandeja de salida; el chat lo
publica o lo pone al día tras el commit (servicios/rimay_contrato.py). Sin base de datos.
"""
import asyncio
import os
from types import SimpleNamespace as NS

os.environ.setdefault("JWT_SECRET", "x" * 40)

from rimay import chat


class _Conversaciones:
    def __init__(self, canales=None, mensajes=None):
        self.canales, self.mensajes = canales or {}, mensajes or []

    async def canal(self, destino):
        return self.canales.get(destino)

    async def del_sistema(self, entidad):
        return [m for m in self.mensajes if entidad is None or m["entidad"] == entidad]


class _Anidada:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class _Sesion:
    def begin_nested(self):
        return _Anidada()


def test_el_contrato_del_chat_solo_ofrece_lo_suyo():
    import pytest

    from rimay import contrato as rimay_contrato

    c = rimay_contrato.CONVERSACIONES_V1
    assert sorted(dir(c)) == ["actualizar", "acuse", "canal", "del_sistema", "publicar_sistema", "telegram", "telegram_activo"]
    with pytest.raises(AttributeError):
        c.publicar   # lo de dentro (con su sesión) no es parte del contrato


def test_lo_que_el_chat_avisa_a_la_campana_sale_por_su_bandeja(monkeypatch):
    """R2: una mención o un directo se anota en la bandeja del chat («aviso.nuevo»); Qillqa lo pone en la campana tras
    el commit, como lo de Tareas y Agenda. Nadie se avisa a sí mismo."""
    guardados = []

    async def guardar(sesion, tabla, tipo, datos, origen=""):
        guardados.append((tabla.name, tipo, datos, origen))

    monkeypatch.setattr(chat, "guardar", guardar)
    asyncio.run(chat.avisar_en_la_campana(None, 7, "Ana le mencionó en General: hola", "mencion", evitar=3, destino="chat:2:40"))
    asyncio.run(chat.avisar_en_la_campana(None, 3, "a sí misma", "chat", evitar=3))
    asyncio.run(chat.avisar_en_la_campana(None, None, "a nadie", "chat"))
    assert guardados == [("rimay_bandeja", "aviso.nuevo", {"usuario_id": 7, "texto": "Ana le mencionó en General: hola", "tipo": "mencion",
                                                          "destino": "chat:2:40"}, "chat")]


def test_los_temas_nuevos_se_cuentan_a_qillqa(monkeypatch):
    """R2: al sembrar, el chat pone al día la descripción de su tema y cuenta los temas nuevos por su bandeja; las
    reglas de fábrica las ordena Qillqa (avisos_chat.al_sembrar_temas)."""
    guardados, sentencias = [], []

    async def guardar(sesion, tabla, tipo, datos, origen=""):
        guardados.append((tipo, datos))

    class Sesion:
        async def execute(self, s):
            sentencias.append(str(s))

    monkeypatch.setattr(chat, "guardar", guardar)
    asyncio.run(chat._ordenar_temas_viejos(Sesion(), {"noticias", "documentos-listos"}))
    assert guardados == [("conversaciones.temas_nuevos", {"claves": ["documentos-listos", "noticias"]})]
    assert len(sentencias) == 1 and "UPDATE canales" in sentencias[0]
    guardados.clear()
    asyncio.run(chat._ordenar_temas_viejos(Sesion(), set()))
    assert guardados == []


def test_el_puente_de_telegram_registra_con_la_cuenta_de_identidad(monkeypatch):
    from rimay import telegram
    from tiqsi import modulo

    cuentas = [{"id": 1, "usuario": "ana", "rol": "administrador", "activo": False},
               {"id": 2, "usuario": "bot", "rol": "asesor", "activo": True},
               {"id": 3, "usuario": "luis", "rol": "administrador", "activo": True}]

    class Identidad:
        async def cuentas(self):
            return cuentas

    monkeypatch.setattr(modulo, "opcional", lambda nombre: Identidad() if nombre == "identidad.v1" else None)
    monkeypatch.setattr(telegram.config, "telegram_usuario", "bot")
    assert asyncio.run(telegram._usuario_bot()) == 2
    monkeypatch.setattr(telegram.config, "telegram_usuario", "")
    assert asyncio.run(telegram._usuario_bot()) == 3          # el primer administrador ACTIVO
    assert telegram.clasificar("oficio.pdf", False) == ""     # sin «registro.v1», el puente solo envía
