/**
 * SONIDOS PROPIOS DE QILLQA (2026-10-13; Edison: «para saber que viene de Qillqa y no de otra app»).
 *
 * Se sintetizan aquí con Web Audio (osciladores y envolventes), sin archivos ni sonidos ajenos:
 *   · ENVÍO: un «plop» corto y suave que sube (≈ 0,12 s), al salir un mensaje propio.
 *   · LLEGADA: la firma de Qillqa, dos notas de campanita que suben una sexta (la5 → fa♯6, ≈ 0,4 s),
 *     al llegar un mensaje con la aplicación abierta en otra conversación u otro módulo.
 *   · MENCIÓN: la misma firma con una nota más (la5 → do♯6 → fa♯6).
 * Con la pestaña oculta suena solo si este dispositivo NO tiene activos los avisos push (si los
 * tiene, avisa el sistema operativo y no se oye dos veces).
 *
 * El navegador no deja sonar nada hasta el primer toque o tecla en la página (`prepararSonidos`
 * desbloquea el audio entonces). El interruptor de Mi perfil (`ponerSonidos`) vale para este
 * dispositivo (localStorage). Límite: el sonido de un aviso PUSH lo elige el sistema operativo
 * (en Android, el canal de notificaciones de Chrome); la Web no puede cambiarlo.
 */

const CLAVE = 'qillqa_sonidos'
let ctx: AudioContext | null = null

export function sonidosActivos(): boolean {
  try {
    return localStorage.getItem(CLAVE) !== 'no'
  } catch {
    return true
  }
}

export function ponerSonidos(activos: boolean): void {
  try {
    localStorage.setItem(CLAVE, activos ? 'si' : 'no')
  } catch {
    /* sin almacenamiento: queda el valor por defecto */
  }
}

function contexto(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!C) return null
    try {
      ctx = new C()
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  return ctx
}

/** Desbloquea el audio con el primer gesto de la persona (lo pide el navegador). Una vez por pestaña. */
export function prepararSonidos(): void {
  if (typeof window === 'undefined') return
  const desbloquear = () => {
    contexto()
    window.removeEventListener('pointerdown', desbloquear)
    window.removeEventListener('keydown', desbloquear)
  }
  window.addEventListener('pointerdown', desbloquear, { passive: true })
  window.addEventListener('keydown', desbloquear)
}

/** Una nota de campanita: fundamental más un armónico tenue, ataque corto y caída exponencial. */
function nota(c: AudioContext, salida: AudioNode, frecuencia: number, inicio: number, duracion: number, volumen: number, glide?: number): void {
  for (const [mult, peso, tipo] of [[1, 1, 'sine'], [2, 0.18, 'sine'], [3, 0.06, 'triangle']] as const) {
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = tipo
    o.frequency.setValueAtTime(frecuencia * mult, inicio)
    if (glide) o.frequency.exponentialRampToValueAtTime(glide * mult, inicio + duracion * 0.5)
    g.gain.setValueAtTime(0.0001, inicio)
    g.gain.exponentialRampToValueAtTime(volumen * peso, inicio + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion)
    o.connect(g).connect(salida)
    o.start(inicio)
    o.stop(inicio + duracion + 0.02)
  }
}

function tocar(notas: { f: number; t: number; d: number; v: number; glide?: number }[]): boolean {
  if (!sonidosActivos()) return false
  const c = contexto()
  if (!c || c.state !== 'running') return false
  // Un compresor suave evita que dos llegadas seguidas saturen.
  const comp = c.createDynamicsCompressor()
  comp.connect(c.destination)
  const t0 = c.currentTime + 0.01
  for (const n of notas) nota(c, comp, n.f, t0 + n.t, n.d, n.v, n.glide)
  return true
}

/** Al enviar: «plop» corto y suave. */
export const sonarEnvio = (): boolean => tocar([{ f: 430, glide: 780, t: 0, d: 0.12, v: 0.07 }])

/** Al llegar un mensaje: la firma de Qillqa (la5 → fa♯6). */
export const sonarLlegada = (): boolean => tocar([{ f: 880, t: 0, d: 0.22, v: 0.1 }, { f: 1480, t: 0.12, d: 0.3, v: 0.09 }])

/** Al mencionarle: la firma con una nota más (la5 → do♯6 → fa♯6). */
export const sonarMencion = (): boolean => tocar([{ f: 880, t: 0, d: 0.2, v: 0.1 }, { f: 1109, t: 0.1, d: 0.2, v: 0.09 }, { f: 1480, t: 0.2, d: 0.32, v: 0.09 }])
