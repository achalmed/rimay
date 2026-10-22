/**
 * UN MENSAJE (fase 8.3; aspecto WhatsApp/Telegram desde 2026-10-12, fase 9.4): burbuja de radio
 * grande con cola sutil, las propias a la derecha en vino suave y las ajenas en blanco con el
 * nombre en el color de la persona (`colorDePersona`), la hora pequeña dentro, abajo a la
 * derecha. Los seguidos del mismo autor se agrupan (`inicio`/`fin`: el nombre va en el
 * primero; el avatar y la cola, en el último). Los del sistema (`autor_id` nulo) van en una
 * píldora centrada con sus botones pequeños («Registrar en Agenda», «Abrir y revisar»…).
 *
 * Gestos: pulsación larga (táctil) o el botón al pasar el ratón abren la barra de reacciones
 * (`EMOJIS`) con responder, copiar, editar y eliminar; deslizar a la derecha responde en hilo.
 * Un bloque `tipo: …` largo se muestra plegado («Ver el bloque»). Las acciones del mensaje
 * (registrar el bloque, mandar el archivo a Recibidos o a la Mediateca, abrir una ruta) las
 * ejecuta quien lo pinta (`alAccion`); las ya hechas (`hechas`) desaparecen.
 *
 * 2026-10-13: lo que publica el sistema con su tarjeta (numerado, llegó, agendado…) se pinta con
 * `TarjetaSistema` (ordenado, una sola acción, sin repetir el número); lo propio lleva junto a la
 * hora las marcas ✓ enviado · ✓✓ recibido · ✓✓ en color leído (`entrega.ts`), y la barra de la
 * pulsación larga ofrece «Info» («Leído por…»).
 *
 * 2026-10-18: el texto lleva el formato de WhatsApp y Telegram (`*negrita*`), y lo que el sistema
 * escribe como una persona (`tarjeta.estilo === 'mensaje'`: el recibido, la agenda, el estado del
 * expediente…) va en una burbuja ajena firmada por «Mesa de Partes», «Agenda»…, con «Abrir» y «Copiar».
 */
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Popover from '@mui/material/Popover'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddReactionOutlinedIcon from '@mui/icons-material/AddReactionOutlined'
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined'
import DoneAllIcon from '@mui/icons-material/DoneAll'
import DoneIcon from '@mui/icons-material/Done'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import ScheduleIcon from '@mui/icons-material/Schedule'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined'
import LinkIcon from '@mui/icons-material/Link'
import ReplyOutlinedIcon from '@mui/icons-material/ReplyOutlined'
import { copiarTexto, rutaVinculo, abrirTarjeta } from './apoyo'
import { PALETA } from '@qillqa/tiqsi'
import Adjunto from './Adjunto'
import VistaEncuesta from './Encuesta'
import TarjetaSistema, { AvatarSistema, colorDeIcono, tieneTarjeta } from './TarjetaSistema'
import type { EstadoEntrega } from './entrega'
import AvatarPersona from './Avatar'
import {
  bloqueLargo, colorDePersona, EMOJIS, esMensajeHumano, fragmento, horaDe, lineasOrdenadas, nombreEntidad, partirBloque, plural, tituloBloque, trozosConFormato,
  type Accion, type Mensaje,
} from './mensajes'

interface Props {
  m: Mensaje
  propio: boolean
  puedeEliminar: boolean
  /** Dentro de un hilo no se vuelve a abrir otro hilo. */
  enHilo: boolean
  resaltado: boolean
  cuentas: string[]
  /** Primero y último de un grupo de seguidos del mismo autor (`marcarConsecutivos`). */
  inicio: boolean
  fin: boolean
  /** En un hilo: el mensaje al que se responde, citado en la burbuja. */
  citado?: Mensaje | null
  /** Claves `${mensaje}:${índice}` de las acciones ya ejecutadas. */
  hechas?: ReadonlySet<string>
  alResponder?: () => void
  /** «Responder» cita en la misma conversación (directos) en vez de abrir un hilo. */
  cita?: boolean
  alEditar?: () => void
  alEliminar?: () => void
  alReaccionar?: (emoji: string) => void
  alAccion?: (a: Accion, clave: string) => Promise<void>
  alFallar: (texto: string) => void
  /** Encuesta (fase 9.6): votar una opción y cerrarla (autor o quien administra). */
  alVotar?: (opcion: number) => Promise<void>
  alCerrarEncuesta?: () => Promise<void>
  puedeCerrarEncuesta?: boolean
  /** Marca de entrega de un mensaje propio (2026-10-13). */
  entrega?: EstadoEntrega
  /** «Info» del mensaje propio: quién lo recibió y quién lo leyó. */
  alInfo?: () => void
  /** El anterior también es del sistema (las tarjetas seguidas van más juntas). */
  seguidaSistema?: boolean
}

