/**
 * CONVERSACIÓN (fase 8.3; aspecto WhatsApp/Telegram desde 2026-10-12, fase 9.4): la cabecera
 * del canal (avatar, nombre, descripción y el menú ⋮ con integrantes, silenciar, renombrar,
 * archivar, salir), los mensajes agrupados por día con «Hoy», «Ayer», «lun 12/10» en píldora y
 * los seguidos del mismo autor juntos (`marcarConsecutivos`), la caja de escritura y «Nombre
 * está escribiendo…». Con `padre`, es el HILO de ese mensaje: lista con `padre_id`, el padre
 * citado arriba y en la primera burbuja de cada grupo, y la respuesta va al hilo.
 *
 * La API es la verdad: carga `GET /canales/{id}/mensajes` (50, «Cargar anteriores» con
 * `antes_id` al llegar arriba) y aplica lo que llega por el socket (`fusionar` no duplica lo
 * propio, que vuelve por el socket; `reaccion` recalcula «mía»). Sin socket, el sondeo cada
 * 10 s pide `?desde_id=`. Al mostrar el último mensaje (pestaña visible) manda `/leido`.
 *
 * Lo que un mensaje ofrece (`acciones`) se ejecuta aquí: `registrar` → `POST
 * /mensajes/{id}/registrar`; `archivo_a_recibidos` / `archivo_a_mediateca` → `POST
 * /archivos/{id}/registrar`; la respuesta se muestra como aviso y el sistema publica además
 * su mensaje. Los archivos del dispositivo suben con `subirConProgreso` a
 * `POST /canales/{id}/archivos` (una nota de voz, con su `duracion_ms`).
 *
 * Fase 9.6: las encuestas se votan y se cierran aquí (`POST /encuestas/{id}/voto|cerrar`; los
 * resultados de los demás llegan por el socket, `tipo: 'encuesta'`); lo que pide el «+» de la
 * caja (encuesta, tarea, actividad) lo atiende `HerramientasChat`.
 *
 * 2026-10-13: las lecturas de los integrantes (`GET /canales/{id}` → `miembros`, al día por el
 * socket `lecturas`) dan las marcas ✓ / ✓✓ / ✓✓ leído de lo propio e «Info del mensaje»; la
 * conversación abierta se cuenta al servidor (`ponerViendo`) para no avisar lo que ya se ve; al
 * enviar suena el «plop» de Qillqa.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListSubheader from '@mui/material/ListSubheader'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Snackbar from '@mui/material/Snackbar'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import DriveFileRenameOutlineOutlinedIcon from '@mui/icons-material/DriveFileRenameOutlineOutlined'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined'
import LinkIcon from '@mui/icons-material/Link'
import LogoutIcon from '@mui/icons-material/Logout'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import NotificationsOffOutlinedIcon from '@mui/icons-material/NotificationsOffOutlined'
import PersonAddAltOutlinedIcon from '@mui/icons-material/PersonAddAltOutlined'
import VolumeOffOutlinedIcon from '@mui/icons-material/VolumeOffOutlined'
import { api, esSinServidor, PALETA, confirmar, pedirTexto } from '@qillqa/tiqsi'
import { encolarMensaje, rutaVinculo, abrirTarjeta, cerrarAvisosDe } from './apoyo'
import EnEspera from './EnEspera'
import AvatarCanal from './AvatarCanal'
import AvatarPersona from './Avatar'
import Burbuja from './Burbuja'
import DialogoLecturas from './DialogoLecturas'
import { categoriaDe, estadoEntrega, fusionarLecturas, ORDEN_CATEGORIAS, OTROS_TEMAS, type Lectura } from './entrega'
import { sonarEnvio } from './sonidos'
import CajaMensaje, { type Envio, type Subida } from './CajaMensaje'
import HerramientasChat, { type Herramienta } from './HerramientasChat'
import {
  agruparPorDia, colorDePersona, fusionar, fusionarReacciones, marcarConsecutivos, nombreEntidad, otroDelDirecto, plural,
  type Accion, type Canal, type Encuesta, type Mensaje, type Miembro, type PersonaEquipo, type Reaccion,
} from './mensajes'
import { emitirChat, enviarEscribiendo, ponerViendo, useSucesosChat } from './socket'
import { subirConProgreso } from './subida'

interface Props {
  canal: Canal
  /** Con padre, esta vista es el hilo de ese mensaje. */
  padre?: Mensaje
  equipo: PersonaEquipo[]
  miId: number | null
  esAdmin: boolean
  /** `?mensaje=N`: se desplaza hasta él si está cargado. */
  destacado?: number | null
  alAbrirHilo?: (m: Mensaje) => void
  /** En el celular (o en el hilo): el botón para volver. */
  alVolver?: () => void
  /** El canal cambió (nombre, integrantes): la lista se recarga. */
  alCambiar: () => void
  /** Se salió del canal o se archivó. */
  alSalir?: () => void
}

const LIMITE = 50
const SILENCIOS: { horas: number; texto: string }[] = [
  { horas: 8, texto: '8 horas' },
  { horas: 24, texto: '1 día' },
  { horas: 168, texto: '1 semana' },
]

