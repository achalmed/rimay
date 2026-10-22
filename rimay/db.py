"""La base del chat: su motor, su sesión y la preparación de sus tablas (proyecto Rimay R3; fase 10.2b, 2026-10-20).
Con RIMAY_DATABASE_URL, su base propia (nace al arrancar si falta); sin ella, la documental.

Separar sus datos de la base documental es una orden del módulo (simula por omisión; tiqsi.sql.separar copia y verifica
cada tabla). Lee el origen de DATABASE_URL y el destino de RIMAY_DATABASE_URL:

    python -m rimay.db separar             # qué copiaría (filas y huella por tabla)
    python -m rimay.db separar --aplicar   # copia, verifica y trae sus ajustes de `ajustes`

Sus ajustes («chat_canales_fabrica»: los temas ya sembrados; «telegram_offset»: hasta dónde leyó el puente) vivían en
`ajustes` de la plataforma: se copian a los suyos (allá se dejan: nadie más los lee).
"""
from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from rimay.config import url_base

motor = create_async_engine(url_base(), pool_pre_ping=True)
SesionRimay = async_sessionmaker(motor, expire_on_commit=False)

AJUSTES = ("chat_canales_fabrica", "telegram_offset")

# Migraciones ligeras e idempotentes (antes en main.py): lo que `create_all` no altera en tablas ya existentes y los
# índices que el modelo no declara. Sin claves foráneas hacia Qillqa.
MIGRACIONES = (
    # La respuesta citada en los directos, sin hilo (2026-10-19).
    "ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS responde_a_id integer",
    # Búsqueda de texto completo en español y la lista de un canal (2026-10-12).
    "CREATE INDEX IF NOT EXISTS mensajes_texto_idx ON mensajes USING gin (to_tsvector('spanish', texto))",
    "CREATE INDEX IF NOT EXISTS mensajes_canal_id_idx ON mensajes (canal_id, id DESC)",
    # Notas de voz (2026-10-12, fase 9.6): duración medida al grabar o con ffprobe.
    "ALTER TABLE mensaje_archivos ADD COLUMN IF NOT EXISTS duracion_ms integer",
    # Un canal por (clase, clave) (2026-10-12): dos peticiones a la vez crearon dos directos `u:1-u:3`. Antes del
    # índice único se FUSIONAN los repetidos en el más viejo: sus mensajes y sus integrantes pasan a él y el repetido
    # queda archivado con la clave `…#dup<id>` (nada se borra). Idempotente: sin repetidos, no tocan nada.
    *(f"WITH d AS (SELECT id, MIN(id) OVER (PARTITION BY clase, clave) AS queda FROM canales WHERE clave <> '') {q}" for q in (
        "UPDATE mensajes m SET canal_id = d.queda FROM d WHERE m.canal_id = d.id AND d.id <> d.queda",
        "INSERT INTO canal_miembros (canal_id, usuario_id, papel, ultimo_leido_id, silenciado_hasta, unido_en) "
        "SELECT d.queda, cm.usuario_id, cm.papel, cm.ultimo_leido_id, cm.silenciado_hasta, cm.unido_en "
        "FROM canal_miembros cm JOIN d ON cm.canal_id = d.id AND d.id <> d.queda ON CONFLICT (canal_id, usuario_id) DO NOTHING",
        "UPDATE canales c SET archivado = true, clave = left(c.clave, 60) || '#dup' || c.id FROM d WHERE c.id = d.id AND d.id <> d.queda",
    )),
    "CREATE UNIQUE INDEX IF NOT EXISTS canales_clase_clave_unica ON canales (clase, clave) WHERE clave <> ''",
    # Visto y leído, secciones de temas y tarjetas del sistema (2026-10-13).
    "ALTER TABLE canal_miembros ADD COLUMN IF NOT EXISTS ultimo_recibido_id integer NOT NULL DEFAULT 0",
    "UPDATE canal_miembros SET ultimo_recibido_id = ultimo_leido_id WHERE ultimo_recibido_id < ultimo_leido_id",
    "ALTER TABLE canales ADD COLUMN IF NOT EXISTS categoria varchar(30) NOT NULL DEFAULT ''",
    "ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS tarjeta jsonb NOT NULL DEFAULT '{}'::jsonb",
    # Recibidos pasa a llamarse «Mesa de Partes» (2026-10-13): el tema de fábrica, si conserva su nombre.
    "UPDATE canales SET nombre = 'Mesa de Partes', descripcion = 'Lo que llega a Mesa de Partes: cada documento "
    "nuevo, su responsable y su plazo (lo publica el sistema).' WHERE clase = 'tema' AND clave = 'recibidos' AND nombre = 'Recibidos'",
)


async def obtener_sesion_rimay() -> AsyncGenerator[AsyncSession, None]:
    """Dependencia de FastAPI: una sesión de la base del chat, siempre cerrada."""
    async with SesionRimay() as sesion:
        yield sesion


class SinSeparar(SystemExit):
    """Su base propia está vacía y la documental aún tiene sus datos: arrancar así sembraría un chat nuevo."""


