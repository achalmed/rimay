/**
 * EDICIÓN LIGERA DE UNA IMAGEN ANTES DE ENVIARLA (2026-10-18, Edison: «pegar, editar y anotar
 * imágenes antes de enviar»). Canvas 2D nativo, sin librería: nada sale del equipo y no pesa.
 *
 * Herramientas: lápiz, resaltador (trazo ancho semitransparente), flecha, recuadro, texto y recorte;
 * cinco colores sobrios; deshacer; «Listo» devuelve un PNG nuevo (`File`) con el mismo nombre. La
 * imagen se dibuja a su tamaño real en el lienzo y se muestra escalada (los trazos se guardan en
 * píxeles de la imagen, así el PNG final no pierde nitidez). En el celular ocupa la pantalla entera
 * y los botones van abajo, al alcance del pulgar. La Mediateca conserva su editor (girar, recortar
 * con proporciones, luz): aquel es para la foto guardada; este, para lo que se va a mandar.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Button from '@mui/material/Button'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import CloseIcon from '@mui/icons-material/Close'
import UndoIcon from '@mui/icons-material/Undo'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import BorderColorOutlinedIcon from '@mui/icons-material/BorderColorOutlined'
import NorthEastIcon from '@mui/icons-material/NorthEast'
import CropSquareOutlinedIcon from '@mui/icons-material/CropSquareOutlined'
import TitleIcon from '@mui/icons-material/Title'
import CropIcon from '@mui/icons-material/Crop'
import { PALETA, pedirTexto } from '@qillqa/tiqsi'

type Herramienta = 'lapiz' | 'resaltar' | 'flecha' | 'recuadro' | 'texto' | 'recortar'
type Punto = { x: number; y: number }
type Trazo =
  | { tipo: 'lapiz' | 'resaltar'; puntos: Punto[]; color: string; grosor: number }
  | { tipo: 'flecha' | 'recuadro'; de: Punto; a: Punto; color: string; grosor: number }
  | { tipo: 'texto'; en: Punto; texto: string; color: string; tam: number }
type Recorte = { x: number; y: number; w: number; h: number }

const HERRAMIENTAS: { clave: Herramienta; etiqueta: string; icono: React.ReactNode }[] = [
  { clave: 'lapiz', etiqueta: 'Lápiz', icono: <EditOutlinedIcon fontSize="small" /> },
  { clave: 'resaltar', etiqueta: 'Resaltar', icono: <BorderColorOutlinedIcon fontSize="small" /> },
  { clave: 'flecha', etiqueta: 'Flecha', icono: <NorthEastIcon fontSize="small" /> },
  { clave: 'recuadro', etiqueta: 'Recuadro', icono: <CropSquareOutlinedIcon fontSize="small" /> },
  { clave: 'texto', etiqueta: 'Texto', icono: <TitleIcon fontSize="small" /> },
  { clave: 'recortar', etiqueta: 'Recortar', icono: <CropIcon fontSize="small" /> },
]
const COLORES = [PALETA.error, PALETA.guinda, PALETA.dorado, '#241F1C', '#FFFFFF']

/** Dibuja los trazos sobre el contexto (en píxeles de la imagen). */
export function pintarTrazos(ctx: CanvasRenderingContext2D, trazos: Trazo[], base: number) {
  for (const t of trazos) {
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (t.tipo === 'lapiz' || t.tipo === 'resaltar') {
      ctx.strokeStyle = t.color
      ctx.lineWidth = t.grosor * base * (t.tipo === 'resaltar' ? 5 : 1)
      ctx.globalAlpha = t.tipo === 'resaltar' ? 0.35 : 1
      ctx.beginPath()
      t.puntos.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.stroke()
    } else if (t.tipo === 'recuadro') {
      ctx.strokeStyle = t.color
      ctx.lineWidth = t.grosor * base
      ctx.strokeRect(Math.min(t.de.x, t.a.x), Math.min(t.de.y, t.a.y), Math.abs(t.a.x - t.de.x), Math.abs(t.a.y - t.de.y))
    } else if (t.tipo === 'flecha') {
      ctx.strokeStyle = ctx.fillStyle = t.color
      ctx.lineWidth = t.grosor * base
      const ang = Math.atan2(t.a.y - t.de.y, t.a.x - t.de.x)
      const cabeza = 6 * t.grosor * base
      ctx.beginPath(); ctx.moveTo(t.de.x, t.de.y); ctx.lineTo(t.a.x, t.a.y); ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(t.a.x, t.a.y)
      ctx.lineTo(t.a.x - cabeza * Math.cos(ang - Math.PI / 6), t.a.y - cabeza * Math.sin(ang - Math.PI / 6))
      ctx.lineTo(t.a.x - cabeza * Math.cos(ang + Math.PI / 6), t.a.y - cabeza * Math.sin(ang + Math.PI / 6))
      ctx.closePath(); ctx.fill()
    } else if (t.tipo === 'texto') {
      ctx.fillStyle = t.color
      ctx.font = `600 ${t.tam * base}px system-ui, sans-serif`
      ctx.textBaseline = 'top'
      // Un halo claro u oscuro para que se lea sobre cualquier fondo.
      ctx.lineWidth = 3 * base
      ctx.strokeStyle = t.color === '#FFFFFF' ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.8)'
      ctx.strokeText(t.texto, t.en.x, t.en.y)
      ctx.fillText(t.texto, t.en.x, t.en.y)
    }
    ctx.restore()
  }
}

