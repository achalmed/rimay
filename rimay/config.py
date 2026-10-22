"""La configuración PROPIA del chat (proyecto Rimay R3; fase 10.2b de docs/plataforma/propuesta-repositorios.md,
2026-10-20). Lee las mismas variables que Qillqa (DATABASE_URL, ZONA_HORARIA, MDD_DOCUMENTOS/MDD_RUTA, los nombres de
los temas propios de la entidad y el puente de Telegram) más las suyas: RIMAY_DATABASE_URL (vacía: la base documental,
como hasta hoy) y RIMAY_DIR (sola: su carpeta). No depende de `app.config`: viaja con el módulo.
"""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings


class ConfigRimay(BaseSettings):
    database_url: str = "postgresql+asyncpg://qillqa:qillqa@db:5432/qillqa"
    rimay_database_url: str = ""
    zona_horaria: str = "America/Lima"
    # Dónde viven los archivos subidos al chat (`chat/AAAA-MM/…`, relativos a esta raíz): la raíz documental de
    # siempre (MDD_DOCUMENTOS o <MDD_RUTA>/documentos) o, sola, RIMAY_DIR.
    mdd_ruta: str = "/framework"
    mdd_documentos: str = ""
    # Cuando corre SOLA (rimay/sola.py): su carpeta (sus archivos y las cuentas del anfitrión mínimo) y la firma
    # de las sesiones.
    rimay_dir: str = ""
    jwt_secret: str = ""
    # Los temas propios de la entidad: el lugar es genérico, el nombre llega del .env (nada de la entidad en el código).
    nombre_bancada: str = "Bancada"
    nombre_grupo_parlamentario: str = "Grupo parlamentario"
    nombre_programa_radio: str = "Programa de radio"
    # El puente con el grupo de Telegram (vacío = apagado).
    telegram_token: str = ""
    telegram_chat: str = ""
    telegram_usuario: str = ""


config = ConfigRimay()


def url_base() -> str:
    """La URL de su base: RIMAY_DATABASE_URL o, mientras no se separe, la documental."""
    return config.rimay_database_url or config.database_url


def raiz() -> Path:
    """La raíz de sus archivos: RIMAY_DIR (sola) o la raíz documental de Qillqa (la misma regla que app.config)."""
    if config.rimay_dir:
        return Path(config.rimay_dir)
    return Path(config.mdd_documentos) if config.mdd_documentos else Path(config.mdd_ruta) / "documentos"
