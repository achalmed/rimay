/**
 * TARJETA DE UN MENSAJE DEL SISTEMA (2026-10-13; Edison: «ese mensaje debe estar ordenado, fácil de
 * entender; cuando está todo junto es abrumador»). Lo que publica una regla (numerado, firmado,
 * llegó, agendado, la programación del día…) se lee de arriba abajo:
 *
 *   ┌▎[ícono] Numerado                 10:42 ┐   qué pasó, en una línea, con la hora discreta
 *   │▎Oficio N°0142-2026-2027-ABC-CD/CRP    │   el número o el nombre, en negrita (una sola vez)
 *   │▎Traslada y solicita información…       │   el asunto, dos líneas como máximo
 *   │▎ver más                                │
 *   │▎plazo mié 14/10 · por responder        │   los datos sueltos, tenues
 *   └▎                               Abrir   ┘   UNA acción
 *
 * Sin chip que repita el número. El color de la franja y del ícono dice la clase de hecho (los de
 * los estados del documento, paleta.ts; sin naranja). La tarjeta la arma el servidor
 * (`servicios/chat.py::tarjeta_de`).
 *
 * Desde el 2026-10-18 lo nuevo llega con `estilo: 'mensaje'` (escrito como en Telegram,
 * `servicios/redaccion_chat.py`) y lo pinta `Burbuja` como la de una persona, con `AvatarSistema`;
 * esta tarjeta queda para los mensajes anteriores y las reglas con plantilla propia.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import AlarmOutlinedIcon from '@mui/icons-material/AlarmOutlined'
import AssignmentTurnedInOutlinedIcon from '@mui/icons-material/AssignmentTurnedInOutlined'
import ConfirmationNumberOutlinedIcon from '@mui/icons-material/ConfirmationNumberOutlined'
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import GavelOutlinedIcon from '@mui/icons-material/GavelOutlined'
import HistoryEduOutlinedIcon from '@mui/icons-material/HistoryEduOutlined'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import MoveToInboxOutlinedIcon from '@mui/icons-material/MoveToInboxOutlined'
import NewspaperOutlinedIcon from '@mui/icons-material/NewspaperOutlined'
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined'
import RateReviewOutlinedIcon from '@mui/icons-material/RateReviewOutlined'
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined'
import SendOutlinedIcon from '@mui/icons-material/SendOutlined'
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined'
import TimelineOutlinedIcon from '@mui/icons-material/TimelineOutlined'
import ViewAgendaOutlinedIcon from '@mui/icons-material/ViewAgendaOutlined'
import { PALETA } from '@qillqa/tiqsi'
import { rutaVinculo } from './apoyo'
import { horaDe, type Accion, type Mensaje, type Tarjeta } from './mensajes'

const ICONOS: Record<string, [typeof InfoOutlinedIcon, string]> = {
  numerado: [ConfirmationNumberOutlinedIcon, PALETA.guinda],
  firmado: [HistoryEduOutlinedIcon, PALETA.firmado],
  enviado: [SendOutlinedIcon, PALETA.enviado],
  revision: [RateReviewOutlinedIcon, PALETA.enRevision],
  observado: [ReportProblemOutlinedIcon, PALETA.observado],
  aprobado: [TaskAltOutlinedIcon, PALETA.aprobado],
  estado: [InfoOutlinedIcon, PALETA.textoSecundario],
  seguimiento: [TimelineOutlinedIcon, PALETA.aprobado],
  recibido: [MoveToInboxOutlinedIcon, PALETA.info],
  vencido: [AlarmOutlinedIcon, PALETA.error],
  agenda: [EventOutlinedIcon, PALETA.dorado],
  recordatorio: [NotificationsActiveOutlinedIcon, PALETA.dorado],
  programacion: [ViewAgendaOutlinedIcon, PALETA.dorado],
  prensa: [NewspaperOutlinedIcon, PALETA.firmado],
  proyecto: [GavelOutlinedIcon, PALETA.guinda],
  tarea: [AssignmentTurnedInOutlinedIcon, PALETA.textoSecundario],
}

export const tieneTarjeta = (m: Mensaje): boolean => Boolean(m.tarjeta && 'que' in m.tarjeta && m.tarjeta.que)

/** El color de la clase de hecho (franja de la tarjeta, nombre y avatar del mensaje «humano»). */
export const colorDeIcono = (icono: string | undefined): string => (ICONOS[icono ?? ''] ?? [InfoOutlinedIcon, PALETA.textoSecundario])[1]

/** El avatar de quien «firma» un mensaje del sistema (Mesa de Partes, Agenda…): el ícono del hecho en
 *  un círculo de su color, del tamaño del de una persona. */