/** El PNG final: la imagen (recortada si hay recorte) con sus trazos. */
export async function componerImagen(img: HTMLImageElement, trazos: Trazo[], recorte: Recorte | null, nombre: string): Promise<File> {
  const r = recorte ?? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }
  const lienzo = document.createElement('canvas')
  lienzo.width = Math.max(1, Math.round(r.w))
  lienzo.height = Math.max(1, Math.round(r.h))
  const ctx = lienzo.getContext('2d')!
  ctx.translate(-r.x, -r.y)
  ctx.drawImage(img, 0, 0)
  pintarTrazos(ctx, trazos, Math.max(1, img.naturalWidth / 800))
  const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, 'image/png'))
  if (!blob) throw new Error('No se pudo componer la imagen.')
  return new File([blob], nombre.replace(/\.[a-z0-9]+$/i, '') + '.png', { type: 'image/png' })
}

export default function EditorImagen({ archivo, alCerrar, alGuardar }: { archivo: File | null; alCerrar: () => void; alGuardar: (nuevo: File) => void }) {
  const tema = useTheme()
  const celular = useMediaQuery(tema.breakpoints.down('sm'))
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [herramienta, setHerramienta] = useState<Herramienta>('lapiz')
  const [color, setColor] = useState(COLORES[0])
  const [trazos, setTrazos] = useState<Trazo[]>([])
  const [recorte, setRecorte] = useState<Recorte | null>(null)
  const [enCurso, setEnCurso] = useState<Trazo | Recorte | null>(null)
  const [guardando, setGuardando] = useState(false)
  const lienzo = useRef<HTMLCanvasElement | null>(null)
  const url = useMemo(() => (archivo ? URL.createObjectURL(archivo) : ''), [archivo])

  useEffect(() => {
    setTrazos([]); setRecorte(null); setEnCurso(null); setImg(null)
    if (!url) return
    const i = new Image()
    i.onload = () => setImg(i)
    i.src = url
    return () => URL.revokeObjectURL(url)
  }, [url])

  // Repintar: imagen, trazos, el trazo en curso y el recorte (lo de fuera, atenuado).
  useEffect(() => {
    const c = lienzo.current
    if (!c || !img) return
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const base = Math.max(1, img.naturalWidth / 800)
    pintarTrazos(ctx, trazos, base)
    if (enCurso && 'tipo' in enCurso) pintarTrazos(ctx, [enCurso], base)
    const rec = enCurso && !('tipo' in enCurso) ? enCurso : recorte
    if (rec) {
      ctx.save()
      ctx.fillStyle = 'rgba(0,0,0,.45)'
      ctx.beginPath()
      ctx.rect(0, 0, c.width, c.height)
      ctx.rect(rec.x, rec.y, rec.w, rec.h)
      ctx.fill('evenodd')
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * base; ctx.setLineDash([8 * base, 6 * base])
      ctx.strokeRect(rec.x, rec.y, rec.w, rec.h)
      ctx.restore()
    }
  }, [img, trazos, enCurso, recorte])

  const punto = (e: React.PointerEvent<HTMLCanvasElement>): Punto => {
    const c = lienzo.current!
    const r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height }
  }
  const grosor = 3
  const bajar = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!img) return
    const p = punto(e)
    e.currentTarget.setPointerCapture(e.pointerId)
    if (herramienta === 'texto') {
      const t = await pedirTexto('Texto sobre la imagen:', { titulo: 'Texto' })
      if (t?.trim()) setTrazos((l) => [...l, { tipo: 'texto', en: p, texto: t.trim(), color, tam: 22 }])
      return
    }
    if (herramienta === 'recortar') { setEnCurso({ x: p.x, y: p.y, w: 0, h: 0 }); return }
    if (herramienta === 'lapiz' || herramienta === 'resaltar') setEnCurso({ tipo: herramienta, puntos: [p], color, grosor })
    else setEnCurso({ tipo: herramienta, de: p, a: p, color, grosor })
  }
  const mover = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!enCurso) return
    const p = punto(e)
    if (!('tipo' in enCurso)) setEnCurso({ ...enCurso, w: p.x - enCurso.x, h: p.y - enCurso.y })
    else if (enCurso.tipo === 'lapiz' || enCurso.tipo === 'resaltar') setEnCurso({ ...enCurso, puntos: [...enCurso.puntos, p] })
    else if (enCurso.tipo === 'flecha' || enCurso.tipo === 'recuadro') setEnCurso({ ...enCurso, a: p })
  }
  const soltar = () => {
    if (!enCurso) return
    if (!('tipo' in enCurso)) {
      const r = { x: Math.min(enCurso.x, enCurso.x + enCurso.w), y: Math.min(enCurso.y, enCurso.y + enCurso.h), w: Math.abs(enCurso.w), h: Math.abs(enCurso.h) }
      if (r.w > 8 && r.h > 8) setRecorte(r)
    } else setTrazos((l) => [...l, enCurso])
    setEnCurso(null)
  }
  const deshacer = () => {
    if (recorte && herramienta === 'recortar') { setRecorte(null); return }
    setTrazos((l) => l.slice(0, -1))
  }
  const guardar = async () => {
    if (!img || !archivo) return
    setGuardando(true)
    try {
      alGuardar(await componerImagen(img, trazos, recorte, archivo.name))
    } finally {
      setGuardando(false)
    }
  }
  const hayCambios = trazos.length > 0 || recorte !== null

  // Sobre el fondo oscuro del editor: íconos blancos; la herramienta activa, en dorado sobre un velo.
  const herramientasEl = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexWrap: 'wrap', justifyContent: 'center', '& .MuiIconButton-root': { color: '#fff' }, '& .MuiIconButton-root.Mui-disabled': { color: 'rgba(255,255,255,.35)' } }}>
      {HERRAMIENTAS.map((h) => (
        <Tooltip key={h.clave} title={h.etiqueta} disableInteractive>
          <IconButton size="small" aria-label={h.etiqueta} onClick={() => setHerramienta(h.clave)} sx={herramienta === h.clave ? { color: `${PALETA.doradoLinea} !important`, bgcolor: 'rgba(255,255,255,.14)' } : undefined}>
            {h.icono}
          </IconButton>
        </Tooltip>
      ))}
      <Box sx={{ width: '1px', height: 22, bgcolor: 'rgba(255,255,255,.3)', mx: 0.5 }} />
      {COLORES.map((c) => (
        <IconButton key={c} size="small" aria-label={`Color ${c}`} onClick={() => setColor(c)} sx={{ p: 0.5 }}>
          <Box sx={{ width: 18, height: 18, borderRadius: '50%', bgcolor: c, border: '2px solid', borderColor: color === c ? 'primary.main' : PALETA.borde }} />
        </IconButton>
      ))}
      <Box sx={{ width: '1px', height: 22, bgcolor: 'rgba(255,255,255,.3)', mx: 0.5 }} />
      <Tooltip title="Deshacer" disableInteractive>
        <span><IconButton size="small" aria-label="Deshacer" onClick={deshacer} disabled={!hayCambios}><UndoIcon fontSize="small" /></IconButton></span>
      </Tooltip>
    </Box>
  )

  return (
    <Dialog open={archivo !== null} onClose={alCerrar} fullScreen={celular} maxWidth="md" fullWidth PaperProps={{ sx: { bgcolor: '#1b1716', color: '#fff', height: celular ? '100dvh' : '85vh', display: 'flex' } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5 }}>
        <IconButton aria-label="Cerrar" onClick={alCerrar} sx={{ color: '#fff' }}><CloseIcon /></IconButton>
        <Typography sx={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 15 }} noWrap>{archivo?.name ?? ''}</Typography>
        {!celular && herramientasEl}
        <Button variant="contained" size="small" onClick={() => void guardar()} disabled={guardando || !img} sx={{ ml: 1, flexShrink: 0 }}>
          {hayCambios ? 'Listo' : 'Sin cambios'}
        </Button>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', p: 1, overflow: 'hidden' }}>
        <canvas
          ref={lienzo}
          onPointerDown={(e) => void bajar(e)}
          onPointerMove={mover}
          onPointerUp={soltar}
          onPointerCancel={soltar}
          aria-label="Imagen para anotar"
          style={{ maxWidth: '100%', maxHeight: '100%', touchAction: 'none', cursor: herramienta === 'texto' ? 'text' : 'crosshair', boxShadow: '0 2px 16px rgba(0,0,0,.5)' }}
        />
      </Box>
      {celular && <Box sx={{ px: 1, pt: 0.5, pb: 'max(8px, env(safe-area-inset-bottom))', bgcolor: '#241F1C' }}>{herramientasEl}</Box>}
    </Dialog>
  )
}
