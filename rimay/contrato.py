"""rimay/contrato.py — «conversaciones.v1»: lo que el chat (proyecto Rimay) ofrece a los demás (fase 10.2b, Rimay R1, 2026-10-20).

El chat guarda, difunde y muestra; QUÉ dice el sistema lo compone Qillqa (servicios/avisos_chat.py) y se lo entrega:

- `canal(destino)`: el canal de una regla («33» o una clave: «documentos», «recibidos»…) → {id, nombre, archivado};
- `del_sistema(entidad)`: los mensajes que el sistema escribió sobre `entidad` (todos, con None), como fichas
  {id, canal_id, evento_sistema_id, entidad, texto, tarjeta, creado_en};
- `publicar_sistema(datos)`: publica un mensaje del sistema; idempotente (un mismo evento con el mismo texto en el
  mismo canal no se repite: la bandeja entrega al menos una vez);
- `actualizar(cambios)`: pone {texto, tarjeta} a mensajes del sistema y lo difunde en vivo;
- `acuse(usuario_id, canal_id, mensaje_id)`: el aviso push llegó al dispositivo (✓✓), validado por la plataforma;
- `telegram_activo()` y `telegram(texto)`: el puente con el grupo de Telegram es del chat (R2).

Lo de Qillqa llega por el bus después de su commit («conversaciones.publicar», «conversaciones.actualizar»), y lo
que Tareas y Agenda fusiona («referencias.reapuntar») se reapunta aquí. Hasta R3 usa la sesión de la base
documental o la suya (servicios/rimay_db.py, R3).
"""
from __future__ import annotations

import logging

from sqlalchemy import select, update

from rimay.modelos import Canal, Mensaje
from rimay.db import SesionRimay
from rimay import chat as svc
from tiqsi import en_vivo as difusor

log = logging.getLogger("qillqa.chat")


async def canal(destino: str) -> dict | None:
    async with SesionRimay() as sesion:
        if destino.isdigit():
            c = (await sesion.execute(select(Canal).where(Canal.id == int(destino)))).scalar_one_or_none()
        else:
            c = await svc.canal_por_clave(sesion, destino)
        return {"id": c.id, "nombre": c.nombre or "", "archivado": bool(c.archivado)} if c else None


def _ficha(m: Mensaje) -> dict:
    return {"id": m.id, "canal_id": m.canal_id, "evento_sistema_id": m.evento_sistema_id, "entidad": m.entidad or "",
            "texto": m.texto or "", "tarjeta": dict(m.tarjeta or {}), "creado_en": m.creado_en.isoformat() if m.creado_en else None}


async def del_sistema(entidad: str | None) -> list[dict]:
    q = select(Mensaje).where(Mensaje.autor_id.is_(None), Mensaje.eliminado_en.is_(None))
    if entidad is not None:
        q = q.where(Mensaje.entidad == entidad)
    async with SesionRimay() as sesion:
        return [_ficha(m) for m in (await sesion.execute(q.order_by(Mensaje.id))).scalars()]


async def publicar_sistema(datos: dict) -> int | None:
    """→ el id del mensaje (el que ya estaba, si es una entrega repetida), o None si el canal ya no existe."""
    cid, eid, texto = int(datos["canal_id"]), datos.get("evento_sistema_id"), str(datos.get("texto") or "").strip()
    async with SesionRimay() as sesion:
        ya = (await sesion.execute(select(Mensaje.id).where(
            Mensaje.canal_id == cid, Mensaje.autor_id.is_(None), Mensaje.evento_sistema_id == eid, Mensaje.texto == texto,
        ).limit(1))).scalar_one_or_none() if eid else None
        if ya:
            return ya
        c = await sesion.get(Canal, cid)
        if c is None or c.archivado:
            return None
        m = await svc.publicar(sesion, c, autor=None, texto=texto, entidad=str(datos.get("entidad") or ""),
                               evento_sistema_id=eid, acciones=list(datos.get("acciones") or []), tarjeta=dict(datos.get("tarjeta") or {}))
        await sesion.commit()
        return m.id


