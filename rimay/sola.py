"""El chat SOLO: sin Qillqa y sin la base documental, con el anfitrión mínimo de Tiqsi (proyecto Rimay R3; fase 10.2b de
docs/plataforma/propuesta-repositorios.md, 2026-10-20).

    RIMAY_DATABASE_URL=postgresql+asyncpg://…/rimay  RIMAY_DIR=…  JWT_SECRET=<32 o más caracteres> \\
      .venv/bin/uvicorn rimay.sola:app --port 8033

Las cuentas viven en RIMAY_CUENTAS (por omisión <RIMAY_DIR>/cuentas.json) y se crean con
`python -m tiqsi.minimo cuenta <archivo> <usuario> --rol administrador --nombre …`; los archivos subidos, en
<RIMAY_DIR>/chat/. Sin Qillqa no hay avisos del sistema, ni «Registrar en …», ni comisiones, ni campana ni aviso push;
temas, grupos, directos, hilos, menciones, adjuntos, notas de voz, reacciones, encuestas, búsqueda y el canal en vivo
funcionan con lo suyo.
"""
from __future__ import annotations

import os
from pathlib import Path

from tiqsi.minimo import crear_app

from rimay.config import config
from rimay.manifiesto import MANIFIESTO

if not config.rimay_database_url:
    raise SystemExit("El chat solo necesita su base: RIMAY_DATABASE_URL.")
if not (os.environ.get("RIMAY_CUENTAS") or config.rimay_dir):
    raise SystemExit("El chat solo necesita dónde guardar sus cuentas y sus archivos: RIMAY_DIR (o RIMAY_CUENTAS).")

app = crear_app([MANIFIESTO], nombre="Chat", secreto=config.jwt_secret,
                cuentas=os.environ.get("RIMAY_CUENTAS") or Path(config.rimay_dir) / "cuentas.json",
                web=os.environ.get("RIMAY_WEB") or None)
