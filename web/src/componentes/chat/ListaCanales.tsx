/**
 * LISTA DE CANALES (fase 8.3; como WhatsApp desde 2026-10-12, fase 9.4): arriba la búsqueda
 * de mensajes; debajo las secciones (Directos con los no leídos primero, Grupos, Temas con sus
 * subtemas y Comisiones, plegable), cada fila con avatar redondo (iniciales en el color de la
 * persona, o icono), nombre, última línea, hora y el contador en vino. «Nuevo» es un botón
 * flotante abajo a la derecha en el celular y un botón junto a la búsqueda en pantalla ancha.
 * Con dos letras o más en la búsqueda, la lista cede su sitio a los resultados de
 * `GET /api/chat/buscar`; pulsar uno abre el canal en ese mensaje. A la izquierda de la búsqueda,
 * la foto propia lleva a «Mi perfil» (2026-10-12), como en Telegram.
 *
 * Temas por sección (2026-10-13): los temas del equipo van agrupados en secciones plegables
 * (Equipo, Documentos, Agenda, Legislativo, Prensa y medios, Representación y las que cree quien
 * administra), cada una con cuántos temas tiene y, plegada, cuánto hay sin leer
 * (`entrega.ts::agruparTemas`). Se abre sola la que tiene algo sin leer o la conversación abierta;
 * lo que la persona pliega o despliega se recuerda en este dispositivo. Arriba, la invitación
 * breve a activar los avisos en el celular (la pieza «push.Invitacion» del anfitrión), una sola vez.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import Badge from '@mui/material/Badge'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Fab from '@mui/material/Fab'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import LinearProgress from '@mui/material/LinearProgress'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddCommentOutlinedIcon from '@mui/icons-material/AddCommentOutlined'
import ClearIcon from '@mui/icons-material/Clear'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined'
import BookmarkBorderOutlinedIcon from '@mui/icons-material/BookmarkBorderOutlined'
import SearchIcon from '@mui/icons-material/Search'
import { api, Pieza, PALETA } from '@qillqa/tiqsi'
import AvatarCanal from './AvatarCanal'
import AvatarPersona from './Avatar'
import { fechaCorta, secciones, vistaPrevia, type Canal, type Mensaje, type PersonaEquipo, type Tema } from './mensajes'
import { agruparTemas } from './entrega'

const CLAVE_PLEGADAS = 'qillqa_chat_secciones'

function leerPlegado(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_PLEGADAS) || '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

/** Una sección de temas: cabecera tocable con su nombre, cuántos temas y, plegada, lo sin leer. */
function SeccionTemas({ categoria, temas, noLeidos, actual, yo, miId, alElegir }: {
  categoria: string; temas: Tema[]; noLeidos: number; actual: number | null; yo: string | null; miId: number | null; alElegir: (id: number) => void
}) {
  const dentro = temas.some((t) => t.canal.id === actual || t.hijos.some((h) => h.id === actual))
  const guardado = leerPlegado()[categoria]
  const [abierta, setAbierta] = useState<boolean>(guardado ?? (dentro || noLeidos > 0 || categoria === 'Equipo'))
  useEffect(() => {
    if (dentro) setAbierta(true)
  }, [dentro])
  const alternar = () => {
    const v = !abierta
    setAbierta(v)
    try {
      localStorage.setItem(CLAVE_PLEGADAS, JSON.stringify({ ...leerPlegado(), [categoria]: v }))
    } catch {
      /* sin almacenamiento: no se recuerda */
    }
  }
  return (
    <Box sx={{ pb: abierta ? 0.5 : 0 }}>
      <ButtonBase onClick={alternar} aria-expanded={abierta} sx={{ display: 'flex', width: '100%', alignItems: 'center', gap: 0.75, px: 2, pt: 1.1, pb: 0.5, textAlign: 'left' }}>
        <Typography component="h3" sx={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: PALETA.textoTenue }}>{categoria}</Typography>
        <Typography component="span" sx={{ fontSize: 11.5, color: PALETA.apagado, flex: 1 }}>{temas.length}</Typography>
        {!abierta && noLeidos > 0 && <Box component="span" sx={{ fontSize: 11, fontWeight: 700, lineHeight: '18px', minWidth: 18, px: 0.6, borderRadius: 9, textAlign: 'center', bgcolor: 'primary.main', color: 'primary.contrastText' }}>{noLeidos > 99 ? '99+' : noLeidos}</Box>}
        <ExpandMoreIcon sx={{ fontSize: 18, color: PALETA.textoTenue, transform: abierta ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </ButtonBase>
      {abierta && temas.map((t) => (
        <Box key={t.canal.id}>
          <Fila c={t.canal} activa={t.canal.id === actual} yo={yo} miId={miId} alElegir={() => alElegir(t.canal.id)} />
          {t.hijos.map((h) => <Fila key={h.id} c={h} hijo activa={h.id === actual} yo={yo} miId={miId} alElegir={() => alElegir(h.id)} />)}
        </Box>
      ))}
    </Box>
  )
}

interface Props {
  canales: Canal[] | null
  actual: number | null
  equipo: PersonaEquipo[]
  miId: number | null
  alElegir: (id: number) => void
  alNuevo: () => void
  /** «Mis notas» (2026-10-19): el chat de uno mismo, fijo arriba. */
  alNotas?: () => void
  alAbrirMensaje: (canal: number, mensaje: number) => void
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Box sx={{ pb: 0.5 }}>
      <Typography component="h3" sx={{ px: 2, pt: 1.25, pb: 0.25, fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: PALETA.textoTenue }}>{titulo}</Typography>
      {children}
    </Box>
  )
}