async def actualizar(cambios: list[dict], difundir: bool = True) -> int:
    """Pone {texto, tarjeta} a los mensajes del SISTEMA de `cambios` ([{id, texto, tarjeta}]); lo que cambió se
    difunde como `mensaje_editado`, que la web funde en vivo. → cuántos cambiaron."""
    if not cambios:
        return 0
    por_canal: dict[int, list[Mensaje]] = {}
    async with SesionRimay() as sesion:
        filas = {m.id: m for m in (await sesion.execute(select(Mensaje).where(
            Mensaje.id.in_([int(c["id"]) for c in cambios]), Mensaje.autor_id.is_(None)))).scalars()}
        for c in cambios:
            m = filas.get(int(c["id"]))
            if m is None or (m.texto == c["texto"] and (m.tarjeta or {}) == (c["tarjeta"] or {})):
                continue
            m.texto, m.tarjeta = c["texto"], dict(c["tarjeta"] or {})
            por_canal.setdefault(m.canal_id, []).append(m)
        await sesion.commit()
        if difundir:
            for cid, ms in por_canal.items():
                ca = await sesion.get(Canal, cid)
                if ca is None:
                    continue
                lectores = await svc.lectores_de(sesion, ca)
                archivos = await svc.archivos_de(sesion, [m.id for m in ms])
                for m in ms:
                    difusor.publicar(lectores, {"tipo": "mensaje_editado", "canal_id": cid, "mensaje": svc.mensaje_dict(m, {}, archivos.get(m.id))})
    return sum(len(ms) for ms in por_canal.values())


async def acuse(usuario_id: int, canal_id: int, mensaje_id: int) -> bool:
    """El aviso push de un mensaje llegó al dispositivo de `usuario_id` (la firma la validó la plataforma, que lo
    envió): segundo ✓ para quien lo escribió."""
    async with SesionRimay() as sesion:
        cambios = await svc.marcar_recibidos(sesion, usuario_id, {canal_id: mensaje_id})
        if cambios:
            await sesion.commit()
            await svc.difundir_lecturas(sesion, canal_id, list(cambios.values()))
    return bool(cambios)


# --- lo que llega por el bus ------------------------------------------------------------------------------------


async def al_publicar(evento) -> None:
    await publicar_sistema(evento.datos or {})


async def al_actualizar(evento) -> None:
    await actualizar(list((evento.datos or {}).get("cambios") or []))


async def al_reapuntar(evento) -> None:
    """«referencias.reapuntar» (Tareas y Agenda fusionó eventos repetidos): los mensajes que nombraban a los
    absorbidos nombran al que queda."""
    d = (evento.datos or {}).get("datos") or {}   # el sobre de minka_eventos.emitir: {entidad, datos, clave, usuario_id}
    viejos, nuevo = list(d.get("viejos") or []), str(d.get("nuevo") or "")
    if not viejos or not nuevo:
        return
    async with SesionRimay() as sesion:
        await sesion.execute(update(Mensaje).where(Mensaje.entidad.in_(viejos)).values(entidad=nuevo))
        await sesion.commit()


# --- el puente de Telegram (Rimay R2): Qillqa le pide enviar al grupo (la acción `telegram` de una regla) ----------


def telegram_activo() -> bool:
    from rimay import telegram as svc_telegram

    return svc_telegram.activo()


async def telegram(texto: str) -> bool:
    from rimay import telegram as svc_telegram

    return await svc_telegram.enviar(texto)


class _Superficie:
    """Resuelve cada nombre al usarlo y rechaza lo que no está en la lista (el contrato se cumple)."""

    def __init__(self, nombre: str, funciones: tuple[str, ...]) -> None:
        self._nombre, self._funciones = nombre, funciones

    def __getattr__(self, nombre: str):
        if nombre in self._funciones:
            return globals()[nombre]
        raise AttributeError(f"«{nombre}» no es parte de «{self._nombre}» (servicios/rimay_contrato.py)")

    def __dir__(self):
        return sorted(self._funciones)


CONVERSACIONES_V1 = _Superficie("conversaciones.v1", ("canal", "del_sistema", "publicar_sistema", "actualizar", "acuse",
                                                       "telegram_activo", "telegram"))
