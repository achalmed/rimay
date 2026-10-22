/**
 * SOCKET DEL CHAT (fase 8.3, 2026-10-12): UNA conexión por pestaña a `/api/chat/ws?token=`
 * (el JWT de la sesión, como `Presencia.tsx` con Hocuspocus), compartida por el contador de
 * la barra y por la página del chat. Lo que llega se reparte por `window` con el evento
 * `qillqa:chat` (detalle = el JSON del servidor); un `aviso` de la campana dispara además
 * `qillqa:avisos`, que `CampanaNotificaciones` ya escucha.
 *
 * El socket es la aceleración; la API es la verdad (propuesta §5.3): si cae, se reintenta con
 * espera creciente (1 s … 30 s) y, mientras tanto, cada 10 s se emite `{tipo:'sondeo'}` para
 * que quien tenga algo abierto pregunte a la API (`/no-leidos`, `?desde_id=`). Al volver a
 * conectar se emite `{tipo:'conectado'}` con el mismo fin.
 *
 * Avisos (2026-10-13): la pestaña cuenta qué conversación tiene abierta y si está a la vista
 * (`ponerViendo` → `{tipo:'viendo'}`; se repite al reconectar y al ocultarse o mostrarse), para que
 * el servidor no mande un aviso push ni pida sonar por lo que ya se tiene delante. Llegan `lecturas`
 * (el ✓✓ de lo propio) y `alerta` (sonar: lo atiende `ContadorChat`).
 */
import { useEffect, useRef } from 'react'
import { recargarAvisos } from './apoyo'
import type { Canal, Encuesta, Mensaje, Reaccion } from './mensajes'

export const EVENTO_CHAT = 'qillqa:chat'

export type Suceso =
  | { tipo: 'mensaje'; canal_id: number; mensaje: Mensaje }
  | { tipo: 'mensaje_editado'; canal_id: number; mensaje: Mensaje }
  | { tipo: 'mensaje_eliminado'; canal_id: number; mensaje_id: number }
  | { tipo: 'canal'; canal: Canal }
  | { tipo: 'escribiendo'; canal_id: number; usuario_id: number; nombre: string }
  /** Alguien reaccionó: el resumen trae `mia: false` para todos (se recalcula con `idDelToken`). */
  | { tipo: 'reaccion'; canal_id: number; mensaje_id: number; reacciones: Reaccion[]; usuario_id: number; emoji: string }
  /** Resultados al día de una encuesta (fase 9.6): cada persona recibe los suyos, con su «mía». */
  | { tipo: 'encuesta'; canal_id: number; mensaje_id: number; encuesta: Encuesta }
  /** Sin socket: cada 10 s, para que quien escucha pregunte a la API. */
  | { tipo: 'sondeo' }
  | { tipo: 'conectado' }
  | { tipo: 'desconectado' }
  /** Emitido por la propia web al marcar leído un canal (los contadores se refrescan). */
  | { tipo: 'leido'; canal_id: number }
  /** Hasta dónde recibieron y leyeron los integrantes (2026-10-13): el ✓✓ de lo propio. */
  | { tipo: 'lecturas'; canal_id: number; cambios: { usuario_id: number; ultimo_leido_id: number; ultimo_recibido_id: number }[] }
  /** Un mensaje que merece sonar (el servidor ya miró silencio, menciones y lo que se tiene abierto). */
  | { tipo: 'alerta'; canal_id: number; mensaje_id: number; mencion: boolean }

const SONDEO_MS = 10_000
const ESPERA_MAX_MS = 30_000

let socket: WebSocket | null = null
let usos = 0
let intentos = 0
let conectado = false
let cerrandoAdrede = false
let reintento: number | null = null
let sondeo: number | null = null
// Lo que esta pestaña tiene abierto (avisos, 2026-10-13).
let viendoCanal: number | null = null

function contarViendo(): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ tipo: 'viendo', canal_id: viendoCanal, visible: document.visibilityState === 'visible' }))
  }
}

/** La conversación abierta en esta pestaña (null al salir de ella). */
export function ponerViendo(canalId: number | null): void {
  viendoCanal = canalId
  contarViendo()
}

/** ¿Esta pestaña tiene ESA conversación abierta y a la vista? */
export const estaViendo = (canalId: number): boolean => viendoCanal === canalId && document.visibilityState === 'visible'

export function emitirChat(detalle: Suceso): void {
  window.dispatchEvent(new CustomEvent<Suceso>(EVENTO_CHAT, { detail: detalle }))
}

export const socketConectado = (): boolean => conectado