const PULSACION_MS = 450
const DESLIZ_PX = 56

const ROTULO_ENTREGA: Record<EstadoEntrega, string> = { pendiente: 'Pendiente de envío', enviado: 'Enviado', recibido: 'Recibido', leido: 'Leído' }

/** ✓ enviado · ✓✓ recibido · ✓✓ en color leído · reloj pendiente (como en WhatsApp, con la paleta de Qillqa). */
export function MarcaEntrega({ estado }: { estado: EstadoEntrega }) {
  const sx = { fontSize: 15, verticalAlign: '-3px', ml: 0.4, color: estado === 'leido' ? PALETA.info : PALETA.textoTenue }
  const Icono = estado === 'pendiente' ? ScheduleIcon : estado === 'enviado' ? DoneIcon : DoneAllIcon
  return <Icono sx={estado === 'pendiente' ? { ...sx, fontSize: 13, verticalAlign: '-2px' } : sx} aria-label={ROTULO_ENTREGA[estado]} titleAccess={ROTULO_ENTREGA[estado]} />
}

/** La hora (y «editado») que va dentro de la burbuja, abajo a la derecha: flota al final de la última línea del texto. */
function Pie({ texto, estado }: { texto: string; estado?: EstadoEntrega }) {
  return (
    <Box component="span" sx={{ float: 'right', ml: 1, mt: '6px', position: 'relative', top: 1, fontSize: 11, lineHeight: 1.2, color: PALETA.textoTenue, whiteSpace: 'nowrap', userSelect: 'none' }}>
      {texto}
      {estado && <MarcaEntrega estado={estado} />}
    </Box>
  )
}

/** ¿El último trozo del texto es el botón «Ver el bloque»? Entonces la hora no cabe dentro y va debajo. */
function ultimoEsBoton(texto: string, abierto: boolean): boolean {
  const { bloque, despues } = partirBloque(texto)
  return bloque !== null && bloqueLargo(bloque) && !abierto && !despues
}

const PARRAFO = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.4, '&::after': { content: '""', display: 'block', clear: 'both' } } as const

/**
 * Los trozos de un texto ya formateado (`trozosConFormato`): mención, negrita y, desde 2026-10-18, los
 * enlaces, que se abren en otra pestaña. El enlace detiene el gesto de la burbuja (pulsación larga,
 * deslizar para responder) para que tocarlo no abra la barra ni responda.
 */
function Trozos({ texto, cuentas }: { texto: string; cuentas: string[] }) {
  return (
    <>
      {trozosConFormato(texto, cuentas).map((x, i) =>
        x.enlace ? (
          <Box key={i} component="a" href={x.enlace} target="_blank" rel="noopener noreferrer"
            onPointerDown={(e: React.PointerEvent) => e.stopPropagation()} onClick={(e: React.MouseEvent) => e.stopPropagation()}
            sx={{ color: 'primary.main', textDecoration: 'underline', textUnderlineOffset: 2, fontWeight: x.negrita ? 700 : undefined, wordBreak: 'break-all' }}>
            {x.texto}
          </Box>
        ) : x.mencion ? <Box key={i} component="span" sx={{ fontWeight: x.negrita ? 700 : 600, color: 'primary.main' }}>{x.texto}</Box>
          : x.negrita ? <Box key={i} component="strong" sx={{ fontWeight: 700 }}>{x.texto}</Box> : <span key={i}>{x.texto}</span>,
      )}
    </>
  )
}

/**
 * El texto con menciones y, si trae un bloque `tipo: …`, el bloque en monoespaciada (plegado si
 * es largo). `pie` (la hora) se cuelga al final del último trozo.
 */
