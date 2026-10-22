/**
 * VISTO Y LEÍDO y TEMAS POR SECCIÓN — lógica PURA del chat (2026-10-13). Sin React ni API: la
 * prueba `pruebas/chatEntrega.test.ts` la carga con `node --test`, así que no importa nada de `src/`.
 *
 * Las marcas de un mensaje PROPIO, como en WhatsApp:
 *   ✓      enviado: el servidor lo guardó;
 *   ✓✓     recibido: llegó a un dispositivo de cada integrante (socket abierto, la lista o el aviso push);
 *   ✓✓ (color) leído: cada integrante lo vio (`/leido`).
 *   reloj  pendiente: aún no llegó al servidor (sin red; el id es provisional, ≤ 0).
 * En un grupo o un tema la marca es la del más atrasado (todos recibieron, todos leyeron) y «Leído
 * por» dice quién, al mantener pulsado. De cada integrante bastan dos números por canal:
 * `ultimo_recibido_id` y `ultimo_leido_id` (`canal_miembros`), así que no hay una fila por mensaje.
 */

export type EstadoEntrega = 'pendiente' | 'enviado' | 'recibido' | 'leido'

export interface Lectura {
  usuario_id: number
  nombre?: string
  ultimo_leido_id: number | null
  ultimo_recibido_id?: number | null
}

const recibidoDe = (l: Lectura): number => Math.max(l.ultimo_recibido_id ?? 0, l.ultimo_leido_id ?? 0)
const leidoDe = (l: Lectura): number => l.ultimo_leido_id ?? 0

/** La marca de un mensaje propio, con las lecturas de los DEMÁS integrantes del canal. */
export function estadoEntrega(mensajeId: number, lecturas: Lectura[], miId: number | null): EstadoEntrega {
  if (!(mensajeId > 0)) return 'pendiente'
  const otros = lecturas.filter((l) => l.usuario_id !== miId)
  if (otros.length === 0) return 'enviado'
  if (otros.every((l) => leidoDe(l) >= mensajeId)) return 'leido'
  if (otros.every((l) => recibidoDe(l) >= mensajeId)) return 'recibido'
  return 'enviado'
}

/** Quién leyó, a quién solo le llegó y a quién todavía no (para «Info del mensaje»). */
export function detalleLecturas(mensajeId: number, lecturas: Lectura[], miId: number | null): { leyeron: Lectura[]; recibieron: Lectura[]; faltan: Lectura[] } {
  const otros = lecturas.filter((l) => l.usuario_id !== miId)
  return {
    leyeron: otros.filter((l) => leidoDe(l) >= mensajeId),
    recibieron: otros.filter((l) => leidoDe(l) < mensajeId && recibidoDe(l) >= mensajeId),
    faltan: otros.filter((l) => recibidoDe(l) < mensajeId),
  }
}

/** «Leído por 2 de 3» (grupo), «Leído» / «Recibido» / «Enviado» (directo). */
export function rotuloLecturas(mensajeId: number, lecturas: Lectura[], miId: number | null): string {
  const d = detalleLecturas(mensajeId, lecturas, miId)
  const total = d.leyeron.length + d.recibieron.length + d.faltan.length
  if (total <= 1) return { leido: 'Leído', recibido: 'Recibido', enviado: 'Enviado', pendiente: 'Pendiente' }[estadoEntrega(mensajeId, lecturas, miId)]
  return `Leído por ${d.leyeron.length} de ${total}`
}

/** Lo que llega por el socket (`lecturas`) sobre lo que ya se tenía: nunca baja un número. */
export function fusionarLecturas(actuales: Lectura[], cambios: Lectura[]): Lectura[] {
  const salida = actuales.map((l) => ({ ...l }))
  for (const c of cambios) {
    const i = salida.findIndex((l) => l.usuario_id === c.usuario_id)
    if (i === -1) {
      salida.push({ ...c })
      continue
    }
    const l = salida[i]
    salida[i] = {
      ...l,
      ultimo_leido_id: Math.max(leidoDe(l), c.ultimo_leido_id ?? 0),
      ultimo_recibido_id: Math.max(recibidoDe(l), c.ultimo_recibido_id ?? 0, c.ultimo_leido_id ?? 0),
    }
  }
  return salida
}

// --- temas por sección (como los «topics» de un foro, sin copiar a nadie) -------------------------

/** Las secciones en este orden; las que cree quien administra van después, por nombre, y al final «Otros temas». */
export const ORDEN_CATEGORIAS = ['Equipo', 'Documentos', 'Agenda', 'Legislativo', 'Prensa y medios', 'Representación'] as const
export const OTROS_TEMAS = 'Otros temas'

// La misma tabla que `servicios/chat.py::CATEGORIA_FABRICA` (por si la API vieja no manda `categoria`).
const CATEGORIA_FABRICA: Record<string, string> = {
  general: 'Equipo', atencion: 'Representación', representacion: 'Representación',
  recibidos: 'Documentos', 'mesa-de-partes': 'Documentos', documentos: 'Documentos', 'documentos-listos': 'Documentos',
  'documentos-enviados': 'Documentos', seguimiento: 'Documentos', borradores: 'Documentos',
  agenda: 'Agenda', programacion: 'Agenda', reuniones: 'Agenda',
  proyectos: 'Legislativo', pleno: 'Legislativo', comisiones: 'Legislativo',
  prensa: 'Prensa y medios', noticias: 'Prensa y medios', fotos: 'Prensa y medios',
}

export function categoriaDe(c: { categoria?: string; clave: string }): string {
  return (c.categoria || '').trim() || CATEGORIA_FABRICA[c.clave] || OTROS_TEMAS
}

interface TemaMin {
  canal: { id: number; categoria?: string; clave: string; no_leidos: number; silenciado?: boolean }
  hijos: { id: number; no_leidos: number; silenciado?: boolean }[]
}

/** Lo sin leer de un tema y sus subtemas (lo silenciado no suma, como en el contador de la barra). */
export function noLeidosDe(t: TemaMin): number {
  const n = (c: { no_leidos: number; silenciado?: boolean }) => (c.silenciado ? 0 : c.no_leidos)
  return n(t.canal) + t.hijos.reduce((s, h) => s + n(h), 0)
}

/**
 * Los temas en sus secciones, en el orden fijo de arriba; dentro de cada una, primero lo que
 * tiene algo sin leer y luego el orden que trajo la API (por recencia). Cada sección dice cuánto
 * tiene sin leer (para mostrarlo con la sección plegada).
 */
export function agruparTemas<T extends TemaMin>(temas: T[]): { categoria: string; temas: T[]; noLeidos: number }[] {
  const por = new Map<string, T[]>()
  for (const t of temas) {
    const cat = categoriaDe(t.canal)
    por.set(cat, [...(por.get(cat) ?? []), t])
  }
  const fijas = ORDEN_CATEGORIAS.filter((c) => por.has(c)) as string[]
  const propias = [...por.keys()].filter((c) => !fijas.includes(c) && c !== OTROS_TEMAS).sort((a, b) => a.localeCompare(b, 'es'))
  const orden = [...fijas, ...propias, ...(por.has(OTROS_TEMAS) ? [OTROS_TEMAS] : [])]
  return orden.map((categoria) => {
    const lista = por.get(categoria)!.slice().sort((a, b) => Number(noLeidosDe(b) > 0) - Number(noLeidosDe(a) > 0))
    return { categoria, temas: lista, noLeidos: lista.reduce((s, t) => s + noLeidosDe(t), 0) }
  })
}