const sinChat = (): boolean => !localStorage.getItem('qillqa_token') || localStorage.getItem('qillqa_rol') === 'invitado'

const url = (): string =>
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/chat/ws?token=${encodeURIComponent(localStorage.getItem('qillqa_token') ?? '')}`

function empezarSondeo(): void {
  if (sondeo !== null) return
  sondeo = window.setInterval(() => {
    if (usos > 0 && !conectado && document.visibilityState === 'visible') emitirChat({ tipo: 'sondeo' })
  }, SONDEO_MS)
}

function pararSondeo(): void {
  if (sondeo !== null) window.clearInterval(sondeo)
  sondeo = null
}

function programarReintento(): void {
  if (reintento !== null || usos === 0 || cerrandoAdrede) return
  const espera = Math.min(ESPERA_MAX_MS, 1000 * 2 ** Math.min(intentos, 5))
  intentos += 1
  reintento = window.setTimeout(() => {
    reintento = null
    abrir()
  }, espera)
}

function abrir(): void {
  if (socket || usos === 0 || sinChat()) return
  let s: WebSocket
  try {
    s = new WebSocket(url())
  } catch {
    programarReintento()
    return
  }
  socket = s
  // Un socket que ya no es EL socket (cerrado adrede y reemplazado, p. ej. por el doble montaje de
  // StrictMode) no debe tocar nada: su cierre tardío borraba la referencia al nuevo y quedaban dos
  // conectados (todo llegaba dos veces y el servidor creía la pestaña a la vista). 2026-10-13.
  s.onopen = () => {
    if (socket !== s) {
      s.close()
      return
    }
    conectado = true
    intentos = 0
    contarViendo()
    pararSondeo()
    emitirChat({ tipo: 'conectado' })
  }
  s.onmessage = (ev: MessageEvent<string>) => {
    if (socket !== s) return
    let datos: { tipo?: string } & Record<string, unknown>
    try {
      datos = JSON.parse(ev.data) as { tipo?: string } & Record<string, unknown>
    } catch {
      return
    }
    if (!datos.tipo || datos.tipo === 'ping') return
    if (datos.tipo === 'aviso') {
      recargarAvisos()
      return
    }
    emitirChat(datos as unknown as Suceso)
  }
  s.onclose = (ev: CloseEvent) => {
    if (socket !== s) return
    socket = null
    const estaba = conectado
    conectado = false
    if (estaba) emitirChat({ tipo: 'desconectado' })
    // 4401/4403: la sesión no vale o es invitado; no insistir.
    if (cerrandoAdrede || ev.code === 4401 || ev.code === 4403) return
    empezarSondeo()
    programarReintento()
  }
  s.onerror = () => {
    /* onclose llega después y decide */
  }
}

function cerrar(): void {
  cerrandoAdrede = true
  if (reintento !== null) window.clearTimeout(reintento)
  reintento = null
  pararSondeo()
  socket?.close()
  socket = null
  conectado = false
  cerrandoAdrede = false
}

function reconectarYa(): void {
  if (usos === 0 || socket) return
  if (reintento !== null) window.clearTimeout(reintento)
  reintento = null
  abrir()
}

/** Mantiene abierta la conexión mientras haya al menos un componente montado que la use. */
export function useChatSocket(): void {
  useEffect(() => {
    if (sinChat()) return
    usos += 1
    if (usos === 1) {
      abrir()
      window.addEventListener('online', reconectarYa)
      document.addEventListener('visibilitychange', alMostrar)
    }
    return () => {
      usos -= 1
      if (usos === 0) {
        window.removeEventListener('online', reconectarYa)
        document.removeEventListener('visibilitychange', alMostrar)
        cerrar()
      }
    }
  }, [])
}

function alMostrar(): void {
  contarViendo()
  if (document.visibilityState === 'visible') reconectarYa()
}

/** Escucha lo que llega por el chat; el manejador puede cambiar sin volver a suscribirse. */
export function useSucesosChat(manejador: (s: Suceso) => void): void {
  const ref = useRef(manejador)
  ref.current = manejador
  useEffect(() => {
    const f = (e: Event) => ref.current((e as CustomEvent<Suceso>).detail)
    window.addEventListener(EVENTO_CHAT, f)
    return () => window.removeEventListener(EVENTO_CHAT, f)
  }, [])
}

/** Avisa a los demás lectores del canal que se está escribiendo (si hay socket). */
export function enviarEscribiendo(canalId: number): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ tipo: 'escribiendo', canal_id: canalId }))
}
