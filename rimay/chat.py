"""rimay/chat.py — reglas y base del CHAT institucional (2026-10-12, fase 8;
`docs/plataforma/propuesta-automatizacion.md` §5; tablas en `modelos_chat.py`).

Permisos (los del sistema, sin uno nuevo): un canal `tema` de visibilidad `equipo` lo lee y
escribe todo el equipo (los módulos no se asignan por rol); `grupo` y `directo` solo sus
miembros; `invitado` no entra al chat. El administrador crea, archiva y administra los temas.
Las reglas puras (menciones, nombre del directo, texto de un mensaje automático) se prueban en
`backend/tests/test_chat.py`.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from sqlalchemy import func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from tiqsi.modulo import Perezosa
from tiqsi.puertos import Usuario

from rimay.modelos import BANDEJA, AjusteRimay, Canal, CanalMiembro, Mensaje, MensajeArchivo, MensajeReaccion
from rimay.config import config, raiz

# Las cuentas (nombres, quién está activo, a quién se menciona) son del anfitrión: «identidad.v1» (Rimay R3).
identidad = Perezosa("identidad.v1")


async def cuentas() -> list[dict]:
    """Las cuentas del anfitrión {id, usuario, nombre_completo, nombres, cargo, dni, rol, activo}, en orden de id."""
    return list(await identidad.cuentas())


def nombre_de(c: dict) -> str:
    return c.get("nombre_completo") or c.get("usuario") or ""


def es_del_equipo(c: dict) -> bool:
    """Activa y no invitada: con quien se chatea y a quien se le difunde un tema del equipo."""
    return bool(c.get("activo")) and c.get("rol") != "invitado"
from tiqsi import en_vivo as difusor
from tiqsi.bandeja_sql import guardar

log = logging.getLogger("qillqa.chat")

CLASES = ("directo", "grupo", "tema")
VISIBILIDADES = ("equipo", "privado")
_MENCION = re.compile(r"(?<![\w.])@([a-z0-9][a-z0-9._-]{1,48})", re.IGNORECASE)
_ENTIDAD = re.compile(r"^(doc|entrada|pl|sr|tarea|evento|persona|inst|foto|pedido|comision):[\w-]{1,40}$")

# Canales de fábrica: temas del equipo, sembrados una vez (clave en `ajustes.chat_canales_fabrica`).
FABRICA = [
    {"clave": "general", "nombre": "General", "descripcion": "Lo que es de todos: avisos de la entidad, coordinación del día."},
    {"clave": "recibidos", "nombre": "Mesa de Partes", "descripcion": "Lo que llega a Mesa de Partes: cada documento nuevo, su responsable y su plazo (lo publica el sistema)."},
    {"clave": "documentos", "nombre": "Documentos", "descripcion": "Oficios numerados, firmados y enviados (lo publica el sistema)."},
    {"clave": "agenda", "nombre": "Agenda", "descripcion": "Eventos agendados y recordatorios (lo publica el sistema)."},
    {"clave": "proyectos", "nombre": "Proyectos de ley", "descripcion": "Partes aprobadas, fases hechas."},
    {"clave": "representacion", "nombre": "Semana de representación", "descripcion": "Actividades, pedidos y oficios de la Semana."},
    {"clave": "prensa", "nombre": "Prensa", "descripcion": "Piezas, publicaciones y materiales."},
    {"clave": "comisiones", "nombre": "Comisiones", "descripcion": "Un canal por comisión: citaciones, agendas, dictámenes y acuerdos."},
]
# Temas nuevos (2026-10-13, «temáticas de Telegram»): los GENÉRICOS que el despacho usaba en Telegram y
# que el sistema puede llenar solo (reglas de `eventos_sistema.FABRICA`) o que ordenan la conversación.
# Lo propio de la entidad (su bancada, su grupo parlamentario, su programa) va en `temas_propios`, con
# el nombre del .env. Se siembran una vez, por clave, como los de arriba.
FABRICA += [
    {"clave": "documentos-listos", "nombre": "Documentos listos", "descripcion": "Lo firmado, listo para enviar (lo publica el sistema)."},
    {"clave": "documentos-enviados", "nombre": "Documentos enviados", "descripcion": "Lo que salió de la entidad (lo publica el sistema)."},
    {"clave": "seguimiento", "nombre": "Seguimiento de documentos", "descripcion": "Actuaciones del seguimiento y respuestas a lo enviado (lo publica el sistema)."},
    {"clave": "borradores", "nombre": "Borradores y revisión", "descripcion": "Lo que pasa a revisión u observado (lo publica el sistema) y los borradores que se comentan entre todos."},
    {"clave": "programacion", "nombre": "Programación del día", "descripcion": "Cada mañana, las actividades del día (lo publica el sistema)."},
    {"clave": "reuniones", "nombre": "Reuniones y acuerdos", "descripcion": "Documentos, actas y acuerdos después de cada reunión."},
    {"clave": "pleno", "nombre": "Pleno", "descripcion": "Sesiones del Pleno: agenda, citaciones y votaciones (lo agendado como Pleno lo publica el sistema)."},
    {"clave": "noticias", "nombre": "Noticias", "descripcion": "Noticias locales, nacionales e internacionales (las piezas de Prensa de esa clase las publica el sistema)."},
    {"clave": "fotos", "nombre": "Fotos y videos", "descripcion": "Fotos y videos de las actividades; desde aquí se guardan en la Mediateca."},
    {"clave": "atencion", "nombre": "Atención ciudadana", "descripcion": "Pedidos de la ciudadanía y acceso a la información pública."},
]
# Temas PROPIOS de la entidad (2026-10-18, Edison: «crear los temas propios de la entidad: la bancada, el
# grupo parlamentario, el programa de radio y Denuncias»). El lugar es genérico; el NOMBRE con que el
# despacho los llama llega del .env (NOMBRE_BANCADA, NOMBRE_GRUPO_PARLAMENTARIO, NOMBRE_PROGRAMA_RADIO):
# nada de la entidad en el código (D13). Se siembran una vez, por clave; después se renombran en la web.


def temas_propios() -> list[dict]:
    return [
        {"clave": "bancada", "nombre": config.nombre_bancada or "Bancada",
         "descripcion": "La bancada: acuerdos, posiciones, votaciones y comunicados que se coordinan."},
        {"clave": "grupo-parlamentario", "nombre": config.nombre_grupo_parlamentario or "Grupo parlamentario",
         "descripcion": "El grupo parlamentario: convocatorias, agenda, vocerías y decisiones del grupo."},
        {"clave": "radio", "nombre": config.nombre_programa_radio or "Programa de radio",
         "descripcion": "El programa de radio: temas de la semana, invitados, guion y transmisión."},
        {"clave": "denuncias", "nombre": "Denuncias",
         "descripcion": "Denuncias de la ciudadanía: cada caso, sus pruebas y lo que se hace (fiscalización, oficios)."},
    ]
# Sección de la lista de cada tema de fábrica (`canales.categoria`). Lo que crea quien administra elige
# la suya; un tema sin sección va a «Otros temas». `mesa-de-partes` por si el canal cambia de clave.
CATEGORIAS = ("Equipo", "Documentos", "Agenda", "Legislativo", "Prensa y medios", "Representación")
CATEGORIA_FABRICA = {
    "general": "Equipo", "atencion": "Representación", "representacion": "Representación",
    "recibidos": "Documentos", "mesa-de-partes": "Documentos", "documentos": "Documentos", "documentos-listos": "Documentos",
    "documentos-enviados": "Documentos", "seguimiento": "Documentos", "borradores": "Documentos",
    "agenda": "Agenda", "programacion": "Agenda", "reuniones": "Agenda",
    "proyectos": "Legislativo", "pleno": "Legislativo", "comisiones": "Legislativo",
    "prensa": "Prensa y medios", "noticias": "Prensa y medios", "fotos": "Prensa y medios",
    "bancada": "Legislativo", "grupo-parlamentario": "Legislativo", "radio": "Prensa y medios", "denuncias": "Representación",
}
EMOJIS = ("👍", "❤️", "👏", "✅", "👀", "😂", "🙏", "⚠️")


def slug(texto: str) -> str:
    """«Comisión de Educación, Cultura y Deporte» → `educacion-cultura-y-deporte`. Minúsculas sin tildes ni signos,
    con la misma regla que `entradas.normalizar` de Mesa de Partes (aquí, una copia: el chat no la importa)."""
    import unicodedata

    t = unicodedata.normalize("NFKD", (texto or "").replace("º", "°")).encode("ascii", "ignore").decode().lower()
    n = re.sub(r"^comision de ", "", re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", t)).strip()).strip()
    return re.sub(r"[^a-z0-9ñ]+", "-", n).strip("-")[:60]


# --- puras -----------------------------------------------------------------------------------


def menciones(texto: str, usuarios_validos: set[str]) -> list[str]:
    vistos: list[str] = []
    for m in _MENCION.finditer(texto or ""):
        u = m.group(1).lower().rstrip(".")
        if u in usuarios_validos and u not in vistos:
            vistos.append(u)
    return vistos


# El chat de uno mismo (2026-10-19, Edison: «un chat personal donde guarde información, como en
# Telegram o WhatsApp»): un directo cuyas dos puntas son la misma persona.
NOTAS_PROPIAS = "Mis notas"


def clave_directo(a: int, b: int) -> str:
    x, y = sorted((int(a), int(b)))
    return f"u:{x}-u:{y}"


def entidad_valida(entidad: str) -> bool:
    return bool(_ENTIDAD.match(entidad or ""))


def puede_leer(canal: Canal, usuario: Usuario, es_miembro: bool) -> bool:
    if usuario.rol == "invitado" or canal.archivado and not es_miembro and usuario.rol != "administrador":
        return False
    if canal.clase == "tema" and canal.visibilidad == "equipo":
        return True
    return es_miembro or (canal.clase == "tema" and usuario.rol == "administrador")


def puede_escribir(canal: Canal, usuario: Usuario, es_miembro: bool) -> bool:
    return puede_leer(canal, usuario, es_miembro) and not canal.archivado


async def nombres_vigentes(claves: set[str]) -> dict[str, str]:
    """El nombre legible y vigente de lo vinculado («doc:12» → «Oficio N° 0012-… — Asunto»), por «etiquetas.v1»
    del anfitrión (Rimay R1); lo que no se resuelve no aparece y se muestra la clave."""
    from tiqsi.modulo import opcional

    etiquetas = opcional("etiquetas.v1")
    return await etiquetas.de(set(claves)) if etiquetas is not None and claves else {}


def tarjeta_anuncio(texto: str) -> dict:
    """La tarjeta del anuncio corto que el chat escribe cuando alguien crea una tarea o agenda una actividad
    («Tarea creada: Revisar · vence lun 14/10 · Ana»); {} si el texto no es un anuncio. La de los avisos de un
    evento la compone Qillqa (servicios/avisos_chat.py, «redaccion.v1»); esta es la misma regla para el anuncio."""
    for prefijo, que, icono in (("Tarea creada: ", "Tarea creada", "tarea"), ("Actividad agendada: ", "Actividad agendada", "agenda")):
        if (texto or "").startswith(prefijo):
            partes = texto[len(prefijo):].split(" · ")
            return {"que": que, "icono": icono, "titulo": partes[0].strip(), "detalle": "", "meta": [x.strip() for x in partes[1:] if x.strip()]}
    return {}


# --- canales ---------------------------------------------------------------------------------


async def miembro_de(sesion: AsyncSession, canal_id: int, usuario_id: int) -> CanalMiembro | None:
    return (await sesion.execute(select(CanalMiembro).where(CanalMiembro.canal_id == canal_id, CanalMiembro.usuario_id == usuario_id))).scalar_one_or_none()


async def unir(sesion: AsyncSession, canal: Canal, usuario_id: int, papel: str = "miembro") -> CanalMiembro:
    m = await miembro_de(sesion, canal.id, usuario_id)
    if m is None:
        m = CanalMiembro(canal_id=canal.id, usuario_id=usuario_id, papel=papel)
        sesion.add(m)
        await sesion.flush()
    return m


async def canal_directo(sesion: AsyncSession, a: int, b: int) -> Canal:
    """El canal directo entre dos personas; se crea la primera vez (idempotente por `clave`)."""
    clave = clave_directo(a, b)
    # Candado por clave hasta el fin de la transacción (2026-10-12): dos pedidos a la vez (dos pestañas, o el
    # efecto de `?directo=` que React dispara dos veces en desarrollo) creaban dos directos con la misma clave.
    await sesion.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"chat:{clave}"})
    # Si ya hay duplicados de antes, manda el más antiguo (scalar_one_or_none fallaría con dos).
    c = (await sesion.execute(
        select(Canal).where(Canal.clase == "directo", Canal.clave == clave).order_by(Canal.id).limit(1)
    )).scalar_one_or_none()
    if c is None:
        c = Canal(clase="directo", nombre="", visibilidad="privado", clave=clave, creado_por=a)
        sesion.add(c)
        await sesion.flush()
        await unir(sesion, c, a)
        await unir(sesion, c, b)
    return c


async def canal_por_clave(sesion: AsyncSession, clave: str) -> Canal | None:
    return (await sesion.execute(select(Canal).where(Canal.clase == "tema", Canal.clave == clave))).scalar_one_or_none()


async def canal_de_entidad(sesion: AsyncSession, entidad: str, nombre: str, usuario_id: int | None, padre_clave: str = "") -> Canal:
    """El canal temático de una entidad (`pl:3`, `sr:2`, `comision:educacion`); se crea al primer uso."""
    c = (await sesion.execute(select(Canal).where(Canal.clase == "tema", Canal.entidad == entidad))).scalar_one_or_none()
    if c is None:
        padre = await canal_por_clave(sesion, padre_clave) if padre_clave else None
        c = Canal(clase="tema", nombre=nombre[:120], entidad=entidad, visibilidad="equipo", padre_id=padre.id if padre else None, creado_por=usuario_id)
        sesion.add(c)
        await sesion.flush()
    return c


async def sembrar_fabrica(sesion: AsyncSession) -> int:
    fila = await sesion.get(AjusteRimay, "chat_canales_fabrica")
    hechas = set((fila.valor or {}).get("claves", [])) if fila else set()
    nuevos = 0
    recien: set[str] = set()
    for c in FABRICA + temas_propios():
        if c["clave"] in hechas:
            continue
        sesion.add(Canal(clase="tema", visibilidad="equipo", categoria=CATEGORIA_FABRICA.get(c["clave"], ""), **c))
        hechas.add(c["clave"])
        recien.add(c["clave"])
        nuevos += 1
    # Secciones (2026-10-13): los temas de fábrica ya sembrados toman la suya si aún no tienen.
    for clave, cat in CATEGORIA_FABRICA.items():
        await sesion.execute(update(Canal).where(Canal.clase == "tema", Canal.clave == clave, Canal.categoria == "").values(categoria=cat))
    await _ordenar_temas_viejos(sesion, recien)
    if "denuncias" in recien:
        await sesion.execute(update(Canal).where(Canal.clase == "tema", Canal.clave == "atencion",
                                                 Canal.descripcion == "Pedidos de la ciudadanía, denuncias y acceso a la información pública.")
                             .values(descripcion="Pedidos de la ciudadanía y acceso a la información pública (las denuncias, en su tema)."))
    # Un canal por comisión (2026-10-12, fase 9.2), bajo el tema «Comisiones»; el catálogo es el de Qillqa
    # («catalogos.v1», Rimay R3): sin él, ninguno.
    from tiqsi.modulo import opcional

    catalogos = opcional("catalogos.v1")
    COMISIONES = list(catalogos.comisiones()) if catalogos is not None else []
    if "comisiones" in hechas:
        await sesion.flush()
        padre = await canal_por_clave(sesion, "comisiones")
        for nombre in COMISIONES:
            clave = f"comision:{slug(nombre)}"
            if clave in hechas:
                continue
            sesion.add(Canal(clase="tema", visibilidad="equipo", nombre=nombre.replace("Comisión de ", ""), entidad=clave,
                             clave=clave, padre_id=padre.id if padre else None, descripcion=nombre))
            hechas.add(clave)
            nuevos += 1
    if nuevos:
        if fila:
            fila.valor = {"claves": sorted(hechas)}
        else:
            sesion.add(AjusteRimay(clave="chat_canales_fabrica", valor={"claves": sorted(hechas)}))
        log.info("Canales de fábrica sembrados: %s", nuevos)
    await sesion.commit()
    return nuevos


async def _ordenar_temas_viejos(sesion: AsyncSession, recien: set[str]) -> None:
    """Una sola vez, al sembrar los temas nuevos (2026-10-13): la descripción del tema «Documentos» dice que lo firmado
    y lo enviado van a sus temas. Lo de las REGLAS (apagar o acotar las de fábrica) es de Qillqa: le llega por la
    bandeja como «conversaciones.temas_nuevos» (servicios/avisos_chat.py, Rimay R2)."""
    if "documentos-listos" in recien or "documentos-enviados" in recien:
        await sesion.execute(update(Canal).where(Canal.clase == "tema", Canal.clave == "documentos",
                                                 Canal.descripcion == "Oficios numerados, firmados y enviados (lo publica el sistema).")
                             .values(descripcion="Cada documento numerado (lo publica el sistema); lo firmado y lo enviado, en sus temas."))
    if recien:
        await guardar(sesion, BANDEJA, "conversaciones.temas_nuevos", {"claves": sorted(recien)}, origen="chat")


async def canales_de(sesion: AsyncSession, usuario: Usuario) -> list[dict]:
    """Los canales que la persona ve, con no leídos y el último mensaje: los temas del equipo
    (aunque no se haya unido) y los grupos y directos de los que es miembro."""
    if usuario.rol == "invitado":
        return []
    miembros = {m.canal_id: m for m in (await sesion.execute(select(CanalMiembro).where(CanalMiembro.usuario_id == usuario.id))).scalars()}
    # Por id (Rimay R3): los que empatan en el último mensaje (los que aún no tienen) salían en el orden físico de la
    # tabla, que cambia con cada actualización y al mudar la base; ahora, siempre el mismo.
    q = select(Canal).where(Canal.archivado.is_(False), or_(
        (Canal.clase == "tema") & (Canal.visibilidad == "equipo"), Canal.id.in_(list(miembros) or [0]),
    )).order_by(Canal.id)
    canales = (await sesion.execute(q)).scalars().all()
    ids = [c.id for c in canales]
    # No leídos: mensajes con id > ultimo_leido_id del miembro (0 si no se ha unido), sin los propios.
    no_leidos: dict[int, int] = {}
    ultimos: dict[int, Mensaje] = {}
    if ids:
        filas = (await sesion.execute(
            select(Mensaje.canal_id, func.count(Mensaje.id)).where(Mensaje.canal_id.in_(ids), Mensaje.eliminado_en.is_(None), Mensaje.padre_id.is_(None),
                                                                 or_(Mensaje.autor_id != usuario.id, Mensaje.autor_id.is_(None)))
            .group_by(Mensaje.canal_id)
        )).all()
        for cid, total in filas:
            leido = miembros[cid].ultimo_leido_id if cid in miembros else 0
            if leido:
                n = (await sesion.execute(select(func.count(Mensaje.id)).where(Mensaje.canal_id == cid, Mensaje.id > leido, Mensaje.eliminado_en.is_(None),
                                                                                   or_(Mensaje.autor_id != usuario.id, Mensaje.autor_id.is_(None))))).scalar_one()
            else:
                n = total
            no_leidos[cid] = int(n)
        sub = select(Mensaje.canal_id, func.max(Mensaje.id).label("mid")).where(Mensaje.canal_id.in_(ids), Mensaje.eliminado_en.is_(None)).group_by(Mensaje.canal_id).subquery()
        for m in (await sesion.execute(select(Mensaje).join(sub, Mensaje.id == sub.c.mid))).scalars():
            ultimos[m.canal_id] = m
    # Nombre del directo: la otra persona.
    otros: dict[int, str] = {}
    directos = [c for c in canales if c.clase == "directo"]
    if directos:
        filas = (await sesion.execute(
            select(CanalMiembro.canal_id, CanalMiembro.usuario_id)
            .where(CanalMiembro.canal_id.in_([c.id for c in directos]), CanalMiembro.usuario_id != usuario.id)
        )).all()
        por_id = {c["id"]: c for c in await cuentas()}
        for cid, uid in filas:
            if uid in por_id:   # como la unión con la cuenta: la que ya no existe no nombra el directo
                otros[cid] = nombre_de(por_id[uid])
    autores = await nombres_usuarios(sesion, {m.autor_id for m in ultimos.values() if m.autor_id})
    # La vista previa de un mensaje sin texto (un adjunto, una nota de voz) o de una encuesta.
    from rimay.modelos import Encuesta

    primeros: dict[int, MensajeArchivo] = {}
    con_encuesta: set[int] = set()
    if ultimos:
        mids = [m.id for m in ultimos.values()]
        sin_texto = [m.id for m in ultimos.values() if not (m.texto or "").strip()]
        if sin_texto:
            for a in (await sesion.execute(select(MensajeArchivo).where(MensajeArchivo.mensaje_id.in_(sin_texto)).order_by(MensajeArchivo.id))).scalars():
                primeros.setdefault(a.mensaje_id, a)
        con_encuesta = set((await sesion.execute(select(Encuesta.mensaje_id).where(Encuesta.mensaje_id.in_(mids)))).scalars().all())
    salida = []
    ahora = datetime.now(timezone.utc)
    vigentes = await nombres_vigentes({c.entidad for c in canales if c.entidad})
    for c in canales:
        u = ultimos.get(c.id)
        mi = miembros.get(c.id)
        silenciado = bool(mi and mi.silenciado_hasta and mi.silenciado_hasta > ahora)
        salida.append({
            **canal_dict(c), "nombre": otros.get(c.id, c.nombre or NOTAS_PROPIAS) if c.clase == "directo" else c.nombre,
            "miembro": c.id in miembros, "papel": miembros[c.id].papel if c.id in miembros else "",
            "silenciado": silenciado, "silenciado_hasta": mi.silenciado_hasta.isoformat() if silenciado else None,
            "no_leidos": no_leidos.get(c.id, 0), "entidad_etiqueta": vigentes.get(c.entidad, ""),
            "ultimo": {"id": u.id, "autor_id": u.autor_id, "texto": vista_previa(u.texto, primeros[u.id].nombre if u.id in primeros else "", u.id in con_encuesta)[:120], "autor": autores.get(u.autor_id or 0, "Sistema") if u.autor_id else ((u.tarjeta or {}).get("firma") or "Sistema"), "creado_en": u.creado_en.isoformat()} if u else None,
        })
    salida.sort(key=lambda x: (x["ultimo"]["creado_en"] if x["ultimo"] else ""), reverse=True)
    return salida


_NEGRITA = re.compile(r"(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])")


def texto_llano(texto: str) -> str:
    """El texto en una línea, sin los asteriscos de la *negrita* (lista de chats y avisos push): los
    saltos de un mensaje escrito como en Telegram pasan a « · »."""
    t = _NEGRITA.sub(r"\1\2", texto or "")
    return " · ".join(x.strip() for x in t.splitlines() if x.strip())


def vista_previa(texto: str, archivo: str = "", encuesta: bool = False) -> str:
    """La línea de la lista de chats: «Encuesta: ¿Qué día?», «Nota de voz», el nombre del
    archivo si el mensaje solo trae un adjunto, o el texto."""
    if encuesta:
        return f"Encuesta: {texto}"
    if (texto or "").strip():
        return texto_llano(texto)
    if archivo:
        return "Nota de voz" if es_nota_de_voz(archivo) else archivo
    return ""


def canal_dict(c: Canal) -> dict:
    return {"id": c.id, "clase": c.clase, "nombre": c.nombre, "descripcion": c.descripcion, "entidad": c.entidad, "padre_id": c.padre_id,
            "visibilidad": c.visibilidad, "clave": c.clave, "archivado": c.archivado, "creado_por": c.creado_por,
            "categoria": c.categoria or CATEGORIA_FABRICA.get(c.clave, "")}


async def nombres_usuarios(sesion: AsyncSession, ids: set[int]) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {c["id"]: nombre_de(c) for c in await cuentas() if c["id"] in ids}


async def miembros_de(sesion: AsyncSession, canal: Canal) -> list[dict]:
    filas = (await sesion.execute(select(CanalMiembro).where(CanalMiembro.canal_id == canal.id).order_by(CanalMiembro.id))).scalars().all()
    por_id = {c["id"]: c for c in await cuentas()}
    return [{"usuario_id": u["id"], "nombre": nombre_de(u), "cuenta": u["usuario"], "papel": m.papel, "ultimo_leido_id": m.ultimo_leido_id,
             "ultimo_recibido_id": max(m.ultimo_recibido_id or 0, m.ultimo_leido_id or 0)}
            for m in filas if (u := por_id.get(m.usuario_id)) is not None]


async def lectores_de(sesion: AsyncSession, canal: Canal) -> set[int]:
    """A quién se le difunde lo que pasa en el canal: el equipo entero en un tema abierto; los
    miembros en los demás."""
    if canal.clase == "tema" and canal.visibilidad == "equipo":
        return {c["id"] for c in await cuentas() if es_del_equipo(c)}
    return set((await sesion.execute(select(CanalMiembro.usuario_id).where(CanalMiembro.canal_id == canal.id))).scalars().all())


# --- mensajes --------------------------------------------------------------------------------


def mensaje_dict(m: Mensaje, autores: dict[int, str], archivos: list[dict] | None = None) -> dict:
    return {
        "id": m.id, "canal_id": m.canal_id, "autor_id": m.autor_id, "autor": autores.get(m.autor_id or 0, "Sistema") if m.autor_id else "Sistema",
        "padre_id": m.padre_id, "responde_a_id": m.responde_a_id, "texto": "" if m.eliminado_en else m.texto, "menciones": m.menciones or [], "entidad": m.entidad,
        "evento_sistema_id": m.evento_sistema_id, "acciones": m.acciones or [], "respuestas": m.respuestas,
        "editado_en": m.editado_en.isoformat() if m.editado_en else None, "eliminado": m.eliminado_en is not None,
        "creado_en": m.creado_en.isoformat() if m.creado_en else None, "archivos": archivos or [],
        "tarjeta": (m.tarjeta or {}) if not m.eliminado_en else {},
    }


async def archivos_de(sesion: AsyncSession, ids: list[int]) -> dict[int, list[dict]]:
    if not ids:
        return {}
    salida: dict[int, list[dict]] = {}
    for a in (await sesion.execute(select(MensajeArchivo).where(MensajeArchivo.mensaje_id.in_(ids)))).scalars():
        salida.setdefault(a.mensaje_id, []).append({"id": a.id, "referencia": a.referencia, "archivo": a.archivo, "nombre": a.nombre, "bytes": a.bytes, "duracion_ms": a.duracion_ms})
    return salida


async def avisar_en_la_campana(sesion: AsyncSession, usuario_id: int | None, texto: str, tipo: str, evitar: int | None = None,
                               destino: str = "") -> None:
    """Un aviso en la campana de `usuario_id` (nadie se avisa a sí mismo): sale por la bandeja del chat como «aviso.nuevo»
    en su transacción y Qillqa lo pone en la campana tras el commit (Rimay R2; como Tareas y Agenda). El sonido y el
    aviso push del mensaje no esperan: los da `avisar` en el acto."""
    if not usuario_id or usuario_id == evitar:
        return
    await guardar(sesion, BANDEJA, "aviso.nuevo", {"usuario_id": usuario_id, "texto": texto[:500], "tipo": tipo, "destino": destino[:80]},
                  origen="chat")


async def publicar(sesion: AsyncSession, canal: Canal, *, autor: Usuario | None, texto: str, padre_id: int | None = None,
                   entidad: str = "", evento_sistema_id: int | None = None, acciones: list[dict] | None = None,
                   archivos: list[dict] | None = None, difundir: bool = True, tarjeta: dict | None = None,
                   responde_a_id: int | None = None) -> Mensaje:
    """Escribe el mensaje, resuelve menciones (aviso en la campana), cuenta la respuesta en el
    padre, actualiza el canal y lo difunde en vivo a quien lo lee. Sin commit. Al difundir, lo
    marca como recibido por quien tiene el socket abierto (el segundo ✓) y avisa (`avisar`)."""
    por_cuenta = {c["usuario"].lower(): c for c in await cuentas() if c.get("activo") and c.get("usuario")}
    mencionados = menciones(texto, set(por_cuenta))
    m = Mensaje(canal_id=canal.id, autor_id=autor.id if autor else None, padre_id=padre_id, responde_a_id=responde_a_id, texto=(texto or "").strip(),
                menciones=mencionados, entidad=entidad if entidad_valida(entidad) else "", evento_sistema_id=evento_sistema_id,
                acciones=acciones or [], tarjeta=tarjeta or {})
    sesion.add(m)
    await sesion.flush()
    for a in archivos or []:
        sesion.add(MensajeArchivo(mensaje_id=m.id, referencia=a.get("referencia", ""), archivo=a.get("archivo", ""),
                                  nombre=a.get("nombre", "")[:300], bytes=int(a.get("bytes") or 0), sha256=a.get("sha256", ""),
                                  duracion_ms=int(a["duracion_ms"]) if a.get("duracion_ms") else None))
    if padre_id:
        await sesion.execute(update(Mensaje).where(Mensaje.id == padre_id).values(respuestas=Mensaje.respuestas + 1))
    canal.ultimo_mensaje_en = datetime.now(timezone.utc)
    if autor:
        mi = await unir(sesion, canal, autor.id) if canal.clase == "tema" else await miembro_de(sesion, canal.id, autor.id)
        if mi:
            mi.ultimo_leido_id = m.id
    quien = autor.nombre_completo if autor else "El sistema"
    for cuenta in mencionados:
        u = por_cuenta[cuenta]
        if not autor or u["id"] != autor.id:
            await avisar_en_la_campana(sesion, u["id"], f"{quien} le mencionó en {canal.nombre or 'un chat'}: {m.texto[:140]}", "mencion",
                                       evitar=autor.id if autor else None, destino=f"chat:{canal.id}:{m.id}")
    # En un directo, la otra persona recibe un aviso en la campana (no está mirando el chat), salvo que lo silenciara.
    if canal.clase == "directo" and autor:
        ahora = datetime.now(timezone.utc)
        for mb in (await sesion.execute(select(CanalMiembro).where(CanalMiembro.canal_id == canal.id))).scalars():
            if mb.usuario_id != autor.id and not (mb.silenciado_hasta and mb.silenciado_hasta > ahora):
                await avisar_en_la_campana(sesion, mb.usuario_id, f"{quien}: {m.texto[:140]}", "chat", evitar=autor.id, destino=f"chat:{canal.id}:{m.id}")
    autores = await nombres_usuarios(sesion, {m.autor_id} if m.autor_id else set())
    if difundir:  # sin difundir: quien llama completa el mensaje (una encuesta) y lo difunde él
        carga = {"tipo": "mensaje", "canal_id": canal.id, "mensaje": mensaje_dict(m, autores, [dict(a) for a in archivos or []])}
        lectores = await lectores_de(sesion, canal)
        difusor.publicar(lectores, carga)
        await avisar(sesion, canal, m, lectores, {por_cuenta[c]["id"] for c in mencionados}, quien if autor else (tarjeta or {}).get("firma", ""),
                     (archivos or [{}])[0].get("nombre", "") if archivos else "")
    return m


async def avisar(sesion: AsyncSession, canal: Canal, m: Mensaje, lectores: set[int], mencionados: set[int], autor: str,
                 archivo: str = "", encuesta: bool = False) -> None:
    """Tras difundir un mensaje (2026-10-13): (1) quien tiene el socket abierto ya lo recibió en
    un dispositivo: segundo ✓ (`lecturas`); (2) a quien corresponde avisar (`destinatarios_chat`)
    y no tiene esa conversación a la vista: `{tipo: 'alerta'}` por el socket (la web suena con el
    sonido de Qillqa) y, si no tiene Qillqa a la vista en ningún lado, el aviso push. El aviso push es de
    la plataforma («push.v1», Rimay R2): sin él, solo el sonido en la aplicación."""
    from tiqsi.modulo import opcional

    filas = (await sesion.execute(select(CanalMiembro).where(CanalMiembro.canal_id == canal.id))).scalars().all()
    ahora = datetime.now(timezone.utc)
    conectados = difusor.conectados()
    cambios = []
    for mb in filas:
        if mb.usuario_id != m.autor_id and mb.usuario_id in conectados and (mb.ultimo_recibido_id or 0) < m.id:
            mb.ultimo_recibido_id = m.id
            cambios.append(lectura_dict(mb))
    if cambios:
        difusor.publicar({mb.usuario_id for mb in filas} | ({m.autor_id} if m.autor_id else set()),
                         {"tipo": "lecturas", "canal_id": canal.id, "cambios": cambios})
    miembros = {mb.usuario_id: bool(mb.silenciado_hasta and mb.silenciado_hasta > ahora) for mb in filas}
    # En un tema, «miembros» son quienes ya lo abrieron o escribieron en él (`unir`).
    destino = destinatarios_chat(clase=canal.clase, autor_id=m.autor_id, miembros=miembros, mencionados=mencionados, lectores=lectores)
    destino = {u for u in destino if not difusor.viendo(u, canal.id)}
    if not destino:
        return
    for grupo, mencion in ((destino - mencionados, False), (destino & mencionados, True)):
        if grupo:
            difusor.publicar(grupo, {"tipo": "alerta", "canal_id": canal.id, "mensaje_id": m.id, "mencion": mencion})
    push = opcional("push.v1")
    lejos = push.sin_la_app_a_la_vista(destino) if push is not None else set()
    if not lejos:
        return
    titulo = autor if canal.clase == "directo" and autor else (canal.nombre or "Chat de Qillqa")
    cuerpo = cuerpo_chat(canal.clase, autor or "Sistema", texto_llano(m.texto), archivo, es_nota_de_voz(archivo), encuesta)
    url = f"/chat?canal={canal.id}&mensaje={m.id}"
    for uid in lejos:
        datos = push.carga(titulo, cuerpo, url, f"chat-{canal.id}", clase="chat",
                           acuse={"u": uid, "c": canal.id, "m": m.id, "f": push.firma_acuse(uid, canal.id, m.id)})
        push.programar({uid}, datos, retraso=0.8)


# --- a quién avisar un mensaje y cómo (venían de servicios/push.py; Rimay R2) -------------------------------------


def _recortar(texto: str, maximo: int = 180) -> str:
    t = " ".join((texto or "").split())
    return t if len(t) <= maximo else t[: maximo - 1] + "…"


def destinatarios_chat(*, clase: str, autor_id: int | None, miembros: dict[int, bool], mencionados: set[int],
                       lectores: set[int]) -> set[int]:
    """A quién se le avisa un mensaje del chat (sonido en la app abierta o push si no la mira).

    - Nunca a quien lo escribió.
    - Directo y grupo: a sus integrantes que no lo silenciaron.
    - Tema del equipo: a quienes ya están en él (lo abrieron o escribieron) y no lo silenciaron,
      solo si lo escribió una persona; lo que publica el sistema en un tema (numerados, agenda…)
      se ve en el canal y en su contador, sin sonar en el bolsillo de todos (para avisos
      personales están las reglas `notificar`, que van a la campana y sí llegan por push).
    - Una mención llega siempre, aunque el canal esté silenciado (como en WhatsApp).
    `miembros` = {usuario_id: silenciado}; `lectores` = quienes pueden leer el canal.
    """
    salida: set[int] = set()
    if clase in ("directo", "grupo") or (clase == "tema" and autor_id is not None):
        salida = {u for u, silenciado in miembros.items() if not silenciado}
    salida |= set(mencionados)
    if lectores:
        salida &= lectores
    if autor_id is not None:
        salida.discard(autor_id)
    return salida


def cuerpo_chat(clase: str, autor: str, texto: str, archivo: str = "", es_voz: bool = False, encuesta: bool = False) -> str:
    """«Ana: Ya está el oficio» en un grupo; en un directo, solo el texto (el título ya es Ana)."""
    if encuesta:
        t = f"Encuesta: {texto}"
    elif (texto or "").strip():
        t = texto
    elif es_voz:
        t = "Nota de voz"
    elif archivo:
        t = f"Archivo: {archivo}"
    else:
        t = "Mensaje nuevo"
    return _recortar(t if clase == "directo" else f"{autor}: {t}")


def lectura_dict(mb: CanalMiembro) -> dict:
    return {"usuario_id": mb.usuario_id, "ultimo_leido_id": mb.ultimo_leido_id or 0,
            "ultimo_recibido_id": max(mb.ultimo_recibido_id or 0, mb.ultimo_leido_id or 0)}


async def difundir_lecturas(sesion: AsyncSession, canal_id: int, cambios: list[dict]) -> None:
    """Cuenta a los integrantes del canal hasta dónde llegó y leyó alguien (✓✓ y «Leído por»)."""
    if not cambios:
        return
    ids = set((await sesion.execute(select(CanalMiembro.usuario_id).where(CanalMiembro.canal_id == canal_id))).scalars().all())
    difusor.publicar(ids, {"tipo": "lecturas", "canal_id": canal_id, "cambios": cambios})


async def marcar_recibidos(sesion: AsyncSession, usuario_id: int, hasta: dict[int, int]) -> dict[int, dict]:
    """La persona tiene en un dispositivo hasta `hasta[canal]` (abrió la lista de chats, el contador
    o le llegó el aviso push): sube `ultimo_recibido_id` donde es menor. Sin commit. → {canal: lectura}."""
    if not hasta:
        return {}
    filas = (await sesion.execute(select(CanalMiembro).where(CanalMiembro.usuario_id == usuario_id, CanalMiembro.canal_id.in_(list(hasta))))).scalars().all()
    cambios: dict[int, dict] = {}
    for mb in filas:
        tope = int(hasta.get(mb.canal_id) or 0)
        if tope > max(mb.ultimo_recibido_id or 0, mb.ultimo_leido_id or 0):
            mb.ultimo_recibido_id = tope
            cambios[mb.canal_id] = lectura_dict(mb)
    return cambios


async def marcar_leido(sesion: AsyncSession, canal: Canal, usuario: Usuario, mensaje_id: int) -> dict | None:
    """Sube hasta dónde leyó (y, con ello, hasta dónde recibió). → la lectura nueva, o None si no cambió."""
    mi = await unir(sesion, canal, usuario.id) if canal.clase == "tema" else await miembro_de(sesion, canal.id, usuario.id)
    if mi and mensaje_id > (mi.ultimo_leido_id or 0):
        mi.ultimo_leido_id = mensaje_id
        mi.ultimo_recibido_id = max(mi.ultimo_recibido_id or 0, mensaje_id)
        return lectura_dict(mi)
    return None


async def buscar(sesion: AsyncSession, usuario: Usuario, q: str, limite: int = 30) -> list[dict]:
    """Búsqueda de texto completo en español sobre los canales que la persona ve."""
    visibles = [c["id"] for c in await canales_de(sesion, usuario)]
    if not visibles or not q.strip():
        return []
    filas = (await sesion.execute(
        select(Mensaje).where(Mensaje.canal_id.in_(visibles), Mensaje.eliminado_en.is_(None),
                              text("to_tsvector('spanish', mensajes.texto) @@ plainto_tsquery('spanish', :q)")).params(q=q)
        .order_by(Mensaje.id.desc()).limit(limite)
    )).scalars().all()
    autores = await nombres_usuarios(sesion, {m.autor_id for m in filas if m.autor_id})
    return [mensaje_dict(m, autores) for m in filas]


async def total_no_leidos(sesion: AsyncSession, usuario: Usuario) -> int:
    """Para el contador junto a la campana: los canales silenciados no suman."""
    return sum(c["no_leidos"] for c in await canales_de(sesion, usuario) if not c.get("silenciado"))


# --- adjuntos subidos desde el chat (2026-10-12, fase 9.1) -------------------------------------------

MAX_ADJUNTO = 50 * 1024 * 1024


def ruta_archivo(relativa: str):
    """Ruta absoluta de un archivo subido al chat (relativa a su raíz, carpeta `chat/`: la documental o, sola, la suya)."""
    if not relativa:
        return None
    base = raiz().resolve()
    ruta = (base / relativa).resolve()
    return ruta if base in ruta.parents and ruta.is_file() else None


def guardar_archivo(origen, nombre: str) -> tuple[str, str, int]:
    """Mueve el archivo subido a `chat/AAAA-MM/<sha8>_<nombre>` bajo su raíz (`rimay_config.raiz`).
    → (ruta relativa, sha256, bytes)."""
    import hashlib
    import re as _re
    import shutil
    from datetime import date
    from pathlib import Path

    h = hashlib.sha256()
    with Path(origen).open("rb") as fh:
        for trozo in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(trozo)
    sha = h.hexdigest()
    limpio = _re.sub(r"[^\w.\-() ]+", "_", Path(nombre).name)[:150] or "archivo"
    carpeta = raiz() / "chat" / date.today().strftime("%Y-%m")
    carpeta.mkdir(parents=True, exist_ok=True)
    destino = carpeta / f"{sha[:8]}_{limpio}"
    if not destino.exists():
        shutil.move(str(origen), str(destino))
    else:
        Path(origen).unlink(missing_ok=True)
    return str(destino.relative_to(raiz())), sha, destino.stat().st_size


def registro():
    """«registro.v1» de Qillqa (lo que se reconoce y registra desde el chat, Rimay R1b), o None si no está."""
    from tiqsi.modulo import opcional

    return opcional("registro.v1")


def bloque_recibido(texto: str | None) -> bool:
    """¿El mensaje trae un bloque `documento-recibido` válido? (sus imágenes son el documento). Lo dice Qillqa."""
    r = registro()
    return bool(r is not None and r.bloque_recibido(texto or ""))


def acciones_de_archivo(archivo: MensajeArchivo, con_bloque_recibido: bool = False) -> list[dict]:
    """Qué ofrece el sistema con un archivo subido (registrarlo en Mesa de Partes o guardarlo en la Mediateca): lo
    decide Qillqa («registro.v1».ofrecer_archivo, Rimay R1b); la nota de voz se queda en el chat. Sin Qillqa, nada."""
    if es_nota_de_voz(archivo.nombre):  # una nota de voz se queda en el chat (no es un video de la Mediateca)
        return []
    r = registro()
    if r is None:
        return []
    return [{**o, "archivo_id": archivo.id} for o in r.ofrecer_archivo(archivo.nombre, con_bloque_recibido)]


async def reaccionar(sesion: AsyncSession, mensaje: Mensaje, usuario: Usuario, emoji: str) -> list[dict]:
    """Alterna la reacción de la persona; devuelve el resumen [{emoji, n, mia}] del mensaje."""
    fila = (await sesion.execute(select(MensajeReaccion).where(MensajeReaccion.mensaje_id == mensaje.id, MensajeReaccion.usuario_id == usuario.id, MensajeReaccion.emoji == emoji))).scalar_one_or_none()
    if fila:
        await sesion.delete(fila)
    else:
        sesion.add(MensajeReaccion(mensaje_id=mensaje.id, usuario_id=usuario.id, emoji=emoji))
    await sesion.flush()
    return (await reacciones_de(sesion, [mensaje.id], usuario.id)).get(mensaje.id, [])


async def reacciones_de(sesion: AsyncSession, ids: list[int], usuario_id: int) -> dict[int, list[dict]]:
    """{mensaje_id: [{emoji, n, mia}]} para los mensajes dados."""
    if not ids:
        return {}
    filas = (await sesion.execute(select(MensajeReaccion).where(MensajeReaccion.mensaje_id.in_(ids)).order_by(MensajeReaccion.id))).scalars().all()
    por: dict[int, dict[str, dict]] = {}
    for r in filas:
        d = por.setdefault(r.mensaje_id, {}).setdefault(r.emoji, {"emoji": r.emoji, "n": 0, "mia": False})
        d["n"] += 1
        if r.usuario_id == usuario_id:
            d["mia"] = True
    return {mid: list(v.values()) for mid, v in por.items()}


# --- encuestas (2026-10-12, fase 9.6) ---------------------------------------------------------------

MIN_OPCIONES, MAX_OPCIONES = 2, 10


def limpiar_opciones(opciones: list[str]) -> list[str]:
    """Las opciones sin blancos ni repetidas (sin distinguir mayúsculas), en su orden. Lanza
    ValueError si quedan menos de 2 o más de 10."""
    vistas: set[str] = set()
    salida: list[str] = []
    for o in opciones or []:
        t = " ".join(str(o or "").split())[:120]
        if t and t.lower() not in vistas:
            vistas.add(t.lower())
            salida.append(t)
    if len(salida) < MIN_OPCIONES:
        raise ValueError("Una encuesta necesita al menos dos opciones distintas.")
    if len(salida) > MAX_OPCIONES:
        raise ValueError("Una encuesta admite hasta diez opciones.")
    return salida


def aplicar_voto(actuales: set[int], opcion: int, multiple: bool, n_opciones: int) -> set[int]:
    """Lo que la persona queda votando tras tocar `opcion`: tocar lo ya votado lo quita; en una
    de respuesta única, tocar otra la reemplaza; en una de varias, se suman. Lanza ValueError si
    la opción no existe."""
    if not 0 <= opcion < n_opciones:
        raise ValueError("Esa opción no existe en la encuesta.")
    if opcion in actuales:
        return set(actuales) - {opcion}
    return (set(actuales) | {opcion}) if multiple else {opcion}


def encuesta_cerrada(cerrada: bool, cierra_en: datetime | None, ahora: datetime | None = None) -> bool:
    return bool(cerrada) or bool(cierra_en and cierra_en <= (ahora or datetime.now(timezone.utc)))


def resumen_encuesta(e, votos: list[tuple[int, int]], nombres: dict[int, str], yo: int | None, ahora: datetime | None = None) -> dict:
    """Lo que la web pinta de una encuesta: por opción, cuántos votos, el porcentaje (sobre
    quienes votaron), si es la mía y, si no es anónima, quiénes. `votos` = [(usuario_id, opcion)]."""
    opciones = list(e.opciones or [])
    votantes = {u for u, _ in votos}
    total = len(votantes)
    filas = []
    for i, texto in enumerate(opciones):
        quienes = [u for u, o in votos if o == i]
        filas.append({
            "texto": texto, "votos": len(quienes), "porcentaje": round(100 * len(quienes) / total) if total else 0,
            "mia": yo is not None and yo in quienes,
            "votantes": [] if e.anonima else [{"id": u, "nombre": nombres.get(u, "")} for u in quienes],
        })
    return {
        "id": e.id, "mensaje_id": e.mensaje_id, "pregunta": e.pregunta, "multiple": bool(e.multiple), "anonima": bool(e.anonima),
        "cierra_en": e.cierra_en.isoformat() if e.cierra_en else None, "cerrada": encuesta_cerrada(e.cerrada, e.cierra_en, ahora),
        "creado_por": e.creado_por, "votantes": total, "opciones": filas,
    }


async def encuestas_de(sesion: AsyncSession, mensaje_ids: list[int], yo: int | None) -> dict[int, dict]:
    """{mensaje_id: resumen} de las encuestas de esos mensajes (vistas por `yo`)."""
    from rimay.modelos import Encuesta, EncuestaVoto

    if not mensaje_ids:
        return {}
    encuestas = (await sesion.execute(select(Encuesta).where(Encuesta.mensaje_id.in_(mensaje_ids)))).scalars().all()
    if not encuestas:
        return {}
    votos: dict[int, list[tuple[int, int]]] = {}
    for v in (await sesion.execute(select(EncuestaVoto).where(EncuestaVoto.encuesta_id.in_([e.id for e in encuestas])).order_by(EncuestaVoto.id))).scalars():
        votos.setdefault(v.encuesta_id, []).append((v.usuario_id, v.opcion))
    publicas = {u for e in encuestas if not e.anonima for u, _ in votos.get(e.id, [])}
    nombres = await nombres_usuarios(sesion, publicas)
    return {e.mensaje_id: resumen_encuesta(e, votos.get(e.id, []), nombres, yo) for e in encuestas}


async def difundir_encuesta(sesion: AsyncSession, canal: Canal, mensaje_id: int) -> None:
    """Los resultados al día a cada pestaña conectada que lee el canal, cada una con SU «mía»
    (por eso se publica persona por persona, no un solo dict para todos)."""
    for uid in (await lectores_de(sesion, canal)) & difusor.conectados():
        r = (await encuestas_de(sesion, [mensaje_id], uid)).get(mensaje_id)
        if r:
            difusor.publicar({uid}, {"tipo": "encuesta", "canal_id": canal.id, "mensaje_id": mensaje_id, "encuesta": r})


# --- notas de voz (2026-10-12, fase 9.6) ------------------------------------------------------------

EXT_AUDIO = {".webm", ".weba", ".ogg", ".oga", ".opus", ".m4a", ".mp4", ".aac", ".mp3", ".wav", ".flac", ".amr", ".3gp"}


def es_nota_de_voz(nombre: str) -> bool:
    """Lo que graba el micrófono del chat se llama `nota-de-voz-AAAAMMDD-HHMMSS.<webm|m4a|ogg>`."""
    from pathlib import Path

    p = Path(nombre or "")
    return p.name.lower().startswith("nota-de-voz") and p.suffix.lower() in EXT_AUDIO


def tipo_de_archivo(nombre: str) -> str:
    """El Content-Type con que se sirve un adjunto: una nota de voz `.webm` es audio, no video."""
    import mimetypes
    from pathlib import Path

    ext = Path(nombre or "").suffix.lower()
    if es_nota_de_voz(nombre) and ext == ".webm":
        return "audio/webm"
    return {".weba": "audio/webm", ".opus": "audio/ogg", ".oga": "audio/ogg", ".m4a": "audio/mp4", ".amr": "audio/amr"}.get(ext) \
        or mimetypes.guess_type(nombre or "")[0] or "application/octet-stream"


def arreglar_nota_de_voz(ruta) -> int | None:
    """MediaRecorder escribe un webm sin duración ni índice (Chrome no puede adelantarlo y muestra
    «Infinity»): si hay ffmpeg, se reempaqueta sin recodificar (`-c copy`), que escribe ambos, y
    se mide la duración con ffprobe. Mejor esfuerzo: sin ffmpeg o si falla, el archivo queda como
    llegó. → duración en ms, o None."""
    import shutil
    import subprocess
    from pathlib import Path

    ruta = Path(ruta)
    if not shutil.which("ffprobe"):
        return None
    try:
        if ruta.suffix.lower() == ".webm" and shutil.which("ffmpeg"):
            tmp = ruta.with_name(ruta.stem + ".remux.webm")
            r = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(ruta), "-c", "copy", str(tmp)], capture_output=True, timeout=60)
            if r.returncode == 0 and tmp.exists() and tmp.stat().st_size > 0:
                tmp.replace(ruta)
            else:
                tmp.unlink(missing_ok=True)
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(ruta)], capture_output=True, text=True, timeout=30)
        segundos = float((r.stdout or "").strip() or "nan")
        return int(segundos * 1000) if segundos == segundos and segundos > 0 else None
    except (OSError, ValueError, subprocess.SubprocessError):
        log.warning("No se pudo arreglar la nota de voz %s", ruta.name)
        return None


# --- tareas y actividades creadas desde el chat (2026-10-12, fase 9.6) --------------------------------

_DIAS = ("lun", "mar", "mié", "jue", "vie", "sáb", "dom")


def cuando_legible(fecha: datetime | None, con_hora: bool = True) -> str:
    """«lun 14/10 10:30» en la hora de la entidad; sin hora, «lun 14/10»."""
    if fecha is None:
        return ""
    from zoneinfo import ZoneInfo

    local = fecha.astimezone(ZoneInfo(config.zona_horaria or "America/Lima")) if fecha.tzinfo else fecha
    base = f"{_DIAS[local.weekday()]} {local:%d/%m}"
    return f"{base} {local:%H:%M}" if con_hora else base


def texto_anuncio(clase: str, titulo: str, cuando: str = "", responsable: str = "", lugar: str = "") -> str:
    """El mensaje del sistema cuando alguien crea una tarea o agenda una actividad desde el chat:
    «Tarea creada: Revisar el oficio · vence lun 14/10 · Ana»."""
    if clase == "tarea":
        partes = [f"Tarea creada: {titulo}"] + ([f"vence {cuando}"] if cuando else []) + ([responsable] if responsable else [])
    else:
        partes = [f"Actividad agendada: {titulo}"] + ([cuando] if cuando else []) + ([lugar] if lugar else [])
    return " · ".join(partes)
