"""El manifiesto del chat (proyecto Rimay; fase 10.2b de docs/plataforma/propuesta-repositorios.md, 2026-10-20).

Ofrece «conversaciones.v1» (servicios/rimay_contrato.py). Aprovecha «redaccion.v1»: el texto con que el sistema
anuncia una tarea o una actividad y la tarjeta de los avisos viejos los compone Qillqa; sin él, el chat escribe el
anuncio corto. Y «registro.v1»: qué se reconoce en un mensaje (un prompt pegado), qué se ofrece con un archivo y
«Registrar en …» (Rimay R1b); sin él, el chat es solo conversación. Lo que Qillqa publica o pone al día en sus
canales le llega por el bus después de su commit (a lo sumo ~2 s).

Desde R2: el canal en vivo es `tiqsi.en_vivo` y el aviso al celular, «push.v1» de la plataforma; lo que avisa a la
campana (una mención, un directo) y los temas nuevos salen por su bandeja (`rimay_bandeja`); siembra sus temas al
arrancar; y el puente de Telegram es suyo (su tarea de fondo, solo con TELEGRAM_TOKEN): lo que trae lo registra
Qillqa por «registro.v1» con la cuenta de «identidad.v1».

Desde R3: su configuración (servicios/rimay_config.py), su sesión y su base (servicios/rimay_db.py: con
RIMAY_DATABASE_URL, la suya), su Base sin claves foráneas hacia Qillqa y sus ajustes (`rimay_ajustes`); las cuentas, por
«identidad.v1» (también la ficha del WebSocket); las comisiones, por «catalogos.v1»; los archivos, con `tiqsi.web`.
"""
from __future__ import annotations

from tiqsi import Manifiesto
from tiqsi.bandeja_sql import BandejaSQL

from rimay import api as chat
from rimay.modelos import BANDEJA
from rimay import db as rimay_db
from rimay.db import SesionRimay
from rimay import contrato as rimay_contrato

VERSION = "0.1.0"


async def _preparar_base(_anfitrion) -> None:
    """Su base (si falta), sus tablas y sus migraciones (R3)."""
    await rimay_db.preparar()


async def _sembrar(_anfitrion) -> None:
    """Sus temas de fábrica y uno por comisión, sembrados una vez (por clave); lo nuevo se cuenta a Qillqa por la bandeja."""
    from rimay import chat as svc_chat

    async with SesionRimay() as sesion:
        await svc_chat.sembrar_fabrica(sesion)


async def _telegram(_anfitrion) -> None:
    """Puente de Telegram (2026-10-12): solo con TELEGRAM_TOKEN; un fallo allá no toca la API."""
    from rimay import telegram as svc_telegram

    if svc_telegram.activo():
        await svc_telegram.bucle()


MANIFIESTO = Manifiesto(
    id="chat", nombre="Chat", version=VERSION, contrato="^0.1",
    routers=[chat.router], prefijos=("/api/chat",),
    necesita=("identidad.v1",), aprovecha=("redaccion.v1", "registro.v1", "etiquetas.v1", "push.v1", "catalogos.v1"),
    al_arrancar=[_preparar_base, _sembrar], tareas=[_telegram],
    bandeja=BandejaSQL(SesionRimay, BANDEJA),   # lo que avisa a la campana («aviso.nuevo»), tras su commit
    ofrece={"conversaciones.v1": rimay_contrato.CONVERSACIONES_V1},
    eventos={"conversaciones.publicar": [rimay_contrato.al_publicar],
             "conversaciones.actualizar": [rimay_contrato.al_actualizar],
             "referencias.reapuntar": [rimay_contrato.al_reapuntar]},
)