async def _sin_separar() -> bool:
    """¿Su base es otra, está vacía y la documental aún tiene canales? Solo si DATABASE_URL está definida (sola, no)."""
    import os

    from rimay.config import config

    if not config.rimay_database_url or "DATABASE_URL" not in os.environ or config.rimay_database_url == config.database_url:
        return False
    try:
        async with motor.connect() as c:
            if (await c.execute(text("SELECT to_regclass('canales')"))).scalar() and \
                    (await c.execute(text("SELECT count(*) FROM canales"))).scalar():
                return False
        documental = create_async_engine(config.database_url)
        try:
            async with documental.connect() as c:
                return bool((await c.execute(text("SELECT to_regclass('canales')"))).scalar()
                            and (await c.execute(text("SELECT count(*) FROM canales"))).scalar())
        finally:
            await documental.dispose()
    except Exception:  # noqa: BLE001 — sin la documental a la vista no hay nada que proteger
        return False


async def preparar() -> None:
    """Su base (si falta), sus tablas, sus migraciones y, en la misma base que la plataforma, sus ajustes (idempotente).
    Se NIEGA a arrancar sobre su base propia vacía si la documental aún tiene sus datos (separe primero)."""
    from tiqsi.sql import crear_base_si_falta

    from rimay.modelos import BaseRimay

    await crear_base_si_falta(motor.url)
    if await _sin_separar():
        raise SinSeparar("La base del chat está vacía y la documental aún tiene sus canales: sepárela primero "
                         "(python -m rimay.db separar --aplicar).")
    async with motor.begin() as conexion:
        await conexion.run_sync(BaseRimay.metadata.create_all)
        for sql in MIGRACIONES:
            await conexion.execute(text(sql))
        if (await conexion.execute(text("SELECT to_regclass('ajustes')"))).scalar():
            await conexion.execute(text(
                "INSERT INTO rimay_ajustes (clave, valor) SELECT clave, valor FROM ajustes "
                "WHERE despacho_id = 1 AND clave = ANY(:claves) ON CONFLICT (clave) DO NOTHING"), {"claves": list(AJUSTES)})


async def separar(aplicar: bool = False) -> dict:
    """Sus tablas, de la base documental (DATABASE_URL) a la suya (RIMAY_DATABASE_URL), y sus ajustes."""
    import json

    from tiqsi.sql import crear_base_si_falta, separar as separar_tablas

    from rimay.modelos import BaseRimay
    from rimay.config import config

    if not config.rimay_database_url:
        raise SystemExit("Falta RIMAY_DATABASE_URL (la base propia del chat).")
    if aplicar:
        await crear_base_si_falta(motor.url)
    plan = await separar_tablas(config.database_url, config.rimay_database_url, BaseRimay.metadata, aplicar=aplicar)
    origen = create_async_engine(config.database_url)
    try:
        async with origen.connect() as o:
            ajustes = ((await o.execute(text("SELECT clave, valor FROM ajustes WHERE despacho_id = 1 AND clave = ANY(:c) ORDER BY clave"),
                                        {"c": list(AJUSTES)})).all()
                       if (await o.execute(text("SELECT to_regclass('ajustes')"))).scalar() else [])
        plan["(ajustes → rimay_ajustes)"] = {"filas": len(ajustes), "huella": "-"}
        if not aplicar:
            return plan
        async with motor.begin() as d:
            for clave, valor in ajustes:
                await d.execute(text("INSERT INTO rimay_ajustes (clave, valor) VALUES (:c, CAST(:v AS jsonb)) ON CONFLICT (clave) DO NOTHING"),
                                {"c": clave, "v": json.dumps(valor)})
            copiados = (await d.execute(text("SELECT count(*) FROM rimay_ajustes WHERE clave = ANY(:c)"), {"c": [a[0] for a in ajustes]})).scalar()
        if copiados != len(ajustes):
            raise SystemExit(f"Solo {copiados} de {len(ajustes)} ajustes llegaron.")
    finally:
        await origen.dispose()
    return plan


def _principal(argv: list[str]) -> int:
    import argparse
    import asyncio

    from tiqsi.sql import ErrorDeSeparacion

    p = argparse.ArgumentParser(prog="python -m rimay.db", description="La base propia del chat.")
    sub = p.add_subparsers(dest="orden", required=True)
    s = sub.add_parser("separar", help="sus tablas a su base (simula sin --aplicar)")
    s.add_argument("--aplicar", action="store_true")
    a = p.parse_args(argv)
    try:
        plan = asyncio.run(separar(a.aplicar))
    except ErrorDeSeparacion as e:
        print(f"[error] {e}")
        return 1
    for tabla, d in plan.items():
        print(f"  {tabla:<30} {d['filas']:>6} filas  {d['huella'][:12]}")
    print("Copiado y verificado." if a.aplicar else "Simulación: nada se copió (--aplicar para hacerlo).")
    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(_principal(sys.argv[1:]))
