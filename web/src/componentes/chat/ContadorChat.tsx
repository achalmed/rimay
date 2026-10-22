/**
 * CONTADOR DEL CHAT en la barra superior (fase 8.3): el icono con los mensajes sin leer,
 * junto a la campana. Es quien mantiene abierto el socket del chat en cada pantalla con
 * sesión (`useChatSocket`): así los avisos en vivo llegan aunque no se esté en /chat.
 * Lee `/api/chat/no-leidos` al montar, al volver el foco, con cada suceso del socket y al
 * sondeo sin socket. La cuenta de invitado no tiene chat: no pinta nada.
 *
 * Como está en todas las pantallas, también hace sonar Qillqa (2026-10-13): con cada `alerta` del
 * socket (un mensaje que merece aviso y que no se está mirando) toca la firma de llegada
 * (`sonidos.ts`); con la pestaña oculta, solo si este dispositivo no tiene avisos push (si los
 * tiene, avisa el sistema operativo). Y al entrar vuelve a guardar la suscripción push del
 * dispositivo para la cuenta que entró (`resincronizarAvisos`).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import Badge from '@mui/material/Badge'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined'
import { api } from '@qillqa/tiqsi'
import { desdeMenu, publicarCuenta, pushActivoAqui, registrarApertura, resincronizarAvisos } from './apoyo'
import { estaViendo, useChatSocket, useSucesosChat } from './socket'
import { prepararSonidos, sonarLlegada, sonarMencion } from './sonidos'

let preparado = false

/** Con dos pestañas abiertas, el mismo mensaje suena una sola vez (la primera que lo reclama). */
function primeraPestana(mensajeId: number): boolean {
  try {
    if (localStorage.getItem('qillqa_sonido_ultimo') === String(mensajeId)) return false
    localStorage.setItem('qillqa_sonido_ultimo', String(mensajeId))
  } catch {
    /* sin almacenamiento: suena */
  }
  return true
}

const REFRESCAN = new Set(['mensaje', 'mensaje_eliminado', 'canal', 'leido', 'sondeo', 'conectado'])

export default function ContadorChat() {
  const navegar = useNavigate()
  const invitado = localStorage.getItem('qillqa_rol') === 'invitado'
  const [total, setTotal] = useState(0)
  const temporizador = useRef<number | null>(null)
  useChatSocket()
  // El botón único del celular (src/actividad.ts).
  useEffect(() => { publicarCuenta(total) }, [total])
  useEffect(() => { registrarApertura(() => navegar('/chat', desdeMenu())); return () => registrarApertura(null) }, [navegar])

  const cargar = useCallback(() => {
    if (invitado) return
    api<{ total: number }>('/api/chat/no-leidos').then((r) => setTotal(r.total)).catch(() => {})
  }, [invitado])

  // Varios sucesos seguidos (una ráfaga de mensajes) piden la cuenta una sola vez.
  const programar = useCallback(() => {
    if (temporizador.current !== null) window.clearTimeout(temporizador.current)
    temporizador.current = window.setTimeout(() => {
      temporizador.current = null
      cargar()
    }, 400)
  }, [cargar])

  // Tocar un aviso push con Qillqa ya abierto: el service worker pide ir a la conversación (sin recargar).
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const f = (e: MessageEvent) => {
      const d = e.data as { tipo?: string; url?: string } | null
      // `sgdp:abrir`: lo manda un worker de antes del 2026-10-22 hasta que el navegador lo cambie.
      if ((d?.tipo !== 'qillqa:abrir' && d?.tipo !== 'sgdp:abrir') || !d.url) return
      const u = new URL(d.url, location.origin)
      if (u.origin === location.origin) navegar(`${u.pathname}${u.search}`)
    }
    navigator.serviceWorker.addEventListener('message', f)
    return () => navigator.serviceWorker.removeEventListener('message', f)
  }, [navegar])

  useEffect(() => {
    if (invitado || preparado) return
    preparado = true
    prepararSonidos()
    void resincronizarAvisos()
  }, [invitado])

  useEffect(() => {
    cargar()
    window.addEventListener('focus', cargar)
    return () => {
      window.removeEventListener('focus', cargar)
      if (temporizador.current !== null) window.clearTimeout(temporizador.current)
    }
  }, [cargar])

  useSucesosChat((s) => {
    if (REFRESCAN.has(s.tipo)) programar()
    if (s.tipo === 'alerta' && !estaViendo(s.canal_id)) {
      const oculta = document.visibilityState !== 'visible'
      if ((!oculta || !pushActivoAqui()) && primeraPestana(s.mensaje_id)) {
        if (s.mencion) sonarMencion()
        else sonarLlegada()
      }
    }
  })

  if (invitado) return null
  return (
    <Tooltip title={total ? `Chat: ${total} mensaje${total === 1 ? '' : 's'} sin leer` : 'Chat'}>
      <IconButton color="inherit" onClick={() => navegar('/chat', desdeMenu())} aria-label="Chat">
        <Badge badgeContent={total} color="warning" max={99}>
          <ForumOutlinedIcon />
        </Badge>
      </IconButton>
    </Tooltip>
  )
}
