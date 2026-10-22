/**
 * CHAT — el módulo de conversación del equipo (fase 8.3, 2026-10-12; diseño en
 * docs/plataforma/propuesta-automatizacion.md §5.4).
 *
 *   ┌ lista de canales (320) │ conversación [| hilo (360)] │ ficha de la entidad (360, ≥ 1440) ┐
 *
 * Entre 900 y 1440 px, dos columnas (lista y conversación, el hilo al lado de esta); en el
 * celular, lista → conversación con «volver», y el hilo reemplaza a la conversación.
 * `?canal=N` abre un canal, `?directo=UID` el directo con esa persona (se crea si no existe),
 * `?mensaje=M` se desplaza hasta ese mensaje (el destino `chat:<canal>:<mensaje>` de la
 * campana) y `?nuevo=1` abre el diálogo de nueva conversación. Los componentes viven en
 * `componentes/chat/`; la lógica pura, en `componentes/chat/mensajes.ts`.
 *
 * En el celular, con el teclado abierto, la página se clava a la parte visible de la ventana
 * (`useVentanaVisible`: `window.visualViewport`), por encima de la barra superior: la cabecera
 * del canal queda arriba y la caja de escritura, justo sobre el teclado.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined'
import LinkIcon from '@mui/icons-material/Link'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { api, Marco, MapaLocal, PALETA } from '@qillqa/tiqsi'
import { rutaVinculo } from '../componentes/chat/apoyo'
import Conversacion from '../componentes/chat/Conversacion'
import DialogoNuevoCanal from '../componentes/chat/DialogoNuevoCanal'
import ListaCanales from '../componentes/chat/ListaCanales'
import { idDelToken, nombreEntidad, type Canal, type Mensaje, type PersonaEquipo } from '../componentes/chat/mensajes'
import { useSucesosChat } from '../componentes/chat/socket'
import { useVentanaVisible } from '../componentes/chat/teclado'

const REFRESCAN_LISTA = new Set(['mensaje', 'mensaje_eliminado', 'canal', 'leido', 'sondeo', 'conectado'])

function PanelEntidad({ entidad, etiqueta }: { entidad: string; etiqueta?: string }) {
  const navegar = useNavigate()
  const ruta = rutaVinculo(entidad)
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', overflow: 'auto', bgcolor: 'background.paper', p: 2, gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Chip size="small" variant="outlined" icon={<LinkIcon sx={{ fontSize: '15px !important' }} />} label={nombreEntidad(entidad, etiqueta)} sx={{ maxWidth: 220 }} />
        <Box sx={{ flex: 1 }} />
        {ruta && <Button size="small" variant="outlined" startIcon={<OpenInNewIcon />} onClick={() => navegar(ruta)}>Abrir</Button>}
      </Box>
      <Typography variant="caption" color="text.secondary">Lo que se conversa aquí es sobre esta entidad; sus relaciones, debajo.</Typography>
      <MapaLocal foco={entidad} alto={320} />
    </Box>
  )
}

// Un solo POST por persona aunque el efecto de `?directo=` corra dos veces (StrictMode en
// desarrollo) o el enlace se pulse de nuevo mientras va el primero: la promesa en curso se comparte.
// (El servidor además es idempotente: candado por clave e índice único, `servicios/chat.py::canal_directo`.)
const abriendoDirecto = new Map<number, Promise<Canal>>()
function abrirDirecto(uid: number): Promise<Canal> {
  let p = abriendoDirecto.get(uid)
  if (!p) {
    p = api<Canal>(`/api/chat/directo/${uid}`, { method: 'POST' }).finally(() => abriendoDirecto.delete(uid))
    abriendoDirecto.set(uid, p)
  }
  return p
}

export default function Chat() {
  const tema = useTheme()
  const ancha = useMediaQuery(tema.breakpoints.up('md'))
  const celular = useMediaQuery(tema.breakpoints.down('sm'))
  const muyAncha = useMediaQuery('(min-width:1440px)')
  const [consulta, setConsulta] = useSearchParams()
  const canalId = Number(consulta.get('canal') ?? '') || null
  const mensajeId = Number(consulta.get('mensaje') ?? '') || null
  const directoId = Number(consulta.get('directo') ?? '') || null
  const nuevo = consulta.get('nuevo') === '1'

  const [canales, setCanales] = useState<Canal[] | null>(null)
  const [canalSuelto, setCanalSuelto] = useState<Canal | null>(null)
  const [equipo, setEquipo] = useState<PersonaEquipo[]>([])
  const [hilo, setHilo] = useState<Mensaje | null>(null)
  const [dialogoNuevo, setDialogoNuevo] = useState(false)
  const [error, setError] = useState('')
  const temporizador = useRef<number | null>(null)
  const miId = useMemo(() => idDelToken(localStorage.getItem('qillqa_token')), [])
  const rol = localStorage.getItem('qillqa_rol') ?? ''
  const esAdmin = rol === 'administrador'

  // La página ocupa justo la ventana: su alto es la ventana menos lo que queda arriba (medido).
  const raiz = useRef<HTMLDivElement | null>(null)
  const [arriba, setArriba] = useState(48)
  const clavada = useRef(false)
  useLayoutEffect(() => {
    // Con la página clavada al teclado (position: fixed) la medida no vale: se conserva la última.
    const medir = () => raiz.current && !clavada.current && setArriba(Math.max(0, Math.round(raiz.current.getBoundingClientRect().top + window.scrollY)))
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [ancha, celular])

  // El teclado del celular: la página se clava a lo que se ve (ver `teclado.ts`).
  const visible = useVentanaVisible(celular)
  const conTeclado = Boolean(celular && visible?.teclado)
  clavada.current = conTeclado
  useEffect(() => {
    if (conTeclado) window.scrollTo(0, 0)
  }, [conTeclado])

  const poner = useCallback((cambios: Record<string, string>) => {
    const c = new URLSearchParams(consulta)
    for (const [k, v] of Object.entries(cambios)) {
      if (v) c.set(k, v)
      else c.delete(k)
    }
    setConsulta(c, { replace: true })
  }, [consulta, setConsulta])

  const cargarCanales = useCallback(() => {
    api<{ canales: Canal[] }>('/api/chat/canales')
      .then((r) => setCanales(r.canales))
      .catch((e) => {
        setCanales((l) => l ?? [])
        setError(e instanceof Error ? e.message : 'No se pudo cargar el chat.')
      })
  }, [])

  useEffect(() => {
    cargarCanales()
    api<{ equipo: PersonaEquipo[] }>('/api/chat/equipo').then((r) => setEquipo(r.equipo)).catch(() => {})
  }, [cargarCanales])

  const programarRecarga = useCallback(() => {
    if (temporizador.current !== null) window.clearTimeout(temporizador.current)
    temporizador.current = window.setTimeout(() => {
      temporizador.current = null
      cargarCanales()
      api<{ equipo: PersonaEquipo[] }>('/api/chat/equipo').then((r) => setEquipo(r.equipo)).catch(() => {})
    }, 300)
  }, [cargarCanales])
  useEffect(() => () => { if (temporizador.current !== null) window.clearTimeout(temporizador.current) }, [])

  useSucesosChat((s) => {
    if (REFRESCAN_LISTA.has(s.tipo)) programarRecarga()
  })

  // ?directo=UID → el canal directo con esa persona.
  useEffect(() => {
    if (!directoId) return
    let vivo = true
    abrirDirecto(directoId)
      .then((c) => {
        if (!vivo) return
        poner({ directo: '', canal: String(c.id) })
        cargarCanales()
      })
      .catch((e) => {
        if (!vivo) return
        setError(e instanceof Error ? e.message : 'No se pudo abrir el directo.')
        poner({ directo: '' })
      })
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directoId])

  useEffect(() => {
    if (nuevo) {
      setDialogoNuevo(true)
      poner({ nuevo: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nuevo])

  useEffect(() => setHilo(null), [canalId])

  const canal = canales?.find((c) => c.id === canalId) ?? null
  // Un canal que no está en la lista (recién creado, un subtema): se pide aparte.
  useEffect(() => {
    if (!canalId || !canales || canal) return
    if (canalSuelto?.id === canalId) return
    api<Canal>(`/api/chat/canales/${canalId}`)
      .then((c) => setCanalSuelto({ ...c, no_leidos: 0, ultimo: null }))
      .catch(() => {
        setError('Esa conversación no existe o no tiene acceso.')
        poner({ canal: '', mensaje: '' })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canalId, canales, canal])
  const actual = canal ?? (canalSuelto?.id === canalId ? canalSuelto : null)

  const abrirCanal = (id: number, mensaje?: number) => poner({ canal: String(id), mensaje: mensaje ? String(mensaje) : '' })
  const alCrear = (c: Canal) => {
    setDialogoNuevo(false)
    setCanalSuelto(c)
    abrirCanal(c.id)
    cargarCanales()
  }
  const alSalir = () => {
    poner({ canal: '', mensaje: '' })
    setCanalSuelto(null)
    cargarCanales()
  }

  const lista = <ListaCanales canales={canales} actual={canalId} equipo={equipo} miId={miId} alElegir={(id) => abrirCanal(id)} alNuevo={() => setDialogoNuevo(true)} alNotas={miId != null ? () => poner({ directo: String(miId) }) : undefined} alAbrirMensaje={abrirCanal} />
  const conversacion = actual ? (
    <Conversacion
      key={actual.id}
      canal={actual}
      equipo={equipo}
      miId={miId}
      esAdmin={esAdmin}
      destacado={mensajeId}
      alAbrirHilo={setHilo}
      alVolver={ancha ? undefined : () => poner({ canal: '', mensaje: '' })}
      alCambiar={cargarCanales}
      alSalir={alSalir}
    />
  ) : (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'text.secondary', p: 4, textAlign: 'center' }}>
      <ForumOutlinedIcon sx={{ fontSize: 48, color: PALETA.apagado, mb: 1 }} />
      <Typography variant="body2">Elija una conversación o pulse «Nuevo».</Typography>
    </Box>
  )
  const panelHilo = actual && hilo && (
    <Conversacion
      key={`hilo-${hilo.id}`}
      canal={actual}
      padre={hilo}
      equipo={equipo}
      miId={miId}
      esAdmin={esAdmin}
      alVolver={() => setHilo(null)}
      alCambiar={cargarCanales}
    />
  )
  const conEntidad = muyAncha && Boolean(actual?.entidad)
  const sinBarraInferior = celular && Boolean(canalId)
  // Alto de la página: la ventana menos lo que queda arriba y la barra inferior; en el celular
  // con la parte visible medida, esa medida manda; con el teclado abierto, se clava a ella.
  const altoNormal = celular && visible ? `${Math.max(0, visible.alto - arriba - (sinBarraInferior ? 0 : 64))}px` : `calc(100dvh - ${arriba}px - ${celular && !sinBarraInferior ? 64 : 0}px)`
  const marcoTeclado = conTeclado && visible ? { position: 'fixed' as const, top: visible.arriba, left: 0, right: 0, height: visible.alto, zIndex: (t: { zIndex: { appBar: number } }) => t.zIndex.appBar + 1, bgcolor: PALETA.fondo } : {}

  return (
    <Marco modulo="chat" titulo={!ancha && actual ? actual.nombre : undefined} opciones={[]} sinBarraInferior={sinBarraInferior} fondo={PALETA.fondo}>
      <Box ref={raiz} sx={{ height: altoNormal, flex: 'none', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0, ...marcoTeclado }}>
        {ancha ? (
          <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateRows: 'minmax(0, 1fr)', gridTemplateColumns: conEntidad ? '320px minmax(0, 1fr) 360px' : '320px minmax(0, 1fr)' }}>
            <Box sx={{ minHeight: 0, borderRight: '1px solid', borderColor: 'divider' }}>{lista}</Box>
            <Box sx={{ minHeight: 0, display: 'flex', minWidth: 0 }}>
              <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>{conversacion}</Box>
              {panelHilo && <Box sx={{ width: 360, flexShrink: 0, minHeight: 0, borderLeft: '1px solid', borderColor: 'divider' }}>{panelHilo}</Box>}
            </Box>
            {conEntidad && actual && (
              <Box sx={{ minHeight: 0, borderLeft: '1px solid', borderColor: 'divider' }}><PanelEntidad entidad={actual.entidad} etiqueta={actual.entidad_etiqueta} /></Box>
            )}
          </Box>
        ) : (
          <Box sx={{ flex: 1, minHeight: 0 }}>{!canalId ? lista : panelHilo || conversacion}</Box>
        )}
      </Box>

      <DialogoNuevoCanal abierto={dialogoNuevo} equipo={equipo} esAdmin={esAdmin} alCerrar={() => setDialogoNuevo(false)} alCrear={alCrear} />
      <Snackbar open={Boolean(error)} autoHideDuration={6000} onClose={() => setError('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
      </Snackbar>
    </Marco>
  )
}