export default function Conversacion({ canal, padre, equipo, miId, esAdmin, destacado, alAbrirHilo, alVolver, alCambiar, alSalir }: Props) {
  const navegar = useNavigate()
  const [mensajes, setMensajes] = useState<Mensaje[] | null>(null)
  const [hayMas, setHayMas] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState<{ texto: string; tipo: 'success' | 'error' | 'info' } | null>(null)
  const [detalle, setDetalle] = useState<{ miembros: Miembro[]; papel: string } | null>(null)
  const [editando, setEditando] = useState<{ id: number; texto: string } | null>(null)
  const [escriben, setEscriben] = useState<string[]>([])
  const [ancla, setAncla] = useState<HTMLElement | null>(null)
  const [verIntegrantes, setVerIntegrantes] = useState(false)
  const [anadir, setAnadir] = useState(false)
  const [resaltado, setResaltado] = useState<number | null>(null)
  const [subida, setSubida] = useState<Subida | null>(null)
  const [hechas, setHechas] = useState<Set<string>>(new Set())
  const [silenciadoHasta, setSilenciadoHasta] = useState<string | null>(null)
  const [lecturas, setLecturas] = useState<Lectura[]>([])
  const [info, setInfo] = useState<Mensaje | null>(null)
  const [pedido, setPedido] = useState<{ que: Herramienta; ancla: HTMLElement | null; texto?: string; mensajeId?: number } | null>(null)
  const claveTareas = useRef<string | null>(null)
  const atenderPedido = useCallback(() => setPedido(null), [])
  const lista = useRef<HTMLDivElement | null>(null)
  const pegadoAbajo = useRef(true)
  const ajuste = useRef<number | null>(null)
  const ultimoLeido = useRef(0)
  const temporizadores = useRef<Map<string, number>>(new Map())

  const base = `/api/chat/canales/${canal.id}/mensajes`
  const enHilo = padre ? `&padre_id=${padre.id}` : ''
  const cuentas = equipo.map((p) => p.cuenta).concat(localStorage.getItem('qillqa_usuario') ?? [])
  const papel = detalle?.papel ?? canal.papel
  const administra = esAdmin || papel === 'admin'
  const fallar = (texto: string) => setAviso({ texto, tipo: 'error' })

  // --- carga ---------------------------------------------------------------------------------
  const cargar = useCallback(async () => {
    const r = await api<{ mensajes: Mensaje[]; hay_mas: boolean }>(`${base}?limite=${LIMITE}${enHilo}`)
    pegadoAbajo.current = true
    setMensajes(r.mensajes)
    setHayMas(r.hay_mas)
  }, [base, enHilo])

  useEffect(() => {
    setMensajes(null)
    setError('')
    cargar().catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar los mensajes.'))
  }, [cargar])

  useEffect(() => {
    api<Canal & { miembros: Miembro[] }>(`/api/chat/canales/${canal.id}`)
      .then((r) => {
        if (!padre) setDetalle({ miembros: r.miembros, papel: r.papel })
        setLecturas(r.miembros.map((x) => ({ usuario_id: x.usuario_id, nombre: x.nombre, ultimo_leido_id: x.ultimo_leido_id ?? 0, ultimo_recibido_id: x.ultimo_recibido_id ?? 0 })))
      })
      .catch(() => {})
  }, [canal.id, padre])

  // La conversación abierta en esta pestaña: el servidor no avisa (ni pide sonar) por lo que ya se ve.
  useEffect(() => {
    if (padre) return
    ponerViendo(canal.id)
    cerrarAvisosDe(`chat-${canal.id}`)
    return () => ponerViendo(null)
  }, [canal.id, padre])

  const traerNuevos = useCallback(async () => {
    const ultimo = mensajes?.[mensajes.length - 1]?.id
    if (!ultimo) return cargar()
    const r = await api<{ mensajes: Mensaje[] }>(`${base}?desde_id=${ultimo}&limite=200${enHilo}`)
    if (r.mensajes.length) setMensajes((l) => r.mensajes.reduce((acc, m) => fusionar(acc, m), l ?? []))
  }, [base, enHilo, mensajes, cargar])

  const cargarMas = useCallback(async () => {
    const primero = mensajes?.[0]?.id
    if (!primero || cargandoMas || !hayMas) return
    setCargandoMas(true)
    try {
      const r = await api<{ mensajes: Mensaje[]; hay_mas: boolean }>(`${base}?antes_id=${primero}&limite=${LIMITE}${enHilo}`)
      const el = lista.current
      ajuste.current = el ? el.scrollHeight - el.scrollTop : null
      setMensajes((l) => [...r.mensajes, ...(l ?? [])])
      setHayMas(r.hay_mas)
    } catch {
      /* se vuelve a intentar al desplazar */
    } finally {
      setCargandoMas(false)
    }
  }, [base, enHilo, mensajes, cargandoMas, hayMas])

  // --- lo que llega por el socket ------------------------------------------------------------
  const anunciar = (nombre: string) => {
    const t = temporizadores.current
    const viejo = t.get(nombre)
    if (viejo) window.clearTimeout(viejo)
    t.set(nombre, window.setTimeout(() => {
      t.delete(nombre)
      setEscriben((l) => l.filter((n) => n !== nombre))
    }, 4000))
    setEscriben((l) => (l.includes(nombre) ? l : [...l, nombre]))
  }
  useEffect(() => {
    const t = temporizadores.current
    return () => t.forEach((id) => window.clearTimeout(id))
  }, [])

  useSucesosChat((s) => {
    if (s.tipo === 'sondeo' || s.tipo === 'conectado') return void traerNuevos().catch(() => {})
    if (!('canal_id' in s) || s.canal_id !== canal.id) return
    if (s.tipo === 'lecturas') return void setLecturas((l) => fusionarLecturas(l, s.cambios))
    if (s.tipo === 'mensaje') {
      const m = s.mensaje
      const deAqui = padre ? m.padre_id === padre.id : m.padre_id === null
      if (deAqui) {
        setMensajes((l) => fusionar(l ?? [], m))
        if (m.autor) setEscriben((l) => l.filter((n) => n !== m.autor))
      } else if (!padre && m.padre_id) {
        setMensajes((l) => l?.map((x) => (x.id === m.padre_id ? { ...x, respuestas: x.respuestas + 1 } : x)) ?? l)
      }
    } else if (s.tipo === 'mensaje_editado') {
      // Trae el mensaje entero (texto editado, o los adjuntos y acciones tras una subida): se funde todo.
      setMensajes((l) => l?.map((x) => (x.id === s.mensaje.id ? { ...x, ...s.mensaje } : x)) ?? l)
    } else if (s.tipo === 'mensaje_eliminado') {
      setMensajes((l) => l?.map((x) => (x.id === s.mensaje_id ? { ...x, eliminado: true, texto: '' } : x)) ?? l)
    } else if (s.tipo === 'reaccion') {
      setMensajes((l) => l?.map((x) => (x.id === s.mensaje_id ? { ...x, reacciones: fusionarReacciones(x.reacciones, s.reacciones, s.usuario_id === miId, s.emoji) } : x)) ?? l)
    } else if (s.tipo === 'encuesta') {
      setMensajes((l) => l?.map((x) => (x.id === s.mensaje_id ? { ...x, encuesta: s.encuesta } : x)) ?? l)
    } else if (s.tipo === 'escribiendo' && s.usuario_id !== miId) {
      anunciar(s.nombre)
    }
  })

  // --- desplazamiento y leído ----------------------------------------------------------------
  useLayoutEffect(() => {
    const el = lista.current
    if (!el || !mensajes) return
    if (ajuste.current !== null) {
      el.scrollTop = el.scrollHeight - ajuste.current
      ajuste.current = null
    } else if (pegadoAbajo.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [mensajes])

  // El teclado del celular encoge la lista: si se estaba al final, se sigue viendo el último mensaje.
  useEffect(() => {
    const el = lista.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (pegadoAbajo.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const irAlFinal = () => {
    const el = lista.current
    if (!el) return
    pegadoAbajo.current = true
    // Dos veces: ahora y cuando el teclado ya haya movido la ventana (hasta ~300 ms).
    el.scrollTop = el.scrollHeight
    window.setTimeout(() => { el.scrollTop = el.scrollHeight }, 300)
  }

  useEffect(() => {
    if (!destacado || !mensajes?.some((m) => m.id === destacado)) return
    const nodo = document.getElementById(`mensaje-${destacado}`)
    if (!nodo) return
    pegadoAbajo.current = false
    nodo.scrollIntoView({ block: 'center' })
    setResaltado(destacado)
    const t = window.setTimeout(() => setResaltado(null), 3500)
    return () => window.clearTimeout(t)
    // Solo cuando cambia el mensaje pedido o termina la primera carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destacado, mensajes === null])

  useEffect(() => {
    if (padre || !mensajes?.length) return
    const ultimo = mensajes[mensajes.length - 1].id
    const marcar = () => {
      if (document.visibilityState !== 'visible' || ultimo <= ultimoLeido.current) return
      ultimoLeido.current = ultimo
      api(`/api/chat/canales/${canal.id}/leido`, { method: 'POST', body: JSON.stringify({ mensaje_id: ultimo }) })
        .then(() => emitirChat({ tipo: 'leido', canal_id: canal.id }))
        .catch(() => {})
    }
    marcar()
    document.addEventListener('visibilitychange', marcar)
    return () => document.removeEventListener('visibilitychange', marcar)
  }, [mensajes, canal.id, padre])

  const alDesplazar = () => {
    const el = lista.current
    if (!el) return
    pegadoAbajo.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (el.scrollTop < 60 && hayMas && !cargandoMas) void cargarMas()
  }

  // --- acciones ------------------------------------------------------------------------------
  // En un DIRECTO «Responder» cita el mensaje en la misma conversación, como WhatsApp (2026-10-19,
  // Edison: «los hilos solo en grupos»); en un grupo abre el hilo.
  const [respondiendo, setRespondiendo] = useState<Mensaje | null>(null)
  const citaEnLinea = canal.clase === 'directo' && !padre
  useEffect(() => { setRespondiendo(null) }, [canal.id])
  const porId = useMemo(() => new Map((mensajes ?? []).map((x) => [x.id, x])), [mensajes])
  const enviar = async (e: Envio) => {
    const cuerpo = JSON.stringify({ ...e, padre_id: padre?.id ?? null, responde_a_id: respondiendo?.id ?? null })
    setRespondiendo(null)
    let m: Mensaje
    try {
      m = await api<Mensaje>(base, { method: 'POST', body: cuerpo })
    } catch (error) {
      // Sin servidor (2026-10-13): el mensaje espera en la cola y sale solo al volver (EnEspera).
      if (!esSinServidor(error)) throw error
      encolarMensaje(base, cuerpo, `Mensaje en ${canal.nombre}`)
      pegadoAbajo.current = true
      return
    }
    pegadoAbajo.current = true
    setMensajes((l) => fusionar(l ?? [], m))
    sonarEnvio()
  }

  const subir = async (archivos: File[], extra?: { duracion_ms?: number; texto?: string }) => {
    const fd = new FormData()
    for (const a of archivos.slice(0, 10)) fd.append('archivos', a, a.name)
    // El texto escrito viaja como pie de las imágenes pegadas (2026-10-18); antes siempre vacío.
    fd.append('texto', extra?.texto ?? '')
    if (padre) fd.append('padre_id', String(padre.id))
    if (extra?.duracion_ms) fd.append('duracion_ms', String(Math.round(extra.duracion_ms)))
    const texto = extra?.duracion_ms ? 'Enviando la nota de voz…' : archivos.length === 1 ? `Subiendo ${archivos[0].name}…` : `Subiendo ${archivos.length} archivos…`
    setSubida({ progreso: 0, texto })
    try {
      const m = await subirConProgreso<Mensaje>(`/api/chat/canales/${canal.id}/archivos`, fd, (p) => setSubida({ progreso: p, texto }))
      pegadoAbajo.current = true
      setMensajes((l) => fusionar(l ?? [], m))
      sonarEnvio()
    } finally {
      setSubida(null)
    }
  }

  const reaccionar = async (m: Mensaje, emoji: string) => {
    try {
      const r = await api<{ reacciones: Reaccion[] }>(`/api/chat/mensajes/${m.id}/reaccion`, { method: 'POST', body: JSON.stringify({ emoji }) })
      setMensajes((l) => l?.map((x) => (x.id === m.id ? { ...x, reacciones: r.reacciones } : x)) ?? l)
    } catch (e) {
      fallar(e instanceof Error ? e.message : 'No se pudo reaccionar.')
    }
  }

  const ponerEncuesta = (mid: number, e: Encuesta) => setMensajes((l) => l?.map((x) => (x.id === mid ? { ...x, encuesta: e } : x)) ?? l)
  const votar = async (m: Mensaje, opcion: number) => {
    if (!m.encuesta) return
    try {
      ponerEncuesta(m.id, await api<Encuesta>(`/api/chat/encuestas/${m.encuesta.id}/voto`, { method: 'POST', body: JSON.stringify({ opcion }) }))
    } catch (e) {
      fallar(e instanceof Error ? e.message : 'No se pudo votar.')
    }
  }
  const cerrarEncuesta = async (m: Mensaje) => {
    if (!m.encuesta) return
    try {
      ponerEncuesta(m.id, await api<Encuesta>(`/api/chat/encuestas/${m.encuesta.id}/cerrar`, { method: 'POST' }))
    } catch (e) {
      fallar(e instanceof Error ? e.message : 'No se pudo cerrar la encuesta.')
    }
  }

  const ejecutarAccion = async (a: Accion, clave: string) => {
    try {
      let r: { texto: string }
      if (a.accion === 'registrar' && a.mensaje_id) {
        r = await api<{ texto: string }>(`/api/chat/mensajes/${a.mensaje_id}/registrar`, { method: 'POST' })
      } else if (a.accion === 'pegar_tareas' && a.mensaje_id) {
        // El plan de tareas se revisa y registra en el mismo chat («Pegar tareas» con el texto del mensaje).
        const local = mensajes?.find((x) => x.id === a.mensaje_id)
        const texto = local?.texto || (await api<Mensaje>(`/api/chat/mensajes/${a.mensaje_id}`)).texto
        claveTareas.current = clave
        setPedido({ que: 'pegar_tareas', ancla: null, texto, mensajeId: a.mensaje_id })
        return
      } else if ((a.accion === 'archivo_a_recibidos' || a.accion === 'archivo_a_mediateca') && a.archivo_id) {
        r = await api<{ texto: string }>(`/api/chat/archivos/${a.archivo_id}/registrar`, { method: 'POST' })
      } else {
        return
      }
      setHechas((h) => new Set(h).add(clave))
      setAviso({ texto: r.texto, tipo: 'success' })
    } catch (e) {
      fallar(e instanceof Error ? e.message : 'No se pudo hacer.')
    }
  }

  const guardarEdicion = async () => {
    if (!editando) return
    const texto = editando.texto.trim()
    if (!texto) return
    try {
      const m = await api<Mensaje>(`/api/chat/mensajes/${editando.id}`, { method: 'PATCH', body: JSON.stringify({ texto }) })
      setMensajes((l) => l?.map((x) => (x.id === m.id ? { ...x, texto: m.texto, editado_en: m.editado_en, menciones: m.menciones } : x)) ?? l)
      setEditando(null)
    } catch (e) {
      fallar(e instanceof Error ? e.message : 'No se pudo editar.')
    }
  }

  const eliminar = async (m: Mensaje) => {
    if (!(await confirmar('¿Eliminar este mensaje? Los demás verán «Mensaje eliminado».', { aceptar: 'Eliminar', peligro: true }))) return
    try {
      await api(`/api/chat/mensajes/${m.id}`, { method: 'DELETE' })
      setMensajes((l) => l?.map((x) => (x.id === m.id ? { ...x, eliminado: true, texto: '' } : x)) ?? l)
    } catch (e) {
      fallar(e instanceof Error ? e.message : 'No se pudo eliminar.')
    }
  }

  const silenciar = async (horas: number | null) => {
    setAncla(null)
    try {
      const r = await api<{ silenciado_hasta: string | null }>(`/api/chat/canales/${canal.id}/silenciar`, { method: 'POST', body: JSON.stringify({ horas }) })
      setSilenciadoHasta(r.silenciado_hasta)
      setAviso({ texto: r.silenciado_hasta ? `Silenciado hasta el ${new Date(r.silenciado_hasta).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.` : 'Ya no está silenciado.', tipo: 'info' })
    } catch (e) {
      fallar(e instanceof Error ? e.message : 'No se pudo silenciar.')
    }
  }

  const renombrar = async () => {
    setAncla(null)
    const nombre = await pedirTexto('Nombre de la conversación', { inicial: canal.nombre, aceptar: 'Guardar' })
    if (!nombre?.trim() || nombre.trim() === canal.nombre) return
    try {
      await api(`/api/chat/canales/${canal.id}`, { method: 'PATCH', body: JSON.stringify({ nombre: nombre.trim() }) })
      alCambiar()
    } catch (e) {
      fallar(e instanceof Error ? e.message : 'No se pudo renombrar.')
    }
  }

  const cambiarSeccion = async () => {
    setAncla(null)
    const actual = categoriaDe(canal)
    const nueva = await pedirTexto(`Sección de la lista (${ORDEN_CATEGORIAS.join(', ')} u otra)`, { inicial: actual === OTROS_TEMAS ? '' : actual, aceptar: 'Guardar' })
    if (nueva === null || nueva === undefined || nueva.trim() === actual) return
    try {
      await api(`/api/chat/canales/${canal.id}`, { method: 'PATCH', body: JSON.stringify({ categoria: nueva.trim().slice(0, 30) }) })
      alCambiar()
    } catch (e) {
      fallar(e instanceof Error ? e.message : 'No se pudo cambiar la sección.')
    }
  }

  const archivar = async () => {
    setAncla(null)
    if (!(await confirmar(`¿Archivar «${canal.nombre}»? Deja de aparecer en la lista; sus mensajes se conservan.`, { aceptar: 'Archivar' }))) return
    try {
      await api(`/api/chat/canales/${canal.id}`, { method: 'PATCH', body: JSON.stringify({ archivado: true }) })
      alSalir?.()
    } catch (e) {
      fallar(e instanceof Error ? e.message : 'No se pudo archivar.')
    }
  }

  const salir = async () => {
    setAncla(null)
    if (!miId || !(await confirmar(`¿Salir de «${canal.nombre}»?`, { aceptar: 'Salir' }))) return
    try {
      await api(`/api/chat/canales/${canal.id}/miembros/${miId}`, { method: 'DELETE' })
      alSalir?.()
    } catch (e) {
      fallar(e instanceof Error ? e.message : 'No se pudo salir.')
    }
  }

  const anadirPersonas = async (ids: number[]) => {
    setAnadir(false)
    if (ids.length === 0) return
    try {
      const r = await api<{ miembros: Miembro[] }>(`/api/chat/canales/${canal.id}/miembros`, { method: 'POST', body: JSON.stringify({ usuarios: ids }) })
      setDetalle((d) => ({ miembros: r.miembros, papel: d?.papel ?? papel }))
      alCambiar()
    } catch (e) {
      fallar(e instanceof Error ? e.message : 'No se pudo añadir.')
    }
  }

  // --- cabecera ------------------------------------------------------------------------------
  const miembros = detalle?.miembros ?? []
  const subtitulo = padre
    ? canal.nombre
    : canal.descripcion || (canal.clase === 'directo' ? (equipo.find((p) => p.nombre === canal.nombre)?.cargo ?? '') : miembros.length ? plural(miembros.length, 'integrante', 'integrantes') : canal.clase === 'tema' ? 'Abierto a todo el equipo' : '')
  const rutaEntidad = canal.entidad ? rutaVinculo(canal.entidad) : null
  const puedeAnadir = canal.clase !== 'directo' && (canal.clase === 'tema' || administra)
  const silenciado = Boolean(silenciadoHasta && new Date(silenciadoHasta).getTime() > Date.now())

  const contacto = !padre && canal.clase === 'directo' ? otroDelDirecto(canal.clave, miId) : null
  const cabecera = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: { xs: 0.5, sm: 1.5 }, py: 0.6, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', minHeight: 54, flexShrink: 0, position: 'sticky', top: 0, zIndex: 2 }}>
      {alVolver && (
        <IconButton size="small" onClick={alVolver} aria-label={padre ? 'Cerrar el hilo' : 'Volver a la lista'}>{padre ? <CloseIcon /> : <ArrowBackIcon />}</IconButton>
      )}
      {/* En un directo, la foto y el nombre abren la tarjeta de contacto (2026-10-12). */}
      {!padre && <Box onClick={contacto ? () => abrirTarjeta(contacto) : undefined} sx={{ display: 'flex', cursor: contacto ? 'pointer' : undefined }}><AvatarCanal canal={canal} miId={miId} /></Box>}
      <Box onClick={contacto ? () => abrirTarjeta(contacto) : undefined} sx={{ minWidth: 0, flex: 1, cursor: contacto ? 'pointer' : undefined }}>
        <Typography component="h2" noWrap sx={{ fontSize: 15.5, fontWeight: 650, lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {padre ? 'Hilo' : canal.nombre}
          {silenciado && <VolumeOffOutlinedIcon sx={{ fontSize: 15, color: PALETA.textoTenue }} aria-label="Silenciado" />}
        </Typography>
        {subtitulo && <Typography variant="caption" color="text.secondary" noWrap component="div">{subtitulo}</Typography>}
      </Box>
      {!padre && canal.entidad && (
        <Chip size="small" variant="outlined" icon={<LinkIcon sx={{ fontSize: '15px !important' }} />} label={nombreEntidad(canal.entidad, canal.entidad_etiqueta)} onClick={rutaEntidad ? () => navegar(rutaEntidad) : undefined} sx={{ display: { xs: 'none', sm: 'inline-flex' }, maxWidth: 220 }} />
      )}
      {!padre && (
        <>
          <Tooltip title="Más">
            <IconButton size="small" aria-label="Más opciones" onClick={(e) => setAncla(e.currentTarget)}><MoreVertIcon /></IconButton>
          </Tooltip>
          <Menu anchorEl={ancla} open={Boolean(ancla)} onClose={() => setAncla(null)}>
            {canal.clase !== 'directo' && (
              <MenuItem onClick={() => { setAncla(null); setVerIntegrantes(true) }}>
                <ListItemIcon><GroupOutlinedIcon fontSize="small" /></ListItemIcon>Integrantes
              </MenuItem>
            )}
            {puedeAnadir && (
              <MenuItem onClick={() => { setAncla(null); setAnadir(true) }}>
                <ListItemIcon><PersonAddAltOutlinedIcon fontSize="small" /></ListItemIcon>Añadir personas
              </MenuItem>
            )}
            {canal.clase !== 'directo' && administra && (
              <MenuItem onClick={() => void renombrar()}>
                <ListItemIcon><DriveFileRenameOutlineOutlinedIcon fontSize="small" /></ListItemIcon>Cambiar el nombre
              </MenuItem>
            )}
            {canal.clase === 'tema' && administra && (
              <MenuItem onClick={() => void cambiarSeccion()}>
                <ListItemIcon><FolderOutlinedIcon fontSize="small" /></ListItemIcon>Cambiar la sección
              </MenuItem>
            )}
            {canal.clase !== 'directo' && administra && (
              <MenuItem onClick={() => void archivar()}>
                <ListItemIcon><ArchiveOutlinedIcon fontSize="small" /></ListItemIcon>Archivar
              </MenuItem>
            )}
            {canal.clase !== 'directo' && <Divider />}
            <ListSubheader sx={{ lineHeight: '28px', fontSize: 12 }}>Silenciar</ListSubheader>
            {SILENCIOS.map((s) => (
              <MenuItem key={s.horas} dense onClick={() => void silenciar(s.horas)}>
                <ListItemIcon><NotificationsOffOutlinedIcon fontSize="small" /></ListItemIcon>{s.texto}
              </MenuItem>
            ))}
            {silenciado && (
              <MenuItem dense onClick={() => void silenciar(null)}>
                <ListItemIcon><VolumeOffOutlinedIcon fontSize="small" /></ListItemIcon>Quitar el silencio
              </MenuItem>
            )}
            {canal.clase !== 'directo' && canal.miembro && [
              <Divider key="d" />,
              <MenuItem key="s" onClick={() => void salir()}>
                <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>Salir de la conversación
              </MenuItem>,
            ]}
          </Menu>
        </>
      )}
    </Box>
  )

  const bloques = mensajes ? agruparPorDia(mensajes) : []
  const listaVacia = mensajes !== null && mensajes.length === 0

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, bgcolor: PALETA.fondo }}>
      {cabecera}
      {padre && (
        <Box sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: padre.autor_id === null ? PALETA.textoTenue : colorDePersona(padre.autor_id) }}>{padre.autor}</Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{padre.eliminado ? 'Mensaje eliminado' : padre.texto || (padre.archivos[0]?.nombre ?? '')}</Typography>
        </Box>
      )}
      <Box ref={lista} onScroll={alDesplazar} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', py: 0.5, WebkitOverflowScrolling: 'touch' }}>
        {mensajes === null && !error && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={22} /></Box>}
        {error && <Typography variant="body2" color="error" sx={{ px: 2, py: 1 }}>{error}</Typography>}
        {hayMas && (
          <Box sx={{ textAlign: 'center', py: 0.5 }}>
            <Button size="small" disabled={cargandoMas} onClick={() => void cargarMas()} sx={{ textTransform: 'none', borderRadius: 999 }}>{cargandoMas ? 'Cargando…' : 'Cargar anteriores'}</Button>
          </Box>
        )}
        {listaVacia && (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', px: 3, py: 4 }}>
            {padre ? 'Todavía nadie respondió en este hilo.' : 'Todavía no hay mensajes. Escriba el primero.'}
          </Typography>
        )}
        {bloques.map((b) => {
          const marcas = marcarConsecutivos(b.mensajes)
          return (
            <Box key={b.dia}>
              {/* El día queda arriba mientras se recorren sus mensajes (2026-10-13), como en Telegram. */}
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 0.75, position: 'sticky', top: 0, zIndex: 1, pointerEvents: 'none' }}>
                <Typography variant="caption" sx={{ px: 1.25, py: 0.3, borderRadius: 999, bgcolor: PALETA.barra, backdropFilter: 'blur(4px)', color: PALETA.textoTenue, fontWeight: 600, fontSize: 11.5, boxShadow: '0 1px 2px rgba(36,31,28,.08)', textTransform: 'capitalize' }}>{b.etiqueta}</Typography>
              </Box>
              {b.mensajes.map((m, i) =>
                editando?.id === m.id ? (
                  <Box key={m.id} id={`mensaje-${m.id}`} sx={{ px: 2, py: 0.5, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.75 }}>
                    <TextField
                      multiline fullWidth maxRows={8} autoFocus value={editando.texto}
                      onChange={(e) => setEditando({ id: m.id, texto: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditando(null)
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void guardarEdicion() }
                      }}
                      sx={{ maxWidth: 640, bgcolor: 'background.paper', borderRadius: 2, '& textarea': { fontSize: { xs: 16, md: 14 } } }}
                    />
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button size="small" onClick={() => setEditando(null)}>Cancelar</Button>
                      <Button size="small" variant="contained" disableElevation disabled={!editando.texto.trim()} onClick={() => void guardarEdicion()}>Guardar</Button>
                    </Box>
                  </Box>
                ) : (
                  <Burbuja
                    key={m.id}
                    m={m}
                    propio={m.autor_id !== null && m.autor_id === miId}
                    puedeEliminar={(m.autor_id !== null && m.autor_id === miId) || esAdmin}
                    enHilo={Boolean(padre)}
                    resaltado={resaltado === m.id}
                    cuentas={cuentas}
                    inicio={marcas[i].inicio}
                    fin={marcas[i].fin}
                    citado={padre ?? (m.responde_a_id ? porId.get(m.responde_a_id) ?? { ...m, id: m.responde_a_id, autor: 'Mensaje anterior', texto: '…', archivos: [], eliminado: false } : null)}
                    hechas={hechas}
                    alResponder={citaEnLinea ? () => setRespondiendo(m) : alAbrirHilo ? () => alAbrirHilo(m) : undefined}
                    cita={citaEnLinea}
                    alEditar={m.encuesta ? undefined : () => setEditando({ id: m.id, texto: m.texto })}
                    alEliminar={() => void eliminar(m)}
                    alReaccionar={canal.archivado ? undefined : (emoji) => void reaccionar(m, emoji)}
                    alAccion={ejecutarAccion}
                    alFallar={fallar}
                    alVotar={canal.archivado ? undefined : (opcion) => votar(m, opcion)}
                    alCerrarEncuesta={() => cerrarEncuesta(m)}
                    puedeCerrarEncuesta={Boolean(m.encuesta && (m.encuesta.creado_por === miId || administra))}
                    entrega={m.autor_id !== null && m.autor_id === miId ? estadoEntrega(m.id, lecturas, miId) : undefined}
                    alInfo={() => setInfo(m)}
                    seguidaSistema={i > 0 && b.mensajes[i - 1].autor_id === null}
                  />
                ),
              )}
            </Box>
          )
        })}
      </Box>
      <EnEspera ruta={base} />
      {escriben.length > 0 && (
        <Typography variant="caption" sx={{ px: 2, py: 0.25, color: PALETA.textoTenue, fontStyle: 'italic', flexShrink: 0 }}>
          {escriben.length === 1 ? `${escriben[0]} está escribiendo…` : `${escriben.join(' y ')} están escribiendo…`}
        </Typography>
      )}
      {canal.archivado ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 }}>Esta conversación está archivada.</Typography>
      ) : (
        <>
        {respondiendo && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, borderTop: '1px solid', borderColor: 'divider', bgcolor: PALETA.velo }}>
            <Box sx={{ flex: 1, minWidth: 0, borderLeft: '3px solid', borderColor: 'primary.main', pl: 1 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'primary.main' }} noWrap>{respondiendo.autor_id === miId ? 'Tú' : respondiendo.autor}</Typography>
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }} noWrap>{respondiendo.texto || respondiendo.archivos[0]?.nombre || 'Mensaje'}</Typography>
            </Box>
            <IconButton size="small" onClick={() => setRespondiendo(null)} aria-label="Cancelar la respuesta"><CloseIcon fontSize="small" /></IconButton>
          </Box>
        )}
        <CajaMensaje
          equipo={equipo}
          alEnviar={enviar}
          alSubir={subir}
          alHerramienta={(que, ancla) => setPedido({ que, ancla })}
          subida={subida}
          alEscribir={() => enviarEscribiendo(canal.id)}
          alEnfocar={irAlFinal}
          placeholder={padre ? 'Responder en el hilo' : respondiendo ? 'Escriba la respuesta' : canal.clase === 'directo' ? `Mensaje para ${canal.nombre}` : `Mensaje en ${canal.nombre}`}
          autoFoco={Boolean(padre) || Boolean(respondiendo)}
        />
        </>
      )}

      {!canal.archivado && (
        <HerramientasChat
          canal={canal}
          padreId={padre?.id ?? null}
          pedido={pedido}
          alAtender={atenderPedido}
          alPublicado={(m) => { pegadoAbajo.current = true; setMensajes((l) => fusionar(l ?? [], m)) }}
          alAviso={(texto, tipo) => setAviso({ texto, tipo })}
          alTareasRegistradas={() => {
            const c = claveTareas.current
            if (c) setHechas((h) => new Set(h).add(c))
          }}
        />
      )}

      <Snackbar open={Boolean(aviso)} autoHideDuration={aviso?.tipo === 'error' ? 7000 : 4500} onClose={() => setAviso(null)} anchorOrigin={{ vertical: 'top', horizontal: 'center' }} sx={{ top: { xs: 64, sm: 72 } }}>
        <Alert severity={aviso?.tipo ?? 'info'} variant="filled" onClose={() => setAviso(null)} sx={{ fontSize: 13.5, alignItems: 'center' }}>{aviso?.texto}</Alert>
      </Snackbar>

      <Dialog open={verIntegrantes} onClose={() => setVerIntegrantes(false)} fullWidth maxWidth="xs">
        <DialogTitle>Integrantes</DialogTitle>
        <DialogContent>
          {miembros.length === 0 && <Typography variant="body2" color="text.secondary">{canal.clase === 'tema' ? 'Todo el equipo puede leer y escribir aquí.' : 'Sin integrantes registrados.'}</Typography>}
          {miembros.map((p) => (
            <Box key={p.usuario_id} role="button" tabIndex={0} onClick={() => abrirTarjeta(p.usuario_id)} onKeyDown={(e) => e.key === 'Enter' && abrirTarjeta(p.usuario_id)} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 0.6, mx: -1, px: 1, borderRadius: 1.5, cursor: 'pointer', '&:hover': { bgcolor: PALETA.superficieTenue } }}>
              <AvatarPersona id={p.usuario_id} nombre={p.nombre} tamano={32} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontSize: 14 }} noWrap>{p.nombre}{p.usuario_id === miId ? ' (usted)' : ''}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap component="div">@{p.cuenta}{p.papel === 'admin' ? ' · administra' : ''}</Typography>
              </Box>
            </Box>
          ))}
        </DialogContent>
        <DialogActions>
          {puedeAnadir && <Button onClick={() => { setVerIntegrantes(false); setAnadir(true) }}>Añadir personas</Button>}
          <Button onClick={() => setVerIntegrantes(false)}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      <DialogoLecturas m={info} lecturas={lecturas} miId={miId} equipo={equipo} alCerrar={() => setInfo(null)} />

      <DialogoAnadir abierto={anadir} equipo={equipo.filter((p) => !miembros.some((m) => m.usuario_id === p.id))} alCerrar={() => setAnadir(false)} alAnadir={(ids) => void anadirPersonas(ids)} />
    </Box>
  )
}