function Texto({ texto, cuentas, tenue, pie, abierto, alAlternar }: { texto: string; cuentas: string[]; tenue?: boolean; pie?: React.ReactNode; abierto: boolean; alAlternar: (v: boolean) => void }) {
  const { antes, bloque, despues } = partirBloque(texto)
  const largo = bloqueLargo(bloque)
  const parrafo = (t: string, conPie: boolean) =>
    t || conPie ? (
      <Typography variant="body2" component="div" sx={{ ...PARRAFO, fontSize: { xs: 15, md: 14 }, color: tenue ? 'text.secondary' : 'text.primary' }}>
        <Trozos texto={t} cuentas={cuentas} />
        {conPie && pie}
      </Typography>
    ) : null
  if (bloque === null) return parrafo(texto, true)
  const pieEnPre = !despues && !(largo && !abierto)
  return (
    <>
      {parrafo(antes, false)}
      {largo && !abierto ? (
        <ButtonBase onClick={() => alAlternar(true)} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, width: '100%', textAlign: 'left', mt: antes ? 0.5 : 0, px: 1, py: 0.6, borderRadius: 1.5, bgcolor: PALETA.velo, fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>
          <Typography component="span" noWrap sx={{ flex: 1, minWidth: 0, fontFamily: 'inherit', fontSize: 'inherit', color: 'text.secondary' }}>{tituloBloque(bloque)}</Typography>
          <Typography component="span" sx={{ fontSize: 12.5, fontWeight: 600, color: 'primary.main', flexShrink: 0 }}>Ver el bloque</Typography>
        </ButtonBase>
      ) : (
        <Box component="pre" sx={{ ...PARRAFO, m: 0, mt: antes ? 0.5 : 0, px: 1, py: 0.6, borderRadius: 1.5, bgcolor: PALETA.velo, fontFamily: 'ui-monospace, monospace', fontSize: 12.5, maxHeight: 420, overflow: 'auto' }}>
          {bloque}
          {largo && <Box component="span" onClick={() => alAlternar(false)} sx={{ display: 'block', mt: 0.5, fontFamily: 'inherit', fontWeight: 600, color: 'primary.main', cursor: 'pointer' }}>Ocultar el bloque</Box>}
          {pieEnPre && pie}
        </Box>
      )}
      {parrafo(despues, Boolean(despues))}
    </>
  )
}

/** Ancho de la columna de la marca (el emoji o la viñeta) en un mensaje ordenado. */
const COLUMNA = '1.7em'

/**
 * Un mensaje escrito como en Telegram (2026-10-18): una fila por línea con la marca en su columna y
 * el texto al lado, con sangría colgante (lo que salta de línea queda bajo el texto, no bajo el
 * emoji); la línea sin marca va en la columna del texto y la viñeta, un nivel adentro. La hora se
 * cuelga al final de la última línea.
 */
