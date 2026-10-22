/**
 * UN ADJUNTO dentro de la burbuja (2026-10-12, fase 9.4): una imagen es una miniatura (toque
 * = verla grande, con «Guardar»); un PDF, un video u otro archivo es una tarjeta con icono,
 * nombre y peso (toque = guardar con `descargarArchivo`; el PDF además se abre en otra
 * pestaña). Lo que es solo una referencia a algo del sistema (`entrada:12`, sin archivo)
 * sigue siendo un chip que abre su módulo.
 *
 * Una NOTA DE VOZ (fase 9.6; `esAudio`) es un reproductor compacto: play o pausa, la barra para
 * adelantar, la duración (la guardada al subir: el webm de MediaRecorder no la trae) y la
 * velocidad (1×, 1,5×, 2×). El audio se baja autenticado al primer play (`urlDeArchivo`, un
 * `blob:` en memoria: adelantar no depende de los rangos del servidor) y suena uno a la vez.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import IconButton from '@mui/material/IconButton'
import Skeleton from '@mui/material/Skeleton'
import Slider from '@mui/material/Slider'
import Typography from '@mui/material/Typography'
import BrokenImageOutlinedIcon from '@mui/icons-material/BrokenImageOutlined'
import CloseIcon from '@mui/icons-material/Close'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import LinkIcon from '@mui/icons-material/Link'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import PauseRoundedIcon from '@mui/icons-material/PauseRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined'
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined'
import { descargarArchivo, PALETA } from '@qillqa/tiqsi'
import { rutaVinculo } from './apoyo'
import { claseArchivo, duracionLegible, esAudio, nombreEntidad, pesoLegible, type Archivo } from './mensajes'
import { urlDeArchivo } from './subida'

interface Props {
  a: Archivo
  /** Al abrir o guardar algo que falló: el texto para el aviso. */
  alFallar: (texto: string) => void
}

const rutaDe = (a: Archivo) => `/api/chat/archivos/${a.id}`

function Imagen({ a, alFallar }: Props) {
  const [url, setUrl] = useState<string | null>(null)
  const [fallo, setFallo] = useState(false)
  const [grande, setGrande] = useState(false)
  useEffect(() => {
    let vivo = true
    if (a.id) urlDeArchivo(a.id).then((u) => vivo && setUrl(u)).catch(() => vivo && setFallo(true))
    return () => {
      vivo = false
    }
  }, [a.id])

  const guardar = async () => {
    try {
      await descargarArchivo(rutaDe(a), a.nombre)
    } catch (e) {
      alFallar(e instanceof Error ? e.message : 'No se pudo guardar la imagen.')
    }
  }

  return (
    <>
      <ButtonBase onClick={() => url && setGrande(true)} aria-label={`Ver ${a.nombre}`} sx={{ display: 'block', borderRadius: 2, overflow: 'hidden', width: '100%', maxWidth: 320, bgcolor: PALETA.superficieMedia }}>
        {fallo ? (
          <Box sx={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.disabled' }}><BrokenImageOutlinedIcon /></Box>
        ) : url ? (
          <Box component="img" src={url} alt={a.nombre} sx={{ display: 'block', width: '100%', maxHeight: 360, objectFit: 'cover' }} />
        ) : (
          <Skeleton variant="rectangular" width="100%" height={180} sx={{ maxWidth: 320 }} />
        )}
      </ButtonBase>
      <Dialog open={grande} onClose={() => setGrande(false)} fullScreen PaperProps={{ sx: { bgcolor: PALETA.oscuroVisor, color: '#fff' } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, flexShrink: 0 }}>
          <IconButton onClick={() => setGrande(false)} aria-label="Cerrar" sx={{ color: '#fff' }}><CloseIcon /></IconButton>
          <Typography noWrap sx={{ flex: 1, fontSize: 14 }}>{a.nombre}</Typography>
          <IconButton onClick={() => void guardar()} aria-label="Guardar" sx={{ color: '#fff' }}><DownloadOutlinedIcon /></IconButton>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 1 }} onClick={() => setGrande(false)}>
          {url && <Box component="img" src={url} alt={a.nombre} sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
        </Box>
      </Dialog>
    </>
  )
}

