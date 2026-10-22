"""rimay/modelos.py — tablas del CHAT institucional (2026-10-12, fase 8;
`docs/plataforma/propuesta-automatizacion.md` §5). Desde Rimay R3 (2026-10-20) con su propia Base (`BaseRimay`,
sin claves foráneas hacia Qillqa); las crea `servicios/rimay_db.py`, en su base o en la documental.

- `canales`: directo (dos personas), grupo (privado, por membresía) o tema (abierto a todo el
  equipo; puede estar ligado a una entidad del sistema, `pl:3`, `sr:2`, `comision:<clave>`, y
  tener un `padre_id` para subgrupos).
- `canal_miembros`: quién está, con qué papel, hasta dónde leyó (`ultimo_leido_id`) y si lo silenció.
- `mensajes`: texto, hilo (`padre_id`), menciones, `entidad` que presenta (`doc:95`),
  `evento_sistema_id` si lo publicó una regla, editado y eliminado (nada se borra).
- `mensaje_archivos`: lo adjunto REFERENCIA lo que entró por Recibidos o la Fototeca
  (`referencia` = `entrada:M` | `foto:N` | `doc:N`); lo que no es ni documento ni foto va como
  archivo propio (ruta relativa al archivo documental).
- `encuestas` y `encuesta_votos` (2026-10-12, fase 9.6): una encuesta va ligada a UN mensaje (su
  texto es la pregunta); los votos guardan quién votó aunque la encuesta sea anónima (para poder
  quitar el voto), pero la API no lo expone si `anonima`. `cierra_en` cierra sola al pasar la hora.
- `mensaje_archivos.duracion_ms`: la duración de una nota de voz (MediaRecorder no la escribe en el
  webm; la mide el navegador al grabar o `ffprobe` al subir).
- Visto y leído (2026-10-13): `canal_miembros.ultimo_recibido_id` (hasta dónde llegó a algún
  dispositivo de la persona: socket abierto, la lista de chats o el aviso push) junto a
  `ultimo_leido_id`; de ambos sale el ✓ / ✓✓ / ✓✓ leído de cada mensaje propio.
- `canales.categoria` (2026-10-13): la sección de la lista donde va un tema («Documentos»,
  «Agenda», «Legislativo», «Prensa y medios»…), como los temas de un foro.
- `mensajes.tarjeta` (2026-10-13): lo que el sistema publica se pinta como tarjeta ordenada
  ({que, icono, titulo, detalle, meta}); el texto sigue siendo la verdad para buscar y para la lista.
- Los dispositivos que reciben avisos push (`suscripciones_push`) son de la plataforma: `modelos_push.py`.
Búsqueda: índice GIN sobre `to_tsvector('spanish', texto)` (main.py).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from tiqsi.bandeja_sql import tabla_bandeja


class BaseRimay(DeclarativeBase):
    """Las tablas del chat (proyecto Rimay R3, fase 10.2b, 2026-10-20): su propia Base, SIN claves foráneas hacia
    Qillqa (la cuenta y el evento del sistema se guardan como número), para que vivan en su propia base
    (servicios/rimay_db.py)."""


class Canal(BaseRimay):
    __tablename__ = "canales"

    id: Mapped[int] = mapped_column(primary_key=True)
    despacho_id: Mapped[int] = mapped_column(Integer, default=1)
    clase: Mapped[str] = mapped_column(String(10), default="tema")          # directo | grupo | tema
    nombre: Mapped[str] = mapped_column(String(120), default="")
    descripcion: Mapped[str] = mapped_column(Text, default="")
    entidad: Mapped[str] = mapped_column(String(80), default="", index=True)  # pl:3, sr:2, comision:educacion…
    padre_id: Mapped[int | None] = mapped_column(ForeignKey("canales.id", ondelete="SET NULL"), nullable=True)
    visibilidad: Mapped[str] = mapped_column(String(10), default="equipo")  # equipo | privado
    # Clave de siembra de los canales de fábrica ('' = lo creó una persona) y clave única de un directo (`u:1-u:4`).
    clave: Mapped[str] = mapped_column(String(80), default="", index=True)
    # Sección de la lista (2026-10-13): Equipo, Documentos, Agenda, Legislativo, Prensa y medios… ('' = sin sección).
    categoria: Mapped[str] = mapped_column(String(30), default="")
    archivado: Mapped[bool] = mapped_column(default=False)
    creado_por: Mapped[int | None] = mapped_column(Integer, nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ultimo_mensaje_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CanalMiembro(BaseRimay):
    __tablename__ = "canal_miembros"
    __table_args__ = (UniqueConstraint("canal_id", "usuario_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    canal_id: Mapped[int] = mapped_column(ForeignKey("canales.id", ondelete="CASCADE"), index=True)
    usuario_id: Mapped[int] = mapped_column(Integer, index=True)
    papel: Mapped[str] = mapped_column(String(10), default="miembro")       # admin | miembro
    ultimo_leido_id: Mapped[int] = mapped_column(Integer, default=0)
    # Hasta dónde llegó a un dispositivo de la persona (2026-10-13): el segundo ✓ de lo enviado.
    ultimo_recibido_id: Mapped[int] = mapped_column(Integer, default=0)
    silenciado_hasta: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    unido_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Mensaje(BaseRimay):
    __tablename__ = "mensajes"

    id: Mapped[int] = mapped_column(primary_key=True)
    canal_id: Mapped[int] = mapped_column(ForeignKey("canales.id", ondelete="CASCADE"), index=True)
    autor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # NULL = el sistema
    padre_id: Mapped[int | None] = mapped_column(ForeignKey("mensajes.id", ondelete="SET NULL"), nullable=True, index=True)
    # Respuesta citada (2026-10-19, Edison: «en los chats personales las respuestas como en WhatsApp,
    # sin generar hilo»): el mensaje al que responde, mostrado citado en la misma conversación.
    responde_a_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    texto: Mapped[str] = mapped_column(Text, default="")
    menciones: Mapped[list] = mapped_column(JSONB, default=list)
    entidad: Mapped[str] = mapped_column(String(80), default="", index=True)
    evento_sistema_id: Mapped[int | None] = mapped_column(Integer, nullable=True)   # el evento de Qillqa que lo publicó
    # Acciones que el mensaje automático ofrece: [{"texto": "Abrir", "ruta": "/recibidos?ver=12"}].
    acciones: Mapped[list] = mapped_column(JSONB, default=list)
    respuestas: Mapped[int] = mapped_column(Integer, default=0)
    # Tarjeta de un mensaje del sistema (2026-10-13): {que, icono, titulo, detalle, meta}; {} = texto llano.
    tarjeta: Mapped[dict] = mapped_column(JSONB, default=dict)
    editado_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    eliminado_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class MensajeArchivo(BaseRimay):
    __tablename__ = "mensaje_archivos"

    id: Mapped[int] = mapped_column(primary_key=True)
    mensaje_id: Mapped[int] = mapped_column(ForeignKey("mensajes.id", ondelete="CASCADE"), index=True)
    referencia: Mapped[str] = mapped_column(String(80), default="")       # entrada:M | foto:N | doc:N
    archivo: Mapped[str] = mapped_column(String(500), default="")        # ruta relativa, si no es referencia
    nombre: Mapped[str] = mapped_column(String(300), default="")
    bytes: Mapped[int] = mapped_column(Integer, default=0)
    sha256: Mapped[str] = mapped_column(String(64), default="")
    duracion_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)   # notas de voz (ALTER en rimay_db.py)


class MensajeReaccion(BaseRimay):
    __tablename__ = "mensaje_reacciones"
    __table_args__ = (UniqueConstraint("mensaje_id", "usuario_id", "emoji"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    mensaje_id: Mapped[int] = mapped_column(ForeignKey("mensajes.id", ondelete="CASCADE"), index=True)
    usuario_id: Mapped[int] = mapped_column(Integer)
    emoji: Mapped[str] = mapped_column(String(16))
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Encuesta(BaseRimay):
    __tablename__ = "encuestas"

    id: Mapped[int] = mapped_column(primary_key=True)
    mensaje_id: Mapped[int] = mapped_column(ForeignKey("mensajes.id", ondelete="CASCADE"), unique=True, index=True)
    pregunta: Mapped[str] = mapped_column(String(300))
    opciones: Mapped[list] = mapped_column(JSONB, default=list)               # ["Lunes", "Martes", …] (2 a 10)
    multiple: Mapped[bool] = mapped_column(Boolean, default=False)
    anonima: Mapped[bool] = mapped_column(Boolean, default=False)
    cierra_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cerrada: Mapped[bool] = mapped_column(Boolean, default=False)
    creado_por: Mapped[int | None] = mapped_column(Integer, nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EncuestaVoto(BaseRimay):
    __tablename__ = "encuesta_votos"
    __table_args__ = (UniqueConstraint("encuesta_id", "usuario_id", "opcion"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    encuesta_id: Mapped[int] = mapped_column(ForeignKey("encuestas.id", ondelete="CASCADE"), index=True)
    usuario_id: Mapped[int] = mapped_column(Integer)
    opcion: Mapped[int] = mapped_column(Integer)                                # índice en `opciones`
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AjusteRimay(BaseRimay):
    """Los ajustes del chat (R3): los temas de fábrica ya sembrados («chat_canales_fabrica») y hasta dónde leyó el
    puente de Telegram («telegram_offset»). Antes vivían en `ajustes` de la plataforma; se copian aquí una vez."""

    __tablename__ = "rimay_ajustes"

    clave: Mapped[str] = mapped_column(String(60), primary_key=True)
    valor: Mapped[dict] = mapped_column(JSONB, default=dict)


# Su bandeja de salida (Rimay R2, 2026-10-20): lo que el chat avisa a la campana («aviso.nuevo»: una mención, un
# directo) y los temas nuevos se anotan en su transacción y Qillqa los recibe por el bus tras el commit.
BANDEJA = tabla_bandeja(BaseRimay.metadata, "rimay_bandeja")