function DialogoAnadir({ abierto, equipo, alCerrar, alAnadir }: { abierto: boolean; equipo: PersonaEquipo[]; alCerrar: () => void; alAnadir: (ids: number[]) => void }) {
  const [elegidos, setElegidos] = useState<number[]>([])
  useEffect(() => {
    if (abierto) setElegidos([])
  }, [abierto])
  const alternar = (id: number) => setElegidos((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))
  return (
    <Dialog open={abierto} onClose={alCerrar} fullWidth maxWidth="xs">
      <DialogTitle>Añadir personas</DialogTitle>
      <DialogContent>
        {equipo.length === 0 && <Typography variant="body2" color="text.secondary">Todo el equipo ya está dentro.</Typography>}
        {equipo.map((p) => (
          <Box key={p.id} component="label" sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 0.6, cursor: 'pointer' }}>
            <input type="checkbox" checked={elegidos.includes(p.id)} onChange={() => alternar(p.id)} style={{ width: 18, height: 18, accentColor: PALETA.guinda }} />
            <AvatarPersona id={p.id} nombre={p.nombre} tamano={32} />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontSize: 14 }} noWrap>{p.nombre}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap component="div">@{p.cuenta}{p.cargo ? ` · ${p.cargo}` : ''}</Typography>
            </Box>
          </Box>
        ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={alCerrar}>Cancelar</Button>
        <Button variant="contained" disabled={elegidos.length === 0} onClick={() => alAnadir(elegidos)}>Añadir</Button>
      </DialogActions>
    </Dialog>
  )
}