function Fila({ c, activa, enLinea, yo, miId, hijo, alElegir }: { c: Canal; activa: boolean; enLinea?: boolean; yo: string | null; miId: number | null; hijo?: boolean; alElegir: () => void }) {
  const conNoLeidos = c.no_leidos > 0
  const tamano = hijo ? 32 : 44
  return (
    <ButtonBase
      onClick={alElegir}
      aria-current={activa ? 'true' : undefined}
      sx={{
        display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center', gap: 1.5, pr: 1.5, pl: hijo ? 4.5 : 1.5, py: hijo ? 0.6 : 1,
        bgcolor: activa ? PALETA.guindaSuave : 'transparent',
        '&:hover': { bgcolor: activa ? PALETA.guindaSuave : PALETA.superficieTenue },
      }}
    >
      <Badge overlap="circular" variant="dot" anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} invisible={!enLinea} sx={{ '& .MuiBadge-badge': { bgcolor: PALETA.exito, boxShadow: `0 0 0 2px ${PALETA.superficie}`, width: 10, height: 10, borderRadius: 5 } }}>
        <AvatarCanal canal={c} miId={miId} tamano={tamano} />
      </Badge>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
          <Typography noWrap sx={{ fontSize: hijo ? 14 : 15, fontWeight: conNoLeidos ? 700 : 500, flex: 1, minWidth: 0 }}>{c.nombre}</Typography>
          {c.ultimo && <Typography variant="caption" sx={{ flexShrink: 0, fontSize: 11.5, color: conNoLeidos ? 'primary.main' : PALETA.textoTenue, fontWeight: conNoLeidos ? 700 : 400 }}>{fechaCorta(c.ultimo.creado_en)}</Typography>}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.1 }}>
          <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 13, color: conNoLeidos ? 'text.primary' : 'text.secondary' }}>{vistaPrevia(c, yo)}</Typography>
          {conNoLeidos && (
            <Box component="span" sx={{ fontSize: 11, fontWeight: 700, lineHeight: '20px', minWidth: 20, px: 0.75, borderRadius: 10, textAlign: 'center', bgcolor: 'primary.main', color: 'primary.contrastText', flexShrink: 0 }}>
              {c.no_leidos > 99 ? '99+' : c.no_leidos}
            </Box>
          )}
        </Box>
      </Box>
    </ButtonBase>
  )
}