function TextoOrdenado({ texto, cuentas, pie }: { texto: string; cuentas: string[]; pie: React.ReactNode }) {
  const lineas = lineasOrdenadas(texto)
  const ultima = lineas.map((l) => !l.vacia).lastIndexOf(true)
  return (
    <Typography variant="body2" component="div" sx={{ fontSize: { xs: 15, md: 14 }, lineHeight: 1.4, color: 'text.primary', overflowWrap: 'anywhere', '&::after': { content: '""', display: 'block', clear: 'both' } }}>
      {lineas.slice(0, ultima + 1).map((l, i) =>
        l.vacia ? <Box key={i} sx={{ height: '0.55em' }} /> : (
          <Box key={i} sx={{ display: 'flex', alignItems: 'baseline', pl: l.nivel ? COLUMNA : 0 }}>
            <Box component="span" aria-hidden={!l.marca} sx={{ flex: `0 0 ${COLUMNA}`, textAlign: l.marca === '•' ? 'center' : 'left', color: l.marca === '•' ? 'text.secondary' : undefined }}>{l.marca}</Box>
            <Box component="span" sx={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap' }}>
              <Trozos texto={l.texto} cuentas={cuentas} />
              {i === ultima && pie}
            </Box>
          </Box>
        ),
      )}
    </Typography>
  )
}

/** Los botones de un mensaje: abrir una entidad o una ruta, registrar el bloque, mandar el archivo a su módulo.
 *  En el mensaje «humano» del sistema (`humano`), sin el chip de la entidad (ya lo abre «Abrir») y con
 *  «Copiar»: el texto tal cual, para pegarlo en el grupo de Telegram o WhatsApp. */
function Acciones({ m, hechas, alAccion, centrado, humano, alFallar }: {
  m: Mensaje; hechas?: ReadonlySet<string>; alAccion?: (a: Accion, clave: string) => Promise<void>; centrado?: boolean; humano?: boolean; alFallar?: (t: string) => void
}) {
  const navegar = useNavigate()
  const [ocupada, setOcupada] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const entidad = m.entidad ? rutaVinculo(m.entidad) : null
  const pendientes = m.acciones.map((a, i) => ({ a, clave: `${m.id}:${i}` })).filter((x) => !hechas?.has(x.clave))
  if (m.eliminado || (!humano && pendientes.length === 0 && !m.entidad)) return null
  const copiar = async () => {
    try {
      await copiarTexto(m.texto)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 1600)
    } catch (e) {
      alFallar?.(e instanceof Error ? e.message : 'No se pudo copiar.')
    }
  }
  const pulsar = async (a: Accion, clave: string) => {
    if (a.ruta) return navegar(a.ruta)
    if (a.accion && alAccion) {
      setOcupada(clave)
      try {
        await alAccion(a, clave)
      } finally {
        setOcupada(null)
      }
      return
    }
    const ruta = a.entidad ? rutaVinculo(a.entidad) : null
    if (ruta) navegar(ruta)
  }
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, justifyContent: centrado ? 'center' : 'flex-start', mt: 0.75 }}>
      {m.entidad && !humano && <Chip size="small" variant="outlined" icon={<LinkIcon sx={{ fontSize: '15px !important' }} />} label={nombreEntidad(m.entidad, m.entidad_etiqueta)} onClick={entidad ? () => navegar(entidad) : undefined} sx={{ bgcolor: 'background.paper' }} />}
      {pendientes.map(({ a, clave }) => {
        const sinDestino = !a.ruta && !a.accion && !(a.entidad && rutaVinculo(a.entidad))
        return (
          <Button key={clave} size="small" variant={a.accion ? 'contained' : 'outlined'} disableElevation disabled={sinDestino || ocupada !== null} onClick={() => void pulsar(a, clave)}
            startIcon={ocupada === clave ? <CircularProgress size={12} color="inherit" /> : undefined}
            sx={{ py: 0.25, px: 1.25, minHeight: 28, fontSize: 12.5, lineHeight: 1.2, borderRadius: 999, textTransform: 'none' }}>
            {a.texto}
          </Button>
        )
      })}
      {humano && m.texto && (
        <Button size="small" variant="text" onClick={() => void copiar()} startIcon={<ContentCopyOutlinedIcon sx={{ fontSize: '15px !important' }} />}
          sx={{ py: 0.25, px: 1, minHeight: 28, fontSize: 12.5, lineHeight: 1.2, borderRadius: 999, textTransform: 'none', color: 'text.secondary' }}>
          {copiado ? 'Copiado' : 'Copiar'}
        </Button>
      )}
    </Box>
  )
}

function Reacciones({ m, propio, alReaccionar }: { m: Mensaje; propio: boolean; alReaccionar?: (emoji: string) => void }) {
  const lista = m.reacciones ?? []
  if (lista.length === 0 || m.eliminado) return null
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: -0.75, mb: 0.25, px: 0.75, justifyContent: propio ? 'flex-end' : 'flex-start', position: 'relative', zIndex: 1 }}>
      {lista.map((r) => (
        <ButtonBase key={r.emoji} onClick={alReaccionar ? () => alReaccionar(r.emoji) : undefined} aria-label={`${r.emoji} ${r.n}${r.mia ? ', suya' : ''}`}
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, px: 0.75, py: 0.15, borderRadius: 999, fontSize: 13, bgcolor: 'background.paper', border: '1px solid', borderColor: r.mia ? 'primary.main' : 'divider', boxShadow: '0 1px 2px rgba(36,31,28,.10)', color: r.mia ? 'primary.main' : 'text.secondary', fontWeight: r.mia ? 700 : 500 }}>
          <span>{r.emoji}</span>
          {r.n > 1 && <span>{r.n}</span>}
        </ButtonBase>
      ))}
    </Box>
  )
}

