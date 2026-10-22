/**
 * Lo pequeño que el chat usa y antes tomaba de Qillqa (proyecto Rimay; fase 10.2b R4, 2026-10-20): lo puro es suyo
 * (copiado, para no importar nada de la plataforma) y lo que solo tiene el anfitrión lo pide por nombre con
 * `servicio()` de Tiqsi web: los archivos que se guardan para verlos sin red, la actividad del encabezado, el aviso
 * push, la ficha de una persona, a dónde lleva una referencia y la cola sin conexión. Solo (la cáscara mínima), esos
 * servicios no están y su ayuda no aparece.
 */
import { descargarBlob, servicio } from '@qillqa/tiqsi'

// --- puro ----------------------------------------------------------------------------------------------------------

/** AAAA-MM-DD de una fecha, en la hora de aquí. */
export const isoDia = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Lo vinculado a un mensaje o una tarea: su clave («doc:12») y cómo se lee. */
export interface Vinculo {
  id: string
  texto: string
}

/**
 * Copia un texto llano («Copiar» de un mensaje, para pegarlo en el grupo de Telegram o WhatsApp). Primero seleccionando
 * una copia oculta (como Ctrl+C), que es síncrono y vale dentro del clic aunque el sitio no tenga HTTPS o el permiso del
 * portapapeles esté negado; si el navegador no lo admite, con el portapapeles moderno. En ese orden porque un intento
 * fallido del moderno gasta el gesto del clic y la copia oculta ya no se permite después. (La misma regla que
 * `copiar.ts` de Qillqa.)
 */
export async function copiarTexto(texto: string): Promise<void> {
  const copia = document.createElement('textarea')
  copia.value = texto
  copia.setAttribute('readonly', '')
  Object.assign(copia.style, { position: 'fixed', left: '-10000px', top: '0' })
  document.body.appendChild(copia)
  copia.select()
  copia.setSelectionRange(0, texto.length)  // iPhone: select() solo no basta
  let ok = false
  try {
    ok = document.execCommand('copy')
  } finally {
    copia.remove()
  }
  if (ok) return
  if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('No se pudo copiar. Mantenga pulsado el texto para copiarlo.')
  try {
    await navigator.clipboard.writeText(texto)
  } catch (e) {
    const t = e instanceof Error ? e.message : String(e)
    if (/not focused/i.test(t)) throw new Error('Haga clic en la página y vuelva a pulsar Copiar.')
    if (/permission|not allowed|NotAllowed/i.test(t)) {
      throw new Error('El navegador bloqueó el portapapeles para este sitio. Permítalo desde el candado de la barra de direcciones.')
    }
    throw e instanceof Error ? e : new Error(t)
  }
}

// --- lo del anfitrión ----------------------------------------------------------------------------------------------

/** Un archivo del chat como blob; el anfitrión lo guarda para verlo sin red («archivos.traer»). */
export async function traerArchivo(ruta: string, nombre = ''): Promise<{ blob: Blob; nombre: string }> {
  const traer = servicio<(r: string, n: string) => Promise<{ blob: Blob; nombre: string }>>('archivos.traer')
  return traer ? traer(ruta, nombre) : { blob: await descargarBlob(ruta), nombre }
}

/** Cuántos mensajes sin leer, para el encabezado del anfitrión («actividad.*»). */
export const publicarCuenta = (n: number): void => servicio<(c: string, n: number) => void>('actividad.publicar_cuenta')?.('chat', n)
export const registrarApertura = (abrir: ((ancla: HTMLElement) => void) | null): void =>
  servicio<(c: string, a: ((ancla: HTMLElement) => void) | null) => void>('actividad.registrar_apertura')?.('chat', abrir)

/** Cómo navega el anfitrión «desde el menú» (lo que su marco espera para no volver atrás); sin él, nada. */
export const desdeMenu = (): { state?: unknown } | undefined => servicio<() => { state?: unknown }>('navegacion.desde_menu')?.()

/** Llegó un aviso de la campana por el socket: el anfitrión la recarga. */
export const recargarAvisos = (): void => servicio<() => void>('avisos.recargar')?.()

/** El aviso push de este dispositivo (de la plataforma): ¿activo?, ponerlo al día, cerrar los de una conversación. */
export const pushActivoAqui = (): boolean => servicio<() => boolean>('push.activo_aqui')?.() ?? false
export const resincronizarAvisos = (): Promise<void> => servicio<() => Promise<void>>('push.resincronizar')?.() ?? Promise.resolve()
export const cerrarAvisosDe = (tag: string): void => servicio<(t: string) => void>('push.cerrar_de')?.(tag)

/** La ficha de una persona (la abre el anfitrión). */
export const abrirTarjeta = (id: number | null | undefined): void => servicio<(i: number | null | undefined) => void>('personas.abrir_tarjeta')?.(id)
export const hayTarjeta = (): boolean => Boolean(servicio('personas.abrir_tarjeta'))

/** A dónde lleva una referencia («doc:12» → /documentos/12); null si el anfitrión no la conoce. */
export const rutaVinculo = (clave: string): string | null => servicio<(c: string) => string | null>('referencias.ruta')?.(clave) ?? null

/** Lo que se puede enlazar o vincular (normas, documentos, proyectos…) según lo escrito, o nada («referencias.buscar»). */
export const buscarReferencias = <R,>(q: string, contexto: string): Promise<R[]> =>
  servicio<(q: string, c: string) => Promise<R[]>>('referencias.buscar')?.(q, contexto).catch(() => []) ?? Promise.resolve([])

/** El prefijo de cada resultado del buscador de referencias y el nombre de cada grupo (del anfitrión). */
export function prefijos(): { PREFIJO_REFERENCIA: Record<string, string>; NOMBRE_PREFIJO: Record<string, string> } {
  return servicio<() => ReturnType<typeof prefijos>>('referencias.prefijos')?.() ?? { PREFIJO_REFERENCIA: {}, NOMBRE_PREFIJO: {} }
}

// --- la cola sin conexión (del anfitrión) --------------------------------------------------------------------------

export interface CambioPendiente {
  id: string
  cuerpo: string
}

/** Deja el mensaje en la cola del anfitrión para cuando vuelva el servidor. `false` si no tiene cola (solo). */
export function encolarMensaje(ruta: string, cuerpo: string, rotulo: string): boolean {
  const encolar = servicio<(r: string, c: string, ro: string, t: string) => void>('sinconexion.encolar')
  if (!encolar) return false
  encolar(ruta, cuerpo, rotulo, 'mensaje')
  return true
}

export const mensajesEnEspera = (ruta: string): CambioPendiente[] =>
  servicio<(r: string) => CambioPendiente[]>('sinconexion.en_espera')?.(ruta) ?? []

export const alCambiarCola = (fn: () => void): (() => void) =>
  servicio<(f: () => void) => () => void>('sinconexion.al_cambiar')?.(fn) ?? (() => {})