/** El tema «Comisiones» con sus canales plegados; se abre solo si una comisión tiene no leídos o está abierta. */
function Comisiones({ t, actual, yo, miId, alElegir }: { t: Tema; actual: number | null; yo: string | null; miId: number | null; alElegir: (id: number) => void }) {
  const sinLeer = t.hijos.reduce((n, h) => n + h.no_leidos, 0)
  const dentro = t.hijos.some((h) => h.id === actual)
  const [abierto, setAbierto] = useState(dentro || sinLeer > 0)
  useEffect(() => {
    if (dentro) setAbierto(true)
  }, [dentro])
  return (
    <Box sx={{ pb: 0.5 }}>
      <ButtonBase onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} sx={{ display: 'flex', width: '100%', alignItems: 'center', gap: 0.5, px: 2, pt: 1.25, pb: 0.25, textAlign: 'left' }}>
        <Typography component="h3" sx={{ flex: 1, fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: PALETA.textoTenue }}>Comisiones</Typography>
        {!abierto && sinLeer > 0 && <Box component="span" sx={{ fontSize: 11, fontWeight: 700, lineHeight: '18px', minWidth: 18, px: 0.6, borderRadius: 9, textAlign: 'center', bgcolor: 'primary.main', color: 'primary.contrastText' }}>{sinLeer}</Box>}
        <ExpandMoreIcon sx={{ fontSize: 18, color: PALETA.textoTenue, transform: abierto ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </ButtonBase>
      <Fila c={t.canal} activa={t.canal.id === actual} yo={yo} miId={miId} alElegir={() => alElegir(t.canal.id)} />
      {abierto && t.hijos.map((h) => <Fila key={h.id} c={h} hijo activa={h.id === actual} yo={yo} miId={miId} alElegir={() => alElegir(h.id)} />)}
    </Box>
  )
}

export default function ListaCanales({ canales, actual, equipo, miId, alElegir, alNuevo, alNotas, alAbrirMensaje }: Props) {
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<Mensaje[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const yo = localStorage.getItem('qillqa_nombre')
  const navegar = useNavigate()

  useEffect(() => {
    const texto = q.trim()
    if (texto.length < 2) {
      setResultados(null)
      setBuscando(false)
      return
    }
    setBuscando(true)
    const t = window.setTimeout(() => {
      api<{ mensajes: Mensaje[] }>(`/api/chat/buscar?q=${encodeURIComponent(texto)}`)
        .then((r) => setResultados(r.mensajes))
        .catch(() => setResultados([]))
        .finally(() => setBuscando(false))
    }, 300)
    return () => window.clearTimeout(t)
  }, [q])

  const enLinea = new Set(equipo.filter((p) => p.en_linea).map((p) => p.nombre))
  const nombreCanal = (id: number) => canales?.find((c) => c.id === id)?.nombre ?? ''
  // El chat de uno mismo (clave «u:X-u:X») sale de la lista de directos: va fijo arriba como «Mis notas».
  const notas = canales?.find((c) => c.clase === 'directo' && miId != null && c.clave === `u:${miId}-u:${miId}`) ?? null
  const s = canales ? secciones(canales.filter((c) => c !== notas)) : null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, bgcolor: 'background.paper', position: 'relative' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 1, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
        <IconButton onClick={() => navegar('/perfil')} aria-label="Mi perfil" title="Mi perfil" sx={{ p: 0.25, flexShrink: 0 }}>
          <AvatarPersona id={miId} nombre={yo || '·'} tamano={34} />
        </IconButton>
        <TextField
          size="small"
          fullWidth
          placeholder="Buscar"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          inputProps={{ 'aria-label': 'Buscar mensajes', enterKeyHint: 'search' }}
          InputProps={{
            startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" sx={{ color: PALETA.textoTenue }} /></InputAdornment>,
            endAdornment: q ? <InputAdornment position="end"><IconButton size="small" aria-label="Limpiar" onClick={() => setQ('')}><ClearIcon sx={{ fontSize: 16 }} /></IconButton></InputAdornment> : undefined,
          }}
          sx={{ '& input': { fontSize: { xs: 16, md: 14 }, py: 0.9 }, '& .MuiOutlinedInput-root': { borderRadius: 999, bgcolor: PALETA.fondo, '& fieldset': { borderColor: 'transparent' }, '&.Mui-focused fieldset': { borderWidth: 1 } } }}
        />
        <Button variant="contained" size="small" disableElevation startIcon={<AddCommentOutlinedIcon />} onClick={alNuevo} sx={{ whiteSpace: 'nowrap', flexShrink: 0, borderRadius: 999, display: { xs: 'none', sm: 'inline-flex' } }}>
          Nuevo
        </Button>
      </Box>
      {buscando && <LinearProgress />}
      <Pieza pieza="push.Invitacion" />
      <Box sx={{ overflow: 'auto', flex: 1, minHeight: 0, pb: { xs: 10, sm: 1 }, overscrollBehavior: 'contain' }}>
        {resultados !== null ? (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 0.75 }}>
              {resultados.length === 0 ? 'Sin mensajes con ese texto.' : `${resultados.length} mensaje${resultados.length === 1 ? '' : 's'}`}
            </Typography>
            {resultados.map((m) => (
              <ButtonBase key={m.id} onClick={() => alAbrirMensaje(m.canal_id, m.id)} sx={{ display: 'block', width: '100%', textAlign: 'left', px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider', '&:hover': { bgcolor: PALETA.superficieTenue } }}>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                  {nombreCanal(m.canal_id) || 'Canal'} · {m.autor} · {fechaCorta(m.creado_en)}
                </Typography>
                <Typography variant="body2" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{m.texto}</Typography>
              </ButtonBase>
            ))}
          </>
        ) : canales === null ? (
          <LinearProgress />
        ) : canales.length === 0 ? (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <ForumOutlinedIcon sx={{ fontSize: 40, color: PALETA.apagado }} />
            <Typography variant="body2" color="text.secondary">Sin conversaciones. Pulse «Nuevo» para empezar.</Typography>
          </Box>
        ) : (
          <>
            {alNotas && miId != null && (
              <ButtonBase onClick={alNotas} aria-current={notas && notas.id === actual ? 'true' : undefined} sx={{ display: 'flex', width: '100%', alignItems: 'center', gap: 1.5, px: 1.5, py: 1, textAlign: 'left', bgcolor: notas && notas.id === actual ? PALETA.veloMedio : 'transparent', '&:hover': { bgcolor: 'action.hover' } }}>
                <Box sx={{ width: 44, height: 44, borderRadius: '50%', bgcolor: PALETA.superficieMedia, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'primary.main', flexShrink: 0 }}><BookmarkBorderOutlinedIcon /></Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 650, fontSize: 14.5 }} noWrap>Mis notas</Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>{notas?.ultimo?.texto || 'Lo que quiera guardar para usted'}</Typography>
                </Box>
                {notas && notas.no_leidos > 0 && <Box sx={{ minWidth: 20, height: 20, px: 0.75, borderRadius: 10, bgcolor: 'primary.main', color: 'primary.contrastText', fontSize: 11.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{notas.no_leidos}</Box>}
              </ButtonBase>
            )}
            {s!.directos.length > 0 && (
              <Seccion titulo="Directos">
                {s!.directos.map((c) => <Fila key={c.id} c={c} activa={c.id === actual} enLinea={enLinea.has(c.nombre)} yo={yo} miId={miId} alElegir={() => alElegir(c.id)} />)}
              </Seccion>
            )}
            {s!.grupos.length > 0 && (
              <Seccion titulo="Grupos">
                {s!.grupos.map((c) => <Fila key={c.id} c={c} activa={c.id === actual} yo={yo} miId={miId} alElegir={() => alElegir(c.id)} />)}
              </Seccion>
            )}
            {(() => {
              // Las comisiones (su carpeta de siempre) van justo después de la sección Legislativo.
              const grupos = agruparTemas(s!.temas)
              const iLeg = grupos.findIndex((g) => g.categoria === 'Legislativo')
              const com = s!.comisiones ? <Comisiones key="comisiones" t={s!.comisiones} actual={actual} yo={yo} miId={miId} alElegir={alElegir} /> : null
              return [
                ...grupos.flatMap((g, i) => [
                  <SeccionTemas key={g.categoria} categoria={g.categoria} temas={g.temas} noLeidos={g.noLeidos} actual={actual} yo={yo} miId={miId} alElegir={alElegir} />,
                  ...(i === iLeg && com ? [com] : []),
                ]),
                ...(iLeg === -1 && com ? [com] : []),
              ]
            })()}
          </>
        )}
      </Box>
      <Fab color="primary" aria-label="Nueva conversación" onClick={alNuevo} sx={{ position: 'absolute', right: 16, bottom: 16, display: { xs: 'inline-flex', sm: 'none' }, boxShadow: PALETA.sombraFlotante }}>
        <AddCommentOutlinedIcon />
      </Fab>
    </Box>
  )
}