/** La barra que abre la pulsación larga (o el botón al pasar el ratón): emojis y lo que se puede hacer con el mensaje. */
function BarraMensaje({ ancla, m, propio, puedeEliminar, enHilo, alCerrar, alResponder, alEditar, alEliminar, alReaccionar, alFallar, alInfo }: {
  ancla: HTMLElement | null; m: Mensaje; propio: boolean; puedeEliminar: boolean; enHilo: boolean; alCerrar: () => void
  alResponder?: () => void; alEditar?: () => void; alEliminar?: () => void; alReaccionar?: (emoji: string) => void; alFallar: (t: string) => void
  alInfo?: () => void
}) {
  const mia = new Set((m.reacciones ?? []).filter((r) => r.mia).map((r) => r.emoji))
  const con = (f?: () => void) => () => {
    alCerrar()
    f?.()
  }
  const copiar = async () => {
    alCerrar()
    try {
      await copiarTexto(m.texto)
    } catch (e) {
      alFallar(e instanceof Error ? e.message : 'No se pudo copiar.')
    }
  }
  const acciones = [
    alResponder && !enHilo ? { icono: <ReplyOutlinedIcon />, texto: 'Responder', f: con(alResponder) } : null,
    m.texto ? { icono: <ContentCopyOutlinedIcon />, texto: 'Copiar', f: () => void copiar() } : null,
    propio && alInfo ? { icono: <InfoOutlinedIcon />, texto: 'Info', f: con(alInfo) } : null,
    propio && alEditar ? { icono: <EditOutlinedIcon />, texto: 'Editar', f: con(alEditar) } : null,
    puedeEliminar && alEliminar ? { icono: <DeleteOutlineIcon />, texto: 'Eliminar', f: con(alEliminar) } : null,
  ].filter((x): x is { icono: JSX.Element; texto: string; f: () => void } => x !== null)
  return (
    <Popover open={Boolean(ancla)} anchorEl={ancla} onClose={alCerrar} anchorOrigin={{ vertical: 'top', horizontal: propio ? 'right' : 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: propio ? 'right' : 'left' }}
      slotProps={{ paper: { sx: { borderRadius: 3, boxShadow: PALETA.sombraFlotante, mt: -0.5, overflow: 'hidden' } } }}>
      {alReaccionar && (
        <Box sx={{ display: 'flex', px: 0.5, py: 0.25 }}>
          {EMOJIS.map((e) => (
            <ButtonBase key={e} onClick={con(() => alReaccionar(e))} aria-label={`Reaccionar ${e}`} sx={{ width: 40, height: 40, borderRadius: '50%', fontSize: 22, bgcolor: mia.has(e) ? PALETA.guindaSuave : 'transparent', '&:hover': { bgcolor: PALETA.superficieMedia } }}>{e}</ButtonBase>
          ))}
        </Box>
      )}
      {alReaccionar && acciones.length > 0 && <Divider />}
      {acciones.length > 0 && (
        <Box sx={{ display: 'flex', py: 0.25 }}>
          {acciones.map((a) => (
            <ButtonBase key={a.texto} onClick={a.f} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25, px: 1.25, py: 0.75, minWidth: 68, fontSize: 11.5, color: 'text.secondary', '& svg': { fontSize: 20 }, borderRadius: 2 }}>
              {a.icono}
              {a.texto}
            </ButtonBase>
          ))}
        </Box>
      )}
    </Popover>
  )
}

/** Fragmento del mensaje al que se responde, como en WhatsApp: barra de color y una línea. */
function Cita({ m }: { m: Mensaje }) {
  const color = m.autor_id === null ? PALETA.textoTenue : colorDePersona(m.autor_id)
  return (
    <Box sx={{ bgcolor: PALETA.velo, borderRadius: 1.5, px: 1, py: 0.5, mb: 0.5 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 700, color, lineHeight: 1.3 }} noWrap>{m.autor}</Typography>
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.3 }} noWrap>{m.eliminado ? 'Mensaje eliminado' : fragmento(m.texto || (m.archivos.length ? m.archivos[0].nombre : ''))}</Typography>
    </Box>
  )
}