/** El audio que está sonando (al tocar otro, este se pausa). */
let sonando: HTMLAudioElement | null = null
const VELOCIDADES = [1, 1.5, 2]

function NotaDeVoz({ a, alFallar }: Props) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [cargando, setCargando] = useState(false)
  const [tocando, setTocando] = useState(false)
  const [pos, setPos] = useState(0)
  const [dur, setDur] = useState((a.duracion_ms ?? 0) / 1000)
  const [vel, setVel] = useState(1)

  useEffect(() => () => {
    const el = audio.current
    if (el && sonando === el) sonando = null
    el?.pause()
  }, [])

  /** Baja el audio la primera vez (autenticado) y lo deja listo en el elemento. */
  const preparar = async (): Promise<HTMLAudioElement | null> => {
    const el = audio.current
    if (!el || !a.id) return null
    if (!el.src) {
      setCargando(true)
      try {
        el.src = await urlDeArchivo(a.id)
        await new Promise<void>((ok) => {
          if (el.readyState >= 1) return ok()
          el.addEventListener('loadedmetadata', () => ok(), { once: true })
          el.addEventListener('error', () => ok(), { once: true })
        })
      } finally {
        setCargando(false)
      }
    }
    return el
  }

  const alternar = async () => {
    try {
      const el = await preparar()
      if (!el) return
      if (!el.paused) return el.pause()
      if (sonando && sonando !== el) sonando.pause()
      sonando = el
      el.playbackRate = vel
      await el.play()
    } catch {
      alFallar('No se pudo reproducir la nota de voz.')
    }
  }

  const adelantar = async (segundos: number) => {
    setPos(segundos)
    const el = await preparar().catch(() => null)
    if (el) el.currentTime = segundos
  }

  const cambiarVelocidad = () => {
    const v = VELOCIDADES[(VELOCIDADES.indexOf(vel) + 1) % VELOCIDADES.length]
    setVel(v)
    if (audio.current) audio.current.playbackRate = v
  }

  const total = dur > 0 ? dur : 0
  const rotulo = tocando || pos > 0 ? duracionLegible(pos * 1000) : duracionLegible(total * 1000)

  return (
    // El gesto de la burbuja (deslizar = responder, pulsación larga) no debe robarle el arrastre a la barra.
    <Box onPointerDown={(e) => e.stopPropagation()} sx={{ display: 'flex', alignItems: 'center', gap: 1, width: { xs: 240, sm: 280 }, maxWidth: '100%', py: 0.25 }}>
      <IconButton onClick={() => void alternar()} aria-label={tocando ? 'Pausar la nota de voz' : 'Reproducir la nota de voz'} disabled={cargando}
        sx={{ width: 40, height: 40, flexShrink: 0, bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.dark' }, '&.Mui-disabled': { bgcolor: 'primary.main', color: 'primary.contrastText', opacity: 0.8 } }}>
        {cargando ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : tocando ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
      </IconButton>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Slider
          size="small"
          value={Math.min(pos, total || pos)}
          min={0}
          max={total || 1}
          step={0.1}
          disabled={!total}
          onChange={(_, v) => setPos(v as number)}
          onChangeCommitted={(_, v) => void adelantar(v as number)}
          aria-label="Avance de la nota de voz"
          sx={{ display: 'block', py: '10px !important', mt: 0.25, '& .MuiSlider-thumb': { width: 12, height: 12 }, '& .MuiSlider-rail': { opacity: 0.25 } }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: -0.5 }}>
          <Typography component="span" sx={{ fontSize: 11.5, color: PALETA.textoTenue, fontVariantNumeric: 'tabular-nums' }}>{rotulo}</Typography>
          {(tocando || pos > 0) && (
            <ButtonBase onClick={cambiarVelocidad} aria-label={`Velocidad ${vel}×`} sx={{ fontSize: 11.5, fontWeight: 700, color: PALETA.textoTenue, px: 0.75, borderRadius: 999, bgcolor: PALETA.veloMedio }}>
              {String(vel).replace('.', ',')}×
            </ButtonBase>
          )}
        </Box>
      </Box>
      <audio
        ref={audio}
        preload="none"
        onPlay={() => setTocando(true)}
        onPause={() => setTocando(false)}
        onEnded={() => { setTocando(false); setPos(0) }}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0 && setDur(e.currentTarget.duration)}
        onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0 && setDur(e.currentTarget.duration)}
        hidden
      />
    </Box>
  )
}

