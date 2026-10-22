/**
 * GRABAR UNA NOTA DE VOZ (2026-10-12, fase 9.6): el micrófono con `MediaRecorder`, en webm/opus
 * (Chrome, Android, Firefox) o mp4/aac (Safari de iOS), según `formatoGrabacion`. El hook lleva
 * el estado (pidiendo permiso, grabando), el contador en ms y devuelve al terminar un `File`
 * llamado `nota-de-voz-AAAAMMDD-HHMMSS.<ext>` con su duración: quien lo usa lo sube por el
 * endpoint de archivos de siempre. El micrófono solo se abre en una dirección segura (https o
 * localhost); fuera de ella `getUserMedia` no existe y se dice así.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { extDeTipo, formatoGrabacion, nombreNotaDeVoz } from './mensajes'

export type EstadoGrabadora = 'inactiva' | 'pidiendo' | 'grabando'

export interface NotaGrabada {
  archivo: File
  duracion_ms: number
}

/** Lo que dura como mucho una nota (luego se envía sola). */
export const MAX_NOTA_MS = 15 * 60 * 1000
/** Menos que esto se descarta (un toque sin querer). */
export const MIN_NOTA_MS = 700

export const grabadoraDisponible = (): boolean => typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined'

function motivo(e: unknown): string {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return 'El micrófono solo funciona en la dirección segura del sistema (https).'
  const nombre = (e as { name?: string } | null)?.name ?? ''
  if (nombre === 'NotAllowedError' || nombre === 'SecurityError') return 'Permita el micrófono en el navegador para grabar.'
  if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError') return 'No se encontró un micrófono en este equipo.'
  if (nombre === 'NotReadableError') return 'Otra aplicación está usando el micrófono.'
  return 'No se pudo abrir el micrófono.'
}

export function useGrabadora() {
  const [estado, setEstado] = useState<EstadoGrabadora>('inactiva')
  const [ms, setMs] = useState(0)
  const grabador = useRef<MediaRecorder | null>(null)
  const flujo = useRef<MediaStream | null>(null)
  const trozos = useRef<Blob[]>([])
  const inicio = useRef(0)
  const reloj = useRef<number | null>(null)
  const ext = useRef('')

  const soltar = useCallback(() => {
    if (reloj.current !== null) window.clearInterval(reloj.current)
    reloj.current = null
    flujo.current?.getTracks().forEach((t) => t.stop())
    flujo.current = null
    grabador.current = null
    trozos.current = []
    setEstado('inactiva')
    setMs(0)
  }, [])

  useEffect(() => () => {
    if (grabador.current && grabador.current.state !== 'inactive') {
      grabador.current.onstop = null
      grabador.current.stop()
    }
    flujo.current?.getTracks().forEach((t) => t.stop())
    if (reloj.current !== null) window.clearInterval(reloj.current)
  }, [])

  /** Pide el micrófono y empieza a grabar. Lanza Error con el motivo legible si no se puede. */
  const empezar = useCallback(async () => {
    if (grabador.current) return
    setEstado('pidiendo')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('inseguro')
      const f = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      flujo.current = f
      const formato = formatoGrabacion((m) => MediaRecorder.isTypeSupported(m))
      ext.current = formato.ext
      const r = new MediaRecorder(f, formato.mime ? { mimeType: formato.mime, audioBitsPerSecond: 32000 } : undefined)
      trozos.current = []
      r.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) trozos.current.push(e.data)
      }
      grabador.current = r
      r.start(250)
      inicio.current = performance.now()
      setMs(0)
      reloj.current = window.setInterval(() => setMs(performance.now() - inicio.current), 200)
      setEstado('grabando')
      if (navigator.vibrate) navigator.vibrate(15)
    } catch (e) {
      soltar()
      throw new Error(motivo(e))
    }
  }, [soltar])

  /** Termina y entrega la nota (null si fue demasiado corta o no había grabación). */
  const terminar = useCallback(
    () =>
      new Promise<NotaGrabada | null>((resolver) => {
        const r = grabador.current
        if (!r || r.state === 'inactive') {
          soltar()
          resolver(null)
          return
        }
        const duracion = performance.now() - inicio.current
        r.onstop = () => {
          const tipo = (r.mimeType || 'audio/webm').split(';')[0]
          const blob = new Blob(trozos.current, { type: tipo })
          const nombre = nombreNotaDeVoz(new Date(), ext.current || extDeTipo(r.mimeType))
          soltar()
          if (duracion < MIN_NOTA_MS || blob.size === 0) return resolver(null)
          resolver({ archivo: new File([blob], nombre, { type: tipo }), duracion_ms: Math.round(duracion) })
        }
        r.stop()
      }),
    [soltar],
  )

  /** Descarta lo grabado. */
  const cancelar = useCallback(() => {
    const r = grabador.current
    if (r && r.state !== 'inactive') {
      r.onstop = null
      r.stop()
    }
    soltar()
  }, [soltar])

  return { estado, ms, empezar, terminar, cancelar }
}