export function AvatarSistema({ icono, tamano = 30 }: { icono?: string; tamano?: number }) {
  const [Icono, color] = ICONOS[icono ?? ''] ?? [InfoOutlinedIcon, PALETA.textoSecundario]
  return (
    <Box aria-hidden sx={{ width: tamano, height: tamano, borderRadius: '50%', bgcolor: `${color}26`, color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icono sx={{ fontSize: Math.round(tamano * 0.56) }} />
    </Box>
  )
}

interface Props {
  m: Mensaje
  resaltado: boolean
  /** Claves `${mensaje}:${índice}` de las acciones ya ejecutadas. */
  hechas?: ReadonlySet<string>
  alAccion?: (a: Accion, clave: string) => Promise<void>
  /** Seguido de otra tarjeta del sistema: menos aire arriba. */
  seguida?: boolean
}

export default function TarjetaSistema({ m, resaltado, hechas, alAccion, seguida }: Props) {
  const navegar = useNavigate()
  const t = m.tarjeta as Tarjeta
  const [Icono, color] = ICONOS[t.icono] ?? [InfoOutlinedIcon, PALETA.textoSecundario]
  const [abierto, setAbierto] = useState(false)
  const [desborda, setDesborda] = useState(false)
  const [ocupada, setOcupada] = useState(false)
  const detalle = useRef<HTMLDivElement | null>(null)
  const lineas = t.icono === 'programacion' ? 6 : 2

  useLayoutEffect(() => {
    const el = detalle.current
    if (el && !abierto) setDesborda(el.scrollHeight > el.clientHeight + 2)
  }, [t.detalle, abierto])

  // UNA acción: la primera que el mensaje ofrece y sigue pendiente, o abrir lo vinculado.
  const pendiente = m.acciones.map((a, i) => ({ a, clave: `${m.id}:${i}` })).find((x) => !hechas?.has(x.clave))
  const rutaEntidad = m.entidad ? rutaVinculo(m.entidad) : null
  const accion: { texto: string; ir: () => void | Promise<void> } | null = pendiente
    ? {
        texto: pendiente.a.texto,
        ir: async () => {
          const a = pendiente.a
          if (a.ruta) return navegar(a.ruta)
          if (a.accion && alAccion) {
            setOcupada(true)
            try {
              await alAccion(a, pendiente.clave)
            } finally {
              setOcupada(false)
            }
            return
          }
          const r = a.entidad ? rutaVinculo(a.entidad) : rutaEntidad
          if (r) navegar(r)
        },
      }
    : rutaEntidad
      ? { texto: 'Abrir', ir: () => navegar(rutaEntidad) }
      : null
  const sinDestino = Boolean(pendiente && !pendiente.a.ruta && !pendiente.a.accion && !(pendiente.a.entidad && rutaVinculo(pendiente.a.entidad)) && !rutaEntidad)

  return (
    <Box id={`mensaje-${m.id}`} sx={{ display: 'flex', px: { xs: 1.25, sm: 2 }, pt: seguida ? 0.4 : 0.9, pb: 0.4 }}>
      <Box
        component="article"
        aria-label={`${t.que}: ${t.titulo}`}
        sx={{
          width: '100%', maxWidth: 520, bgcolor: 'background.paper', borderRadius: 2.5, overflow: 'hidden', position: 'relative',
          boxShadow: PALETA.sombra, outline: resaltado ? `2px solid ${PALETA.dorado}` : undefined,
          // Sin franja lateral (2026-10-19, rediseño macOS): el color va en el icono y el nombre del hecho.
          pl: 1.25, pr: 1.25, pt: 0.75, pb: accion ? 0.25 : 0.75,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
          <Icono sx={{ fontSize: 16, color }} />
          <Typography component="span" sx={{ fontSize: 12.5, fontWeight: 650, color, letterSpacing: 0.1, flex: 1, minWidth: 0 }} noWrap>{t.que}</Typography>
          <Typography component="span" sx={{ fontSize: 11, color: PALETA.textoTenue, flexShrink: 0 }}>{horaDe(m.creado_en)}</Typography>
        </Box>
        {t.titulo && (
          <Typography sx={{ fontSize: { xs: 15, md: 14.5 }, fontWeight: 700, lineHeight: 1.3, mt: 0.3, color: 'text.primary', overflowWrap: 'anywhere' }}>{t.titulo}</Typography>
        )}
        {t.detalle && (
          <>
            <Typography
              ref={detalle}
              component="div"
              sx={{
                fontSize: { xs: 14, md: 13.5 }, lineHeight: 1.4, mt: 0.2, color: PALETA.textoSecundario, overflowWrap: 'anywhere',
                whiteSpace: t.icono === 'programacion' ? 'pre-line' : 'normal',
                ...(abierto ? {} : { display: '-webkit-box', WebkitLineClamp: lineas, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
              }}
            >
              {t.detalle}
            </Typography>
            {(desborda || abierto) && (
              <ButtonBase onClick={() => setAbierto((v) => !v)} sx={{ fontSize: 12.5, fontWeight: 600, color: 'primary.main', mt: 0.2, borderRadius: 1 }}>
                {abierto ? 'ver menos' : 'ver más'}
              </ButtonBase>
            )}
          </>
        )}
        {/* Los datos sueltos y la acción comparten la última línea: la tarjeta no crece por el botón. */}
        {(t.meta.length > 0 || accion) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.2, mr: -0.75 }}>
            <Typography sx={{ flex: 1, minWidth: 0, fontSize: 12, color: PALETA.textoTenue, lineHeight: 1.35 }}>{t.meta.join(' · ')}</Typography>
            {accion && (
              <Button size="small" disabled={ocupada || sinDestino} onClick={() => void accion.ir()} startIcon={ocupada ? <CircularProgress size={12} color="inherit" /> : undefined}
                sx={{ textTransform: 'none', fontWeight: 650, fontSize: 13, minHeight: 32, px: 1.25, borderRadius: 999, flexShrink: 0 }}>
                {accion.texto}
              </Button>
            )}
          </Box>
        )}
      </Box>
    </Box>
  )
}