export default function Burbuja({ m, propio, puedeEliminar, enHilo, resaltado, cuentas, inicio, fin, citado, hechas, alResponder, alEditar, alEliminar, alReaccionar, alAccion, alFallar, alVotar, alCerrarEncuesta, puedeCerrarEncuesta = false, entrega, alInfo, seguidaSistema, cita = false }: Props) {
  const [ancla, setAncla] = useState<HTMLElement | null>(null)
  const [desliz, setDesliz] = useState(0)
  const [bloqueAbierto, setBloqueAbierto] = useState(false)
  const burbuja = useRef<HTMLDivElement | null>(null)
  const gesto = useRef<{ x: number; y: number; temporizador: number | null; tactil: boolean; largo: boolean } | null>(null)
  const hora = horaDe(m.creado_en)
  const rotuloHora = `${hora}${m.editado_en && !m.eliminado ? ' · editado' : (m.tarjeta as { actualizado_en?: string } | undefined)?.actualizado_en && !m.eliminado ? ' · actualizado' : ''}`
  const borde = resaltado ? `2px solid ${PALETA.dorado}` : undefined

  // --- gestos: pulsación larga abre la barra; deslizar a la derecha responde -------------------
  const cancelarPulsacion = () => {
    const g = gesto.current
    if (g?.temporizador !== null && g?.temporizador !== undefined) window.clearTimeout(g.temporizador)
    if (g) g.temporizador = null
  }
  const alPulsar = (e: React.PointerEvent<HTMLDivElement>) => {
    if (m.eliminado || e.pointerType === 'mouse') return
    const temporizador = window.setTimeout(() => {
      if (gesto.current) gesto.current.largo = true
      if (navigator.vibrate) navigator.vibrate(10)
      setAncla(burbuja.current)
    }, PULSACION_MS)
    gesto.current = { x: e.clientX, y: e.clientY, temporizador, tactil: true, largo: false }
  }
  const alMover = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesto.current
    if (!g) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) cancelarPulsacion()
    if (alResponder && !enHilo && dx > 0 && Math.abs(dy) < 40) setDesliz(Math.min(72, dx))
  }
  const alSoltar = () => {
    cancelarPulsacion()
    if (desliz >= DESLIZ_PX && alResponder) alResponder()
    setDesliz(0)
    gesto.current = null
  }

  // Lo que el sistema escribe como una persona (2026-10-18, `redaccion_chat.py`) va en la burbuja de
  // siempre, firmada por «Mesa de Partes», «Agenda»…; cada uno es un mensaje entero (sin agrupar).
  const humano = !m.eliminado && esMensajeHumano(m)
  if (m.autor_id === null && !m.eliminado && !humano && tieneTarjeta(m)) {
    return <TarjetaSistema m={m} resaltado={resaltado} hechas={hechas} alAccion={alAccion} seguida={seguidaSistema} />
  }
  if (m.autor_id === null && !humano) {
    return (
      <Box id={`mensaje-${m.id}`} sx={{ display: 'flex', justifyContent: 'center', px: 2, py: 0.5 }}>
        <Box sx={{ maxWidth: 'min(92%, 520px)', bgcolor: 'background.paper', borderRadius: 3, px: 1.5, py: 0.75, textAlign: 'center', outline: borde, boxShadow: '0 1px 1px rgba(36,31,28,.06)' }}>
          {m.eliminado ? (
            <Typography variant="body2" component="div" sx={{ ...PARRAFO, color: 'text.disabled', fontStyle: 'italic' }}>Mensaje eliminado<Pie texto={hora} /></Typography>
          ) : (
            <Box sx={{ textAlign: 'left' }}><Texto texto={m.texto} cuentas={cuentas} tenue pie={<Pie texto={hora} />} abierto={bloqueAbierto} alAlternar={setBloqueAbierto} /></Box>
          )}
          {!m.eliminado && ultimoEsBoton(m.texto, bloqueAbierto) && <Typography variant="caption" sx={{ display: 'block', textAlign: 'right', color: PALETA.textoTenue, fontSize: 11 }}>{hora}</Typography>}
          <Acciones m={m} hechas={hechas} alAccion={alAccion} centrado />
        </Box>
      </Box>
    )
  }

  const firma = humano && m.tarjeta && 'firma' in m.tarjeta ? m.tarjeta.firma || 'Sistema' : m.autor
  const icono = humano && m.tarjeta && 'icono' in m.tarjeta ? m.tarjeta.icono : undefined
  const color = humano ? colorDeIcono(icono) : colorDePersona(m.autor_id)
  if (humano) {
    inicio = true
    fin = true
  }
  const encuesta = !m.eliminado && m.encuesta ? m.encuesta : null
  const conTexto = !m.eliminado && m.texto.trim().length > 0 && !encuesta
  const radio = 18
  const chico = 6
  const esquinas = propio
    ? { borderTopRightRadius: inicio ? radio : chico, borderBottomRightRadius: fin ? 0 : chico }
    : { borderTopLeftRadius: inicio ? radio : chico, borderBottomLeftRadius: fin ? 0 : chico }
  const fondo = propio ? PALETA.guindaSuave : PALETA.superficie
  // La hora va dentro del texto (flotando al final) salvo cuando lo último es el botón del bloque o no hay texto.
  const pieDentro = conTexto && !ultimoEsBoton(m.texto, bloqueAbierto)
  const marca = propio && !m.eliminado ? entrega : undefined

  return (
    <Box
      id={`mensaje-${m.id}`}
      onPointerDown={alPulsar}
      onPointerMove={alMover}
      onPointerUp={alSoltar}
      onPointerCancel={alSoltar}
      onContextMenu={(e) => {
        if (gesto.current?.tactil || gesto.current?.largo) e.preventDefault()
      }}
      sx={{
        display: 'flex', flexDirection: propio ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 0.75, px: { xs: 1, sm: 2 },
        pt: inicio ? 0.75 : 0.2, pb: 0.2, touchAction: 'pan-y', position: 'relative',
        transform: desliz ? `translateX(${desliz}px)` : undefined, transition: desliz ? undefined : 'transform .18s',
        '& .acciones': { opacity: 0, transition: 'opacity .12s' },
        '&:hover .acciones, &:focus-within .acciones': { opacity: 1 },
        '@media (hover: none)': { '& .acciones': { display: 'none' }, userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' },
      }}
    >
      {desliz > 0 && (
        <Box sx={{ position: 'absolute', left: -desliz + 12, top: '50%', mt: -1.5, width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: desliz >= DESLIZ_PX ? 'primary.main' : PALETA.apagado, color: '#fff', transition: 'background-color .12s' }}>
          <ReplyOutlinedIcon sx={{ fontSize: 16 }} />
        </Box>
      )}
      {!propio && (
        <Box sx={{ width: 30, flexShrink: 0, display: { xs: enHilo ? 'none' : 'block', sm: 'block' } }}>
          {fin && humano && <Tooltip title={`${firma} · mensaje automático`}><Box><AvatarSistema icono={icono} /></Box></Tooltip>}
          {fin && !humano && (
            <Tooltip title={m.autor}>
              {/* Tocar el avatar o el nombre abre la tarjeta de contacto (2026-10-12). */}
              <ButtonBase onPointerDown={(e) => e.stopPropagation()} onClick={() => abrirTarjeta(m.autor_id)} aria-label={`Contacto de ${m.autor}`} sx={{ borderRadius: '50%' }}>
                <AvatarPersona id={m.autor_id} nombre={m.autor} tamano={30} sx={{ fontSize: 11.5 }} />
              </ButtonBase>
            </Tooltip>
          )}
        </Box>
      )}
      <Box sx={{ maxWidth: { xs: '86%', sm: 'min(76%, 640px)' }, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: propio ? 'flex-end' : 'flex-start' }}>
        <Box
          ref={burbuja}
          sx={{
            position: 'relative', bgcolor: fondo, borderRadius: `${radio}px`, ...esquinas, px: 1.25, pt: 0.6, pb: conTexto ? 0.6 : 0.5, outline: borde,
            boxShadow: `0 1px 1px ${PALETA.texto}12`, minWidth: 72, maxWidth: '100%',
            ...(fin ? {
              '&::after': {
                content: '""', position: 'absolute', bottom: 0, width: 9, height: 15, bgcolor: fondo,
                ...(propio ? { right: -8, clipPath: 'polygon(0 0, 100% 100%, 0 100%)' } : { left: -8, clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }),
              },
            } : {}),
          }}
        >
          {inicio && humano && (
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, color, lineHeight: 1.3, mb: 0.25 }} noWrap>{firma}</Typography>
          )}
          {inicio && !propio && !m.eliminado && !humano && (
            <Typography onPointerDown={(e) => e.stopPropagation()} onClick={() => abrirTarjeta(m.autor_id)} sx={{ fontSize: 12.5, fontWeight: 700, color, lineHeight: 1.3, mb: 0.25, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }} noWrap>{m.autor}</Typography>
          )}
          {citado && (inicio || m.responde_a_id) && !m.eliminado && <Cita m={citado} />}
          {m.eliminado ? (
            <Typography variant="body2" component="div" sx={{ ...PARRAFO, color: 'text.disabled', fontStyle: 'italic', fontSize: { xs: 15, md: 14 } }}>Mensaje eliminado<Pie texto={rotuloHora} /></Typography>
          ) : (
            <>
              {m.archivos.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: conTexto ? 0.5 : 0, mt: 0.25 }}>
                  {m.archivos.map((a, i) => <Adjunto key={a.id ?? i} a={a} alFallar={alFallar} />)}
                </Box>
              )}
              {conTexto && humano && <TextoOrdenado texto={m.texto} cuentas={cuentas} pie={<Pie texto={rotuloHora} />} />}
              {conTexto && !humano && <Texto texto={m.texto} cuentas={cuentas} pie={<Pie texto={rotuloHora} estado={marca} />} abierto={bloqueAbierto} alAlternar={setBloqueAbierto} />}
              {encuesta && <VistaEncuesta e={encuesta} hora={rotuloHora} puedeCerrar={puedeCerrarEncuesta} alVotar={alVotar} alCerrar={alCerrarEncuesta} />}
              {!pieDentro && !encuesta && (
                <Typography variant="caption" sx={{ display: 'block', textAlign: 'right', color: PALETA.textoTenue, fontSize: 11, lineHeight: 1.2, mt: 0.5 }}>{rotuloHora}{marca && <MarcaEntrega estado={marca} />}</Typography>
              )}
              <Acciones m={m} hechas={hechas} alAccion={alAccion} humano={humano} alFallar={alFallar} />
            </>
          )}
        </Box>
        <Reacciones m={m} propio={propio} alReaccionar={alReaccionar} />
        {m.respuestas > 0 && !enHilo && alResponder && (
          <Button size="small" startIcon={<ForumOutlinedIcon />} onClick={alResponder} sx={{ py: 0, minHeight: 24, fontSize: 12.5, textTransform: 'none' }}>
            {plural(m.respuestas, 'respuesta', 'respuestas')}
          </Button>
        )}
      </Box>
      {!m.eliminado && (
        <Box className="acciones" sx={{ display: 'flex', flexShrink: 0, alignSelf: 'center' }}>
          {alReaccionar && (
            <Tooltip title="Reaccionar"><IconButton size="small" aria-label="Reaccionar" onClick={() => setAncla(burbuja.current)}><AddReactionOutlinedIcon sx={{ fontSize: 18 }} /></IconButton></Tooltip>
          )}
          {alResponder && !enHilo && (
            <Tooltip title={cita ? 'Responder' : 'Responder en hilo'}><IconButton size="small" aria-label={cita ? 'Responder' : 'Responder en hilo'} onClick={alResponder}><ReplyOutlinedIcon sx={{ fontSize: 18 }} /></IconButton></Tooltip>
          )}
          {propio && alEditar && (
            <Tooltip title="Editar"><IconButton size="small" aria-label="Editar" onClick={alEditar}><EditOutlinedIcon sx={{ fontSize: 18 }} /></IconButton></Tooltip>
          )}
          {puedeEliminar && alEliminar && (
            <Tooltip title="Eliminar"><IconButton size="small" aria-label="Eliminar" onClick={alEliminar}><DeleteOutlineIcon sx={{ fontSize: 18 }} /></IconButton></Tooltip>
          )}
        </Box>
      )}
      <BarraMensaje ancla={ancla} m={m} propio={propio} puedeEliminar={puedeEliminar} enHilo={enHilo} alCerrar={() => setAncla(null)}
        alResponder={alResponder} alEditar={alEditar} alEliminar={alEliminar} alReaccionar={alReaccionar} alFallar={alFallar} alInfo={alInfo} />
    </Box>
  )
}