function Tarjeta({ a, alFallar }: Props) {
  const [ocupada, setOcupada] = useState(false)
  const clase = claseArchivo(a.nombre)
  const Icono = clase === 'pdf' ? PictureAsPdfOutlinedIcon : clase === 'video' ? VideocamOutlinedIcon : InsertDriveFileOutlinedIcon
  const ext = (a.nombre.split('.').pop() ?? '').toUpperCase()
  const detalle = [ext && ext !== a.nombre.toUpperCase() ? ext : '', pesoLegible(a.bytes)].filter(Boolean).join(' · ')

  const guardar = async () => {
    if (ocupada) return
    setOcupada(true)
    try {
      await descargarArchivo(rutaDe(a), a.nombre)
    } catch (e) {
      alFallar(e instanceof Error ? e.message : 'No se pudo guardar el archivo.')
    } finally {
      setOcupada(false)
    }
  }

  // Abrir en otra pestaña: la pestaña se abre en el gesto (antes del fetch) para que el
  // bloqueador de ventanas no la corte; luego recibe el blob autenticado.
  const abrir = async () => {
    if (!a.id) return
    const ventana = window.open('', '_blank')
    try {
      const url = await urlDeArchivo(a.id)
      if (ventana) ventana.location.href = url
      else window.open(url, '_blank')
    } catch (e) {
      ventana?.close()
      alFallar(e instanceof Error ? e.message : 'No se pudo abrir el archivo.')
    }
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 0.75, pr: 0.5, borderRadius: 2, bgcolor: PALETA.velo, width: '100%', maxWidth: 320 }}>
      <ButtonBase onClick={() => void guardar()} disabled={ocupada} sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0, textAlign: 'left', borderRadius: 1.5 }}>
        <Box sx={{ width: 38, height: 38, borderRadius: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.paper', color: clase === 'pdf' ? PALETA.error : 'primary.main', flexShrink: 0 }}>
          {ocupada ? <CircularProgress size={18} /> : <Icono sx={{ fontSize: 22 }} />}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.25, overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{a.nombre}</Typography>
          {detalle && <Typography variant="caption" sx={{ color: PALETA.textoTenue, display: 'block', lineHeight: 1.3 }}>{detalle}</Typography>}
        </Box>
      </ButtonBase>
      {clase === 'pdf' && (
        <IconButton size="small" aria-label="Abrir en otra pestaña" onClick={() => void abrir()}><OpenInNewIcon sx={{ fontSize: 18 }} /></IconButton>
      )}
    </Box>
  )
}

export default function Adjunto({ a, alFallar }: Props) {
  const navegar = useNavigate()
  if (!a.archivo || !a.id) {
    const ruta = a.referencia ? rutaVinculo(a.referencia) : null
    return <Chip size="small" variant="outlined" icon={<LinkIcon sx={{ fontSize: '15px !important' }} />} label={a.nombre || (a.referencia ? nombreEntidad(a.referencia) : 'Referencia')} onClick={ruta ? () => navegar(ruta) : undefined} sx={{ maxWidth: 280, bgcolor: 'background.paper' }} />
  }
  if (esAudio(a)) return <NotaDeVoz a={a} alFallar={alFallar} />
  return claseArchivo(a.nombre) === 'imagen' ? <Imagen a={a} alFallar={alFallar} /> : <Tarjeta a={a} alFallar={alFallar} />
}
