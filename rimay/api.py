"""rimay/api.py — API del CHAT institucional (2026-10-12, fase 8; servicios/chat.py,
modelos_chat.py). REST para canales y mensajes (la API es la verdad) y un WebSocket
(`/api/chat/ws?token=`) que reparte en vivo lo que publica `servicios/difusor.py` (la
aceleración): al reconectar, el cliente pide `GET /canales/{id}/mensajes?desde_id=`. Sin
socket, la web cae a sondeo. El mismo socket lleva también los avisos de la campana
(`tipo: 'aviso'`), para retirar los sondeos de 30 s más adelante.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from tiqsi import en_vivo as difusor
from tiqsi.puertos import Usuario, usuario_actual
from tiqsi.web import enviar_archivo

from rimay.modelos import Canal, CanalMiembro, Encuesta, EncuestaVoto, Mensaje, MensajeArchivo
from rimay import chat as svc
from rimay.db import SesionRimay, obtener_sesion_rimay

log = logging.getLogger("qillqa.chat")
router = APIRouter(prefix="/api/chat", tags=["chat"])


def _sin_invitado(u: Usuario) -> None:
    if u.rol == "invitado":
        raise HTTPException(403, "La cuenta de invitado no entra al chat.")


async def _canal(sesion: AsyncSession, cid: int, usuario: Usuario, escribir: bool = False) -> tuple[Canal, CanalMiembro | None]:
    c = await sesion.get(Canal, cid)
    if c is None:
        raise HTTPException(404, "El canal no existe.")
    m = await svc.miembro_de(sesion, c.id, usuario.id)
    ok = svc.puede_escribir(c, usuario, m is not None) if escribir else svc.puede_leer(c, usuario, m is not None)
    if not ok:
        raise HTTPException(403, "No tiene acceso a este canal." if not escribir else "No puede escribir en este canal.")
    return c, m


# --- canales ---------------------------------------------------------------------------------


async def _llego_la_lista(sesion: AsyncSession, usuario: Usuario, lista: list[dict]) -> None:
    """La lista (o el contador) llegó a un dispositivo de la persona: lo último de cada canal ya
    está «recibido» (segundo ✓ para quien lo escribió). Solo lo ajeno; se difunde lo que cambió."""
    hasta = {c["id"]: c["ultimo"]["id"] for c in lista if c.get("miembro") and c.get("ultimo") and c["ultimo"].get("autor_id") != usuario.id}
    cambios = await svc.marcar_recibidos(sesion, usuario.id, hasta)
    if cambios:
        await sesion.commit()
        for cid, lectura in cambios.items():
            await svc.difundir_lecturas(sesion, cid, [lectura])


@router.get("/canales")
async def canales(usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    _sin_invitado(usuario)
    lista = await svc.canales_de(sesion, usuario)
    await _llego_la_lista(sesion, usuario, lista)
    return {"canales": lista, "categorias": list(svc.CATEGORIAS)}


class CanalNuevo(BaseModel):
    clase: str = "grupo"
    nombre: str = Field(min_length=1, max_length=120)
    descripcion: str = Field("", max_length=2000)
    # Sección de la lista para un tema (2026-10-13): una de `svc.CATEGORIAS` o una nueva, breve.
    categoria: str = Field("", max_length=30)
    entidad: str = Field("", max_length=80)
    visibilidad: str = "privado"
    padre_id: int | None = None
    miembros: list[int] = []


@router.post("/canales")
async def crear_canal(datos: CanalNuevo, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    """Un grupo (privado, por membresía) lo crea cualquiera del equipo; un tema (abierto a todos)
    solo el administrador."""
    _sin_invitado(usuario)
    if datos.clase not in ("grupo", "tema"):
        raise HTTPException(422, "Clase: grupo o tema (los directos se abren con /directo/{usuario}).")
    if datos.clase == "tema" and usuario.rol != "administrador":
        raise HTTPException(403, "Un tema abierto a todo el equipo lo crea quien administra; cree un grupo.")
    if datos.visibilidad not in svc.VISIBILIDADES:
        raise HTTPException(422, "Visibilidad: equipo o privado.")
    if datos.entidad and not svc.entidad_valida(datos.entidad):
        raise HTTPException(422, "La entidad no tiene la forma tipo:id.")
    c = Canal(clase=datos.clase, nombre=datos.nombre.strip(), descripcion=datos.descripcion, entidad=datos.entidad,
              visibilidad="equipo" if datos.clase == "tema" else "privado", padre_id=datos.padre_id, creado_por=usuario.id,
              categoria=" ".join(datos.categoria.split())[:30] if datos.clase == "tema" else "")
    sesion.add(c)
    await sesion.flush()
    await svc.unir(sesion, c, usuario.id, "admin")
    existen = {x["id"] for x in await svc.cuentas()}
    for uid in set(datos.miembros) - {usuario.id}:
        if uid in existen:
            await svc.unir(sesion, c, uid)
    await sesion.commit()
    difusor.publicar(await svc.lectores_de(sesion, c), {"tipo": "canal", "canal": svc.canal_dict(c)})
    return svc.canal_dict(c)


@router.get("/canales/{cid}")
async def ver_canal(cid: int, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    _sin_invitado(usuario)
    c, m = await _canal(sesion, cid, usuario)
    return {**svc.canal_dict(c), "miembro": m is not None, "papel": m.papel if m else "", "miembros": await svc.miembros_de(sesion, c),
            "entidad_etiqueta": (await svc.nombres_vigentes({c.entidad} if c.entidad else set())).get(c.entidad, "")}


class CanalCambio(BaseModel):
    nombre: str | None = Field(None, max_length=120)
    descripcion: str | None = Field(None, max_length=2000)
    categoria: str | None = Field(None, max_length=30)
    archivado: bool | None = None


@router.patch("/canales/{cid}")
async def cambiar_canal(cid: int, datos: CanalCambio, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    _sin_invitado(usuario)
    c, m = await _canal(sesion, cid, usuario)
    if usuario.rol != "administrador" and not (m and m.papel == "admin"):
        raise HTTPException(403, "Solo quien administra el canal puede cambiarlo.")
    for k, v in datos.model_dump(exclude_unset=True).items():
        setattr(c, k, v.strip() if isinstance(v, str) else v)
    await sesion.commit()
    return svc.canal_dict(c)


class Miembros(BaseModel):
    usuarios: list[int] = Field(min_length=1, max_length=100)


@router.post("/canales/{cid}/miembros")
async def agregar_miembros(cid: int, datos: Miembros, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    _sin_invitado(usuario)
    c, m = await _canal(sesion, cid, usuario)
    if c.clase == "directo":
        raise HTTPException(422, "Un directo es de dos personas.")
    if c.clase == "grupo" and usuario.rol != "administrador" and not (m and m.papel == "admin"):
        raise HTTPException(403, "Solo quien administra el grupo añade personas.")
    del_equipo = {x["id"] for x in await svc.cuentas() if svc.es_del_equipo(x)}
    for uid in datos.usuarios:
        if uid in del_equipo:
            await svc.unir(sesion, c, uid)
    await sesion.commit()
    return {"miembros": await svc.miembros_de(sesion, c)}


@router.delete("/canales/{cid}/miembros/{uid}")
async def quitar_miembro(cid: int, uid: int, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    _sin_invitado(usuario)
    c, m = await _canal(sesion, cid, usuario)
    if uid != usuario.id and usuario.rol != "administrador" and not (m and m.papel == "admin"):
        raise HTTPException(403, "Solo quien administra el canal quita a otros; usted puede salir.")
    mb = await svc.miembro_de(sesion, c.id, uid)
    if mb:
        await sesion.delete(mb)
        await sesion.commit()
    return {"ok": True}


@router.post("/directo/{uid}")
async def directo(uid: int, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    """El canal directo con otra persona del equipo (se crea la primera vez)."""
    _sin_invitado(usuario)
    otro = next((x for x in await svc.cuentas() if x["id"] == uid), None)
    if otro is None or not svc.es_del_equipo(otro):
        raise HTTPException(422, "No es alguien del equipo con quien chatear.")
    # Consigo mismo: «Mis notas» (2026-10-19), el chat personal donde cada quien guarda lo suyo.
    c = await svc.canal_directo(sesion, usuario.id, otro["id"])
    await sesion.commit()
    return {**svc.canal_dict(c), "nombre": svc.NOTAS_PROPIAS if otro["id"] == usuario.id else svc.nombre_de(otro)}


@router.post("/entidad")
async def canal_entidad(entidad: str = Query(..., max_length=80), nombre: str = Query("", max_length=120),
                        usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    """El canal temático de una entidad (`pl:3`, `sr:2`); se crea al primer uso."""
    _sin_invitado(usuario)
    if not svc.entidad_valida(entidad):
        raise HTTPException(422, "La entidad no tiene la forma tipo:id.")
    padre = {"pl": "proyectos", "sr": "representacion", "doc": "documentos", "entrada": "recibidos", "evento": "agenda"}.get(entidad.split(":")[0], "")
    c = await svc.canal_de_entidad(sesion, entidad, nombre or entidad, usuario.id, padre)
    await sesion.commit()
    return svc.canal_dict(c)


# --- mensajes --------------------------------------------------------------------------------


@router.get("/canales/{cid}/mensajes")
async def mensajes(cid: int, antes_id: int | None = None, desde_id: int | None = None, padre_id: int | None = None,
                   limite: int = Query(50, ge=1, le=200), usuario: Usuario = Depends(usuario_actual),
                   sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    """Los mensajes del canal, del más nuevo al más viejo (`antes_id` pagina hacia atrás;
    `desde_id` trae lo nuevo tras reconectar); `padre_id` abre un hilo."""
    _sin_invitado(usuario)
    c, _ = await _canal(sesion, cid, usuario)
    q = select(Mensaje).where(Mensaje.canal_id == c.id)
    q = q.where(Mensaje.padre_id == padre_id) if padre_id else q.where(Mensaje.padre_id.is_(None))
    if antes_id:
        q = q.where(Mensaje.id < antes_id)
    if desde_id:
        q = q.where(Mensaje.id > desde_id)
    filas = (await sesion.execute(q.order_by(Mensaje.id.desc()).limit(limite))).scalars().all()
    autores = await svc.nombres_usuarios(sesion, {m.autor_id for m in filas if m.autor_id})
    archivos = await svc.archivos_de(sesion, [m.id for m in filas])
    reacciones = await svc.reacciones_de(sesion, [m.id for m in filas], usuario.id)
    encuestas = await svc.encuestas_de(sesion, [m.id for m in filas], usuario.id)
    # La tarjeta de lo vinculado se nombra con su valor VIGENTE (servicios/etiquetas.py, 2026-10-12).
    vigentes = await svc.nombres_vigentes({m.entidad for m in filas if m.entidad})
    tarjetas = await _tarjetas_viejas(sesion, filas)
    return {"mensajes": [{**svc.mensaje_dict(m, autores, archivos.get(m.id)), "reacciones": reacciones.get(m.id, []), "encuesta": encuestas.get(m.id),
                          "entidad_etiqueta": vigentes.get(m.entidad, ""), **({"tarjeta": tarjetas[m.id]} if m.id in tarjetas else {})}
                         for m in reversed(filas)], "hay_mas": len(filas) == limite}


async def _tarjetas_viejas(sesion: AsyncSession, filas: list[Mensaje]) -> dict[int, dict]:
    """La tarjeta de lo que el sistema publicó antes del 2026-10-13 (sin `tarjeta` guardada): se arma al vuelo
    desde su evento o su texto, sin tocar la fila. La compone Qillqa («redaccion.v1», Rimay R1); sin él, el
    anuncio corto se reconoce aquí y lo demás queda en texto llano."""
    from tiqsi.modulo import opcional

    viejos = [m for m in filas if m.autor_id is None and not m.tarjeta and not m.eliminado_en]
    if not viejos:
        return {}
    redaccion = opcional("redaccion.v1")
    if redaccion is not None:
        return await redaccion.tarjetas_viejas([{"id": m.id, "evento_sistema_id": m.evento_sistema_id, "texto": m.texto or ""} for m in viejos])
    return {m.id: t for m in viejos if (t := svc.tarjeta_anuncio(m.texto or ""))}


class MensajeNuevo(BaseModel):
    texto: str = Field("", max_length=8000)
    padre_id: int | None = None
    # Respuesta citada en la misma conversación (los directos; 2026-10-19).
    responde_a_id: int | None = None
    entidad: str = Field("", max_length=80)
    archivos: list[dict] = []


@router.post("/canales/{cid}/mensajes")
async def enviar(cid: int, datos: MensajeNuevo, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    _sin_invitado(usuario)
    c, _ = await _canal(sesion, cid, usuario, escribir=True)
    if not datos.texto.strip() and not datos.archivos:
        raise HTTPException(422, "Escriba algo o adjunte un archivo.")
    if datos.padre_id:
        padre = await sesion.get(Mensaje, datos.padre_id)
        if padre is None or padre.canal_id != c.id:
            raise HTTPException(422, "El hilo no es de este canal.")
    if datos.responde_a_id:
        citado = await sesion.get(Mensaje, datos.responde_a_id)
        if citado is None or citado.canal_id != c.id:
            raise HTTPException(422, "El mensaje citado no es de este canal.")
    archivos = [a for a in datos.archivos if svc.entidad_valida(a.get("referencia", "")) or a.get("archivo")]
    m = await svc.publicar(sesion, c, autor=usuario, texto=datos.texto, padre_id=datos.padre_id, entidad=datos.entidad, archivos=archivos, responde_a_id=datos.responde_a_id)
    await _reconocer_y_contestar(sesion, c, m, con_pdf=False)
    await sesion.commit()
    autores = {usuario.id: usuario.nombre_completo or usuario.nombre_usuario}
    return svc.mensaje_dict(m, autores, archivos)


async def _reconocer_y_contestar(sesion: AsyncSession, c: Canal, m: Mensaje, con_pdf: bool) -> None:
    """Si el mensaje trae un bloque `tipo: …`, el sistema contesta en el mismo hilo con lo que
    reconoció y los botones «Registrar» / «Abrir y revisar» (fase 9.3). Qué se reconoce y adónde
    lleva lo dice Qillqa («registro.v1», Rimay R1b)."""
    registro = svc.registro()
    r = registro.reconocer_mensaje(m.texto or "", m.id, con_pdf) if registro is not None else None
    if r is None:
        return
    await svc.publicar(sesion, c, autor=None, texto=r["texto"], padre_id=m.padre_id or None, entidad="", acciones=r["acciones"])


@router.get("/mensajes/{mid}")
async def ver_mensaje(mid: int, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    """Un mensaje (para precargar un pegado en un módulo con `?pegar=<id>`)."""
    _sin_invitado(usuario)
    m = await sesion.get(Mensaje, mid)
    if m is None or m.eliminado_en:
        raise HTTPException(404, "El mensaje no existe.")
    await _canal(sesion, m.canal_id, usuario)
    autores = await svc.nombres_usuarios(sesion, {m.autor_id} if m.autor_id else set())
    archivos = await svc.archivos_de(sesion, [m.id])
    encuesta = (await svc.encuestas_de(sesion, [m.id], usuario.id)).get(m.id)
    return {**svc.mensaje_dict(m, autores, archivos.get(m.id)), "encuesta": encuesta,
            "entidad_etiqueta": (await svc.nombres_vigentes({m.entidad} if m.entidad else set())).get(m.entidad, "")}


@router.post("/mensajes/{mid}/registrar")
async def registrar_mensaje(mid: int, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    """«Registrar» desde el chat: el bloque del mensaje entra al módulo que le toca (agenda, prensa,
    seguimiento, recibido con PDF) y el sistema cuenta en el chat qué hizo."""
    _sin_invitado(usuario)
    m = await sesion.get(Mensaje, mid)
    if m is None or m.eliminado_en:
        raise HTTPException(404, "El mensaje no existe.")
    c, _ = await _canal(sesion, m.canal_id, usuario, escribir=True)
    registro = svc.registro()
    if registro is None:
        raise HTTPException(503, "Registrar desde el chat no está disponible aquí.")
    # Lo registra Qillqa en su módulo («registro.v1», Rimay R1b), con su constancia y su evento «chat.reconocido».
    archivos = (await sesion.execute(select(MensajeArchivo).where(MensajeArchivo.mensaje_id == m.id).order_by(MensajeArchivo.id))).scalars().all()
    try:
        hecho = await registro.registrar(m.texto or "", [{"nombre": a.nombre, "ruta": str(r) if (r := svc.ruta_archivo(a.archivo)) else None}
                                                        for a in archivos if a.archivo], usuario.id, m.id, c.nombre)
    except ValueError as e:
        raise HTTPException(422, str(e))
    texto, entidad = hecho["texto"], hecho["entidad"]
    # La contestación del sistema que ofrecía «Registrar» ya cumplió: se le quita ese botón.
    for s in (await sesion.execute(select(Mensaje).where(Mensaje.canal_id == c.id, Mensaje.autor_id.is_(None), Mensaje.id > m.id, Mensaje.id < m.id + 50))).scalars():
        if any(x.get("accion") == "registrar" and x.get("mensaje_id") == m.id for x in (s.acciones or [])):
            s.acciones = [x for x in s.acciones if not (x.get("accion") == "registrar" and x.get("mensaje_id") == m.id)]
            difusor.publicar(await svc.lectores_de(sesion, c), {"tipo": "mensaje_editado", "canal_id": c.id, "mensaje": svc.mensaje_dict(s, {})})
    acciones = [{"texto": "Abrir", "entidad": entidad}] if entidad and svc.entidad_valida(entidad) else []
    r = await svc.publicar(sesion, c, autor=None, texto=f"{usuario.nombre_completo}: {texto}", padre_id=m.padre_id or None, entidad=entidad if svc.entidad_valida(entidad) else "", acciones=acciones)
    await sesion.commit()
    return {"texto": texto, "entidad": entidad, "mensaje": svc.mensaje_dict(r, {})}


@router.post("/canales/{cid}/archivos")
async def subir_archivos(cid: int, archivos: list[UploadFile] = File(...), texto: str = Form(""), padre_id: int | None = Form(None),
                         duracion_ms: int | None = Form(None, ge=0, le=6 * 3600 * 1000),
                         usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    """Adjuntar como en WhatsApp: los archivos se suben directo (sin título) y van en un mensaje; si
    el archivo es un documento o una foto, el sistema ofrece registrarlo en Recibidos o guardarlo
    en la Mediateca. Lo subido vive en `chat/AAAA-MM/` del archivo documental.

    Una nota de voz (`nota-de-voz-….webm|m4a`, fase 9.6) es un archivo más: se reempaqueta con
    ffmpeg si hace falta (duración e índice para adelantar) y guarda su duración (`ffprobe`, o la
    que midió el navegador en `duracion_ms`)."""
    import tempfile
    import uuid
    from pathlib import Path

    _sin_invitado(usuario)
    c, _ = await _canal(sesion, cid, usuario, escribir=True)
    tmp = Path(tempfile.mkdtemp(prefix="qillqa-chat-"))
    guardados = []
    for archivo in archivos[:10]:
        nombre = Path(archivo.filename or "archivo").name
        destino = tmp / f"{uuid.uuid4().hex}{Path(nombre).suffix.lower()}"
        tam = 0
        with destino.open("wb") as fh:
            while trozo := await archivo.read(1024 * 1024):
                tam += len(trozo)
                if tam > svc.MAX_ADJUNTO:
                    break
                fh.write(trozo)
        if tam > svc.MAX_ADJUNTO:
            destino.unlink(missing_ok=True)
            raise HTTPException(413, f"{nombre} pesa más de 50 MB.")
        dur = None
        sufijo = Path(nombre).suffix.lower()
        if svc.es_nota_de_voz(nombre) or (sufijo in svc.EXT_AUDIO and sufijo not in (".webm", ".mp4", ".3gp")):
            dur = await asyncio.to_thread(svc.arreglar_nota_de_voz, destino)
            dur = dur or (duracion_ms if len(archivos) == 1 else None)
        rel, sha, bytes_ = svc.guardar_archivo(destino, nombre)
        guardados.append({"archivo": rel, "nombre": nombre, "bytes": bytes_, "sha256": sha, "duracion_ms": dur})
    m = await svc.publicar(sesion, c, autor=usuario, texto=texto, padre_id=padre_id, archivos=guardados)
    filas = (await sesion.execute(select(MensajeArchivo).where(MensajeArchivo.mensaje_id == m.id))).scalars().all()
    # Una imagen es conversación salvo que el mensaje traiga el bloque `documento-recibido` (2026-10-18).
    con_bloque = svc.bloque_recibido(texto)
    acciones = [a for f in filas for a in svc.acciones_de_archivo(f, con_bloque_recibido=con_bloque)]
    if acciones:
        m.acciones = acciones
    con_pdf = any(a.get("accion") == "archivo_a_recibidos" for a in acciones)
    await _reconocer_y_contestar(sesion, c, m, con_pdf=con_pdf)
    await sesion.commit()
    archivos_dict = await svc.archivos_de(sesion, [m.id])
    carga = svc.mensaje_dict(m, {usuario.id: usuario.nombre_completo}, archivos_dict.get(m.id))
    difusor.publicar(await svc.lectores_de(sesion, c), {"tipo": "mensaje_editado", "canal_id": c.id, "mensaje": carga})
    return carga


@router.get("/archivos/{aid}")
async def ver_archivo(aid: int, peticion: Request, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> Response:
    _sin_invitado(usuario)
    a = await sesion.get(MensajeArchivo, aid)
    if a is None or not a.archivo:
        raise HTTPException(404, "El archivo no existe.")
    m = await sesion.get(Mensaje, a.mensaje_id)
    await _canal(sesion, m.canal_id, usuario)
    ruta = svc.ruta_archivo(a.archivo)
    if ruta is None:
        raise HTTPException(404, "El archivo ya no está en el archivo documental.")
    tipo = svc.tipo_de_archivo(a.nombre)
    # Video y audio con rangos (206): el reproductor adelanta sin bajar el archivo entero.
    return enviar_archivo(ruta, a.nombre, tipo, peticion, rangos=tipo.startswith(("video/", "audio/")))


@router.post("/archivos/{aid}/registrar")
async def registrar_archivo(aid: int, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    """Un archivo subido al chat entra por la puerta que le toca: documento → Recibidos (ficha
    automática), foto o video → Mediateca (álbum «Chat de la entidad»). Lo registra Qillqa
    («registro.v1», Rimay R1b); el sistema contesta en el chat."""
    _sin_invitado(usuario)
    a = await sesion.get(MensajeArchivo, aid)
    if a is None or not a.archivo:
        raise HTTPException(404, "El archivo no existe.")
    m = await sesion.get(Mensaje, a.mensaje_id)
    c, _ = await _canal(sesion, m.canal_id, usuario, escribir=True)
    ruta = svc.ruta_archivo(a.archivo)
    if ruta is None:
        raise HTTPException(404, "El archivo ya no está en el archivo documental.")
    registro = svc.registro()
    if registro is None:
        raise HTTPException(503, "Registrar desde el chat no está disponible aquí.")
    # La puerta la dice la acción que el mensaje ofreció para ESTE archivo (una imagen va a la Mediateca
    # salvo que el mensaje la presentara como documento recibido, 2026-10-18); sin acción, la extensión.
    ofrecida = next((x.get("accion") for x in (m.acciones or []) if x.get("archivo_id") == a.id), None)
    try:
        hecho = await registro.archivo(str(ruta), a.nombre, usuario.id, m.texto or "", ofrecida)
    except ValueError as e:
        raise HTTPException(422, str(e))
    texto, entidad = hecho["texto"], hecho["entidad"]
    if a.referencia != entidad and entidad:
        a.referencia = entidad
    # El botón «Registrar…» de ese archivo ya no procede: se retira del mensaje (y se difunde).
    m.acciones = [x for x in (m.acciones or []) if x.get("archivo_id") != a.id]
    difusor.publicar(await svc.lectores_de(sesion, c), {"tipo": "mensaje_editado", "canal_id": c.id, "mensaje": svc.mensaje_dict(m, await svc.nombres_usuarios(sesion, {m.autor_id} if m.autor_id else set()), (await svc.archivos_de(sesion, [m.id])).get(m.id))})
    acciones = [{"texto": "Abrir", "entidad": entidad}] if entidad else []
    r = await svc.publicar(sesion, c, autor=None, texto=f"{usuario.nombre_completo}: {texto}", padre_id=m.padre_id or None, entidad=entidad, acciones=acciones)
    await sesion.commit()
    return {"texto": texto, "entidad": entidad, "mensaje": svc.mensaje_dict(r, {})}


class Reaccion(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


@router.post("/mensajes/{mid}/reaccion")
async def reaccionar(mid: int, datos: Reaccion, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    _sin_invitado(usuario)
    if datos.emoji not in svc.EMOJIS:
        raise HTTPException(422, f"Reacciones admitidas: {' '.join(svc.EMOJIS)}")
    m = await sesion.get(Mensaje, mid)
    if m is None or m.eliminado_en:
        raise HTTPException(404, "El mensaje no existe.")
    c, _ = await _canal(sesion, m.canal_id, usuario, escribir=True)
    resumen = await svc.reaccionar(sesion, m, usuario, datos.emoji)
    await sesion.commit()
    difusor.publicar(await svc.lectores_de(sesion, c), {"tipo": "reaccion", "canal_id": c.id, "mensaje_id": m.id, "reacciones": [{**r, "mia": False} for r in resumen], "usuario_id": usuario.id, "emoji": datos.emoji})
    return {"reacciones": resumen}


class Silencio(BaseModel):
    horas: int | None = None   # None o 0 = quitar el silencio; 8, 24, 168…


@router.post("/canales/{cid}/silenciar")
async def silenciar(cid: int, datos: Silencio, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    from datetime import timedelta

    _sin_invitado(usuario)
    c, _ = await _canal(sesion, cid, usuario)
    mi = await svc.unir(sesion, c, usuario.id) if c.clase == "tema" else await svc.miembro_de(sesion, c.id, usuario.id)
    if mi is None:
        raise HTTPException(403, "No es miembro de este canal.")
    mi.silenciado_hasta = (datetime.now(timezone.utc) + timedelta(hours=datos.horas)) if datos.horas else None
    await sesion.commit()
    return {"silenciado_hasta": mi.silenciado_hasta.isoformat() if mi.silenciado_hasta else None}


class MensajeCambio(BaseModel):
    texto: str = Field(min_length=1, max_length=8000)


@router.patch("/mensajes/{mid}")
async def editar(mid: int, datos: MensajeCambio, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    _sin_invitado(usuario)
    m = await sesion.get(Mensaje, mid)
    if m is None or m.eliminado_en:
        raise HTTPException(404, "El mensaje no existe.")
    if m.autor_id != usuario.id:
        raise HTTPException(403, "Solo quien lo escribió puede editarlo.")
    if (await sesion.execute(select(Encuesta.id).where(Encuesta.mensaje_id == m.id))).first():
        raise HTTPException(422, "Una encuesta no se edita: ciérrela y cree otra.")
    c, _ = await _canal(sesion, m.canal_id, usuario, escribir=True)
    m.texto, m.editado_en = datos.texto.strip(), datetime.now(timezone.utc)
    await sesion.commit()
    carga = svc.mensaje_dict(m, {usuario.id: usuario.nombre_completo})
    difusor.publicar(await svc.lectores_de(sesion, c), {"tipo": "mensaje_editado", "canal_id": c.id, "mensaje": carga})
    return carga


@router.delete("/mensajes/{mid}")
async def eliminar(mid: int, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    """Marca el mensaje como eliminado (su texto deja de mostrarse; la fila queda)."""
    _sin_invitado(usuario)
    m = await sesion.get(Mensaje, mid)
    if m is None or m.eliminado_en:
        raise HTTPException(404, "El mensaje no existe.")
    if m.autor_id != usuario.id and usuario.rol != "administrador":
        raise HTTPException(403, "Solo quien lo escribió o el administrador puede eliminarlo.")
    c, _ = await _canal(sesion, m.canal_id, usuario)
    m.eliminado_en = datetime.now(timezone.utc)
    await sesion.commit()
    difusor.publicar(await svc.lectores_de(sesion, c), {"tipo": "mensaje_eliminado", "canal_id": c.id, "mensaje_id": m.id})
    return {"ok": True}


class Leido(BaseModel):
    mensaje_id: int


@router.post("/canales/{cid}/leido")
async def leido(cid: int, datos: Leido, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    _sin_invitado(usuario)
    c, _ = await _canal(sesion, cid, usuario)
    lectura = await svc.marcar_leido(sesion, c, usuario, datos.mensaje_id)
    await sesion.commit()
    if lectura:  # ✓✓ en el color de leído para quien lo escribió (2026-10-13)
        await svc.difundir_lecturas(sesion, c.id, [lectura])
    return {"ok": True}


@router.get("/buscar")
async def buscar(q: str = Query(..., min_length=2, max_length=200), usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    _sin_invitado(usuario)
    return {"mensajes": await svc.buscar(sesion, usuario, q)}


@router.get("/no-leidos")
async def no_leidos(usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    if usuario.rol == "invitado":
        return {"total": 0}
    lista = await svc.canales_de(sesion, usuario)
    await _llego_la_lista(sesion, usuario, lista)  # el contador de la barra: la app está abierta en algún lado
    return {"total": sum(c["no_leidos"] for c in lista if not c.get("silenciado"))}


@router.get("/equipo")
async def equipo(usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    """Con quién se puede chatear (para abrir un directo o armar un grupo)."""
    _sin_invitado(usuario)
    filas = sorted((x for x in await svc.cuentas() if svc.es_del_equipo(x) and x["id"] != usuario.id),
                   key=lambda x: (x["nombre_completo"] is None, x["nombre_completo"] or ""))   # como ORDER BY: los vacíos al final
    conectados = difusor.conectados()
    return {"equipo": [{"id": x["id"], "nombre": svc.nombre_de(x), "cuenta": x["usuario"], "cargo": x.get("cargo") or "", "en_linea": x["id"] in conectados}
                       for x in filas]}


# --- encuestas (2026-10-12, fase 9.6) -------------------------------------------------------------


class EncuestaNueva(BaseModel):
    pregunta: str = Field(min_length=1, max_length=300)
    opciones: list[str] = Field(min_length=2, max_length=10)
    multiple: bool = False
    anonima: bool = False
    cierra_en: datetime | None = None
    padre_id: int | None = None


@router.post("/canales/{cid}/encuestas")
async def crear_encuesta(cid: int, datos: EncuestaNueva, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    """Un mensaje del canal con su encuesta (el texto del mensaje es la pregunta: se busca y se
    ve en la lista de chats como cualquier otro)."""
    _sin_invitado(usuario)
    c, _ = await _canal(sesion, cid, usuario, escribir=True)
    try:
        opciones = svc.limpiar_opciones(datos.opciones)
    except ValueError as e:
        raise HTTPException(422, str(e))
    pregunta = " ".join(datos.pregunta.split())
    if not pregunta:
        raise HTTPException(422, "Escriba la pregunta.")
    cierra = datos.cierra_en
    if cierra is not None:
        cierra = cierra if cierra.tzinfo else cierra.replace(tzinfo=timezone.utc)
        if cierra <= datetime.now(timezone.utc):
            raise HTTPException(422, "La hora de cierre ya pasó.")
    if datos.padre_id:
        padre = await sesion.get(Mensaje, datos.padre_id)
        if padre is None or padre.canal_id != c.id:
            raise HTTPException(422, "El hilo no es de este canal.")
    m = await svc.publicar(sesion, c, autor=usuario, texto=pregunta, padre_id=datos.padre_id, difundir=False)
    e = Encuesta(mensaje_id=m.id, pregunta=pregunta, opciones=opciones, multiple=datos.multiple, anonima=datos.anonima,
                 cierra_en=cierra, creado_por=usuario.id)
    sesion.add(e)
    await sesion.flush()
    await sesion.commit()
    autores = {usuario.id: usuario.nombre_completo or usuario.nombre_usuario}
    vacia = svc.resumen_encuesta(e, [], {}, None)
    lectores = await svc.lectores_de(sesion, c)
    difusor.publicar(lectores, {"tipo": "mensaje", "canal_id": c.id, "mensaje": {**svc.mensaje_dict(m, autores), "encuesta": vacia}})
    # Recibido por quien está conectado, sonido y aviso push como cualquier mensaje (2026-10-13).
    await svc.avisar(sesion, c, m, lectores, {x["id"] for x in await svc.cuentas() if x["usuario"] in (m.menciones or [])},
                     usuario.nombre_completo or usuario.nombre_usuario, encuesta=True)
    await sesion.commit()
    return {**svc.mensaje_dict(m, autores), "encuesta": svc.resumen_encuesta(e, [], {}, usuario.id)}


async def _encuesta(sesion: AsyncSession, eid: int, usuario: Usuario, escribir: bool = True) -> tuple[Encuesta, Mensaje, Canal, CanalMiembro | None]:
    e = await sesion.get(Encuesta, eid)
    m = await sesion.get(Mensaje, e.mensaje_id) if e else None
    if e is None or m is None or m.eliminado_en:
        raise HTTPException(404, "La encuesta no existe.")
    c, mb = await _canal(sesion, m.canal_id, usuario, escribir=escribir)
    return e, m, c, mb


class Voto(BaseModel):
    opcion: int = Field(ge=0, le=9)


@router.post("/encuestas/{eid}/voto")
async def votar(eid: int, datos: Voto, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    """Tocar una opción: la vota; tocar la ya votada, la quita; en una de respuesta única, tocar
    otra cambia el voto (`servicios/chat.py::aplicar_voto`)."""
    _sin_invitado(usuario)
    e, m, c, _ = await _encuesta(sesion, eid, usuario)
    if svc.encuesta_cerrada(e.cerrada, e.cierra_en):
        raise HTTPException(409, "La encuesta ya está cerrada.")
    mios = (await sesion.execute(select(EncuestaVoto).where(EncuestaVoto.encuesta_id == e.id, EncuestaVoto.usuario_id == usuario.id))).scalars().all()
    try:
        quedan = svc.aplicar_voto({v.opcion for v in mios}, datos.opcion, e.multiple, len(e.opciones or []))
    except ValueError as err:
        raise HTTPException(422, str(err))
    for v in mios:
        if v.opcion not in quedan:
            await sesion.delete(v)
    for o in quedan - {v.opcion for v in mios}:
        sesion.add(EncuestaVoto(encuesta_id=e.id, usuario_id=usuario.id, opcion=o))
    await sesion.commit()
    await svc.difundir_encuesta(sesion, c, m.id)
    return (await svc.encuestas_de(sesion, [m.id], usuario.id))[m.id]


@router.delete("/encuestas/{eid}/voto")
async def quitar_voto(eid: int, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    _sin_invitado(usuario)
    e, m, c, _ = await _encuesta(sesion, eid, usuario)
    if svc.encuesta_cerrada(e.cerrada, e.cierra_en):
        raise HTTPException(409, "La encuesta ya está cerrada.")
    for v in (await sesion.execute(select(EncuestaVoto).where(EncuestaVoto.encuesta_id == e.id, EncuestaVoto.usuario_id == usuario.id))).scalars():
        await sesion.delete(v)
    await sesion.commit()
    await svc.difundir_encuesta(sesion, c, m.id)
    return (await svc.encuestas_de(sesion, [m.id], usuario.id))[m.id]


@router.post("/encuestas/{eid}/cerrar")
async def cerrar_encuesta(eid: int, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    """La cierra quien la creó o quien administra el canal (o el sistema)."""
    _sin_invitado(usuario)
    e, m, c, mb = await _encuesta(sesion, eid, usuario, escribir=False)
    if e.creado_por != usuario.id and usuario.rol != "administrador" and not (mb and mb.papel == "admin"):
        raise HTTPException(403, "Solo quien creó la encuesta o quien administra el canal puede cerrarla.")
    e.cerrada = True
    await sesion.commit()
    await svc.difundir_encuesta(sesion, c, m.id)
    return (await svc.encuestas_de(sesion, [m.id], usuario.id))[m.id]


# --- tareas y actividades creadas desde el chat (2026-10-12, fase 9.6) ------------------------------


class Anuncio(BaseModel):
    entidad: str = Field(pattern=r"^(tarea|evento):\d{1,9}$")
    padre_id: int | None = None
    # La tarea salió de un plan pegado en ese mensaje: su «Registrar en Tareas» ya cumplió.
    de_mensaje: int | None = None


@router.post("/canales/{cid}/anunciar")
async def anunciar(cid: int, datos: Anuncio, usuario: Usuario = Depends(usuario_actual), sesion: AsyncSession = Depends(obtener_sesion_rimay)) -> dict:
    """Quien creó una tarea o agendó una actividad desde el chat la deja en el canal: el sistema
    publica su tarjeta («Tarea creada: … · vence …») con el botón «Abrir». El texto lo arma el
    servidor con lo que está en la base (no lo que diga el cliente)."""
    from types import SimpleNamespace

    from tiqsi.modulo import opcional

    _sin_invitado(usuario)
    c, _ = await _canal(sesion, cid, usuario, escribir=True)
    clase, ident = datos.entidad.split(":")
    # La tarea o la actividad, de Tareas y Agenda por su contrato (fase 10.2b).
    fuente = opcional("tareas.v1") if clase == "tarea" else opcional("agenda.v1")
    leida = (await (fuente.tarea if clase == "tarea" else fuente.evento)(int(ident))) if fuente is not None and ident.isdigit() else None
    fila = SimpleNamespace(**leida) if leida else None
    if fila is None or getattr(fila, "eliminado_en", None):
        raise HTTPException(404, "La tarea no existe." if clase == "tarea" else "La actividad no existe.")
    if fila.creado_por != usuario.id and usuario.rol != "administrador":
        raise HTTPException(403, "Solo quien la creó la anuncia en el chat.")
    if datos.padre_id:
        padre = await sesion.get(Mensaje, datos.padre_id)
        if padre is None or padre.canal_id != c.id:
            raise HTTPException(422, "El hilo no es de este canal.")
    if clase == "tarea":
        resp = (await svc.nombres_usuarios(sesion, {fila.responsable_id} if fila.responsable_id else set())).get(fila.responsable_id or 0, "")
        corto = svc.texto_anuncio("tarea", fila.titulo[:200], svc.cuando_legible(fila.vence_en, bool(fila.con_hora)), resp)
    else:
        corto = svc.texto_anuncio("evento", fila.titulo[:200], svc.cuando_legible(fila.inicio, not fila.todo_el_dia), lugar=(fila.lugar or "")[:80])
    # Escrito como el equipo en Telegram (2026-10-18): lo compone Qillqa («redaccion.v1», Rimay R1); la tarjeta
    # corta queda de respaldo.
    redaccion = opcional("redaccion.v1")
    largo = await redaccion.anuncio(datos.entidad) if redaccion is not None else None
    texto = (largo or {}).get("texto") or corto
    tarjeta = svc.tarjeta_anuncio(corto)
    if texto != corto:
        tarjeta = {**tarjeta, "estilo": "mensaje", "firma": largo["firma"]}
    m = await svc.publicar(sesion, c, autor=None, texto=texto, padre_id=datos.padre_id, entidad=datos.entidad,
                           acciones=[{"texto": "Abrir", "entidad": datos.entidad}], tarjeta=tarjeta)
    if datos.de_mensaje:
        # Como en «Registrar» (registrar_mensaje): la contestación del sistema pierde su botón, para todos.
        for r in (await sesion.execute(select(Mensaje).where(Mensaje.canal_id == c.id, Mensaje.autor_id.is_(None),
                                                             Mensaje.id > datos.de_mensaje, Mensaje.id < datos.de_mensaje + 50))).scalars():
            if any(x.get("accion") == "pegar_tareas" and x.get("mensaje_id") == datos.de_mensaje for x in (r.acciones or [])):
                r.acciones = [x for x in r.acciones if not (x.get("accion") == "pegar_tareas" and x.get("mensaje_id") == datos.de_mensaje)]
                difusor.publicar(await svc.lectores_de(sesion, c), {"tipo": "mensaje_editado", "canal_id": c.id, "mensaje": svc.mensaje_dict(r, {})})
    await sesion.commit()
    return svc.mensaje_dict(m, {})


# --- WebSocket ---------------------------------------------------------------------------------


@router.websocket("/ws")
async def ws(socket: WebSocket, token: str = Query("")) -> None:
    """Una conexión por pestaña. Autentica con el JWT de la sesión (query `token`); recibe
    `{"tipo":"mensaje"|"mensaje_editado"|"mensaje_eliminado"|"canal"|"aviso", ...}` y manda
    `{"tipo":"ping"}` cada 25 s para que el proxy no la cierre. El cliente puede mandar
    `{"tipo":"escribiendo","canal_id":N}` y se reenvía a los lectores del canal, y
    `{"tipo":"viendo","canal_id":N|null,"visible":bool}` (2026-10-13): qué mira, para no mandar un
    aviso push ni sonar por lo que ya tiene delante. Recibe también `lecturas` (✓✓) y `alerta`."""
    try:
        # La ficha de la sesión la valida el anfitrión («identidad.v1».de_ficha, Rimay R3).
        usuario = await svc.identidad.de_ficha(token)
    except Exception:  # noqa: BLE001
        await socket.close(code=4401)
        return
    if usuario is None or getattr(usuario, "rol", "") == "invitado":
        await socket.close(code=4403)
        return
    await socket.accept()
    cola = difusor.suscribir(usuario.id)
    log.info("Chat: %s conectado (%s pestañas)", usuario.nombre_usuario, len(difusor.conectados()))

    async def escuchar() -> None:
        while True:
            datos = await socket.receive_json()
            if datos.get("tipo") == "viendo":  # qué conversación tiene abierta y si está a la vista (avisos, 2026-10-13)
                cid = datos.get("canal_id")
                difusor.poner_mirando(cola, int(cid) if str(cid or "").isdigit() else None, bool(datos.get("visible", True)))
                continue
            if datos.get("tipo") == "escribiendo" and str(datos.get("canal_id", "")).isdigit():
                async with SesionRimay() as sesion:
                    c = await sesion.get(Canal, int(datos["canal_id"]))
                    if c is not None:
                        lectores = await svc.lectores_de(sesion, c) - {usuario.id}
                        difusor.publicar(lectores, {"tipo": "escribiendo", "canal_id": c.id, "usuario_id": usuario.id, "nombre": usuario.nombre_completo})

    async def repartir() -> None:
        while True:
            try:
                carga = await asyncio.wait_for(cola.get(), timeout=25)
            except asyncio.TimeoutError:
                await socket.send_json({"tipo": "ping"})
                continue
            await socket.send_json(carga)

    tareas = [asyncio.create_task(escuchar()), asyncio.create_task(repartir())]
    try:
        await asyncio.wait(tareas, return_when=asyncio.FIRST_COMPLETED)
    except WebSocketDisconnect:
        pass
    finally:
        for t in tareas:
            t.cancel()
        difusor.cancelar(usuario.id, cola)
