/**
 * EL TECLADO DEL CELULAR (2026-10-12, fase 9.4). En Android (Chrome ≥ 108, modo
 * `resizes-visual`) y en iOS el teclado NO encoge la ventana de diseño: `100dvh` sigue
 * midiendo la pantalla entera y la caja de escritura queda tapada, o la página se desplaza y
 * se lleva la cabecera. Lo que sí cambia es `window.visualViewport` (alto y `offsetTop`): con
 * eso la página del chat se clava a la parte visible (`position: fixed; top: offsetTop;
 * height: alto`) mientras el teclado esté abierto.
 */
import { useEffect, useState } from 'react'

export interface VentanaVisible {
  /** Alto de lo que de verdad se ve (sin el teclado). */
  alto: number
  /** Cuánto se desplazó la parte visible respecto de la ventana de diseño (iOS). */
  arriba: number
  /** Hay un teclado (o algo) que se come al menos 120 px. */
  teclado: boolean
}

const UMBRAL_TECLADO = 120

/** La parte visible de la ventana; null si el navegador no la informa o `activo` es falso. */
export function useVentanaVisible(activo = true): VentanaVisible | null {
  const [v, setV] = useState<VentanaVisible | null>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!activo || !vv) {
      setV(null)
      return
    }
    let marco = 0
    const medir = () => {
      window.cancelAnimationFrame(marco)
      marco = window.requestAnimationFrame(() => {
        const alto = Math.round(vv.height)
        setV({ alto, arriba: Math.round(vv.offsetTop), teclado: window.innerHeight - alto > UMBRAL_TECLADO })
      })
    }
    medir()
    vv.addEventListener('resize', medir)
    vv.addEventListener('scroll', medir)
    window.addEventListener('resize', medir)
    return () => {
      window.cancelAnimationFrame(marco)
      vv.removeEventListener('resize', medir)
      vv.removeEventListener('scroll', medir)
      window.removeEventListener('resize', medir)
    }
  }, [activo])
  return v
}
