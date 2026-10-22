/**
 * CAJA DE ESCRITURA (fase 8.3; como WhatsApp desde 2026-10-12, fase 9.4): un área que crece,
 * Enter envía y Shift+Enter salta de línea (en el celular, Enter también envía: es un chat).
 * Una `@` abre el autocompletado con el equipo (`/api/chat/equipo`, flechas y Enter o Tab
 * eligen). El clip abre un menú de dos opciones: «Foto o archivo» (el selector del
 * dispositivo, varios a la vez; se suben al instante con `alSubir`, sin pedir título) y
 * «Enlazar algo del sistema» (una referencia `doc:95`, `entrada:12`… que viaja como
 * `archivos:[{referencia, nombre}]`). En el celular hay además un botón «Cámara»
 * (`capture`). «Vincular» (el mensaje queda ligado a una entidad) sigue en el menú.
 * Mientras se escribe, avisa por el socket (como mucho una vez cada 3 s). Los campos son de
 * 16 px en el celular para que iOS no haga zoom.
 *
 * Fase 9.6 (2026-10-12): el clip pasa a ser un «+» (`MenuMas`: hoja inferior en el celular) con
 * Foto o archivo, Nota de voz, Encuesta, Tarea, Actividad de agenda, Pegar resultado de un
 * prompt, Enlazar y Vincular; lo que no es de la caja (encuesta, tarea, agenda) lo atiende
 * quien la usa (`alHerramienta`, en `HerramientasChat`). Con la caja vacía, el botón de enviar
 * es un MICRÓFONO, como en WhatsApp: un toque graba (`useGrabadora`), con el contador, la
 * papelera para descartar y enviar; la nota sube por `alSubir` con su duración. Si lo escrito
 * trae un bloque `tipo: …` de un formato conocido, ANTES de enviar se avisa sobre la caja
 * («Reconocido: Agenda · se ofrecerá registrarlo», `avisoPegado`).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import MenuItem from '@mui/material/MenuItem'
import MenuList from '@mui/material/MenuList'
import Paper from '@mui/material/Paper'
import Popper from '@mui/material/Popper'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined'
import LinkIcon from '@mui/icons-material/Link'
import MicIcon from '@mui/icons-material/Mic'
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined'
import SendIcon from '@mui/icons-material/Send'
import { PALETA, hayPieza, servicio } from '@qillqa/tiqsi'
import DialogoReferencia, { type Referencia } from './DialogoReferencia'
import { grabadoraDisponible, MAX_NOTA_MS, useGrabadora } from './grabadora'
import type { Herramienta } from './HerramientasChat'
import MenuMas, { type OpcionMas } from './MenuMas'
import { avisoPegado, duracionLegible, esImagenAnotable, filtrarEquipo, imagenesDeTransferencia, insertarMencion, mencionEnCurso, nombreEntidad, type PersonaEquipo } from './mensajes'
import EditorImagen from './EditorImagen'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import CloseIcon from '@mui/icons-material/Close'

export interface Envio {
  texto: string
  entidad: string
  archivos: { referencia: string; nombre: string }[]
}

export interface Subida {
  /** 0..1 de lo mandado. */
  progreso: number
  /** «Subiendo 2 archivos…». */
  texto: string
}

interface Props {
  equipo: PersonaEquipo[]
  alEnviar: (e: Envio) => Promise<void>
  /** Archivos del dispositivo: se suben al instante (quien llama hace el POST multipart). Una
   *  nota de voz llega como un archivo con su `duracion_ms`. */
  alSubir?: (archivos: File[], extra?: { duracion_ms?: number; texto?: string }) => Promise<void>
  /** Encuesta, tarea o actividad de agenda (del «+»): las atiende quien usa la caja. */
  alHerramienta?: (que: Herramienta, ancla: HTMLElement) => void
  /** La subida en curso, para pintar el avance. */
  subida?: Subida | null
  alEscribir?: () => void
  /** Al tomar el foco (el celular abre el teclado): la conversación se pega al último mensaje. */
  alEnfocar?: () => void
  placeholder?: string
  autoFoco?: boolean
}

const BOTON_REDONDO = {
  mb: 0.25, width: 42, height: 42, bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.dark' },
  '&.Mui-disabled': { bgcolor: PALETA.superficieMedia, color: PALETA.apagado },
} as const

export default function CajaMensaje({ equipo, alEnviar, alSubir, alHerramienta, subida, alEscribir, alEnfocar, placeholder = 'Escriba un mensaje', autoFoco }: Props) {
  const [texto, setTexto] = useState('')
  const [adjuntos, setAdjuntos] = useState<Referencia[]>([])
  const [entidad, setEntidad] = useState<Referencia | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [mencion, setMencion] = useState<{ inicio: number; consulta: string } | null>(null)
  const [indice, setIndice] = useState(0)
  const [dialogo, setDialogo] = useState<'adjuntar' | 'vincular' | null>(null)
  const [menuMas, setMenuMas] = useState<HTMLElement | null>(null)
  const [nota, setNota] = useState('')
  // Imágenes pegadas, arrastradas o elegidas que ESPERAN (2026-10-18): se ven en una tira, se pueden
  // anotar (EditorImagen) o quitar, y salen con «Enviar» junto al texto como pie.
  const [pendientes, setPendientes] = useState<{ archivo: File; url: string }[]>([])
  const [editando, setEditando] = useState<number | null>(null)
  const grabadora = useGrabadora()
  const botonMas = useRef<HTMLButtonElement | null>(null)
  const campo = useRef<HTMLTextAreaElement | null>(null)
  const caja = useRef<HTMLDivElement | null>(null)
  const selector = useRef<HTMLInputElement | null>(null)
  const camara = useRef<HTMLInputElement | null>(null)
  const ultimoAviso = useRef(0)

  const candidatos = mencion ? filtrarEquipo(equipo, mencion.consulta) : []
  const popupAbierto = mencion !== null && candidatos.length > 0

  const revisarMencion = (valor: string, cursor: number) => {
    const m = mencionEnCurso(valor, cursor)
    setMencion(m)
    if (m) setIndice(0)
  }

  const cambiar = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const valor = e.target.value
    setTexto(valor)
    setError('')
    setNota('')
    revisarMencion(valor, e.target.selectionStart ?? valor.length)
    if (alEscribir && valor.trim() && Date.now() - ultimoAviso.current > 3000) {
      ultimoAviso.current = Date.now()
      alEscribir()
    }
  }

  const elegir = (cuenta: string) => {
    const el = campo.current
    const cursor = el?.selectionStart ?? texto.length
    const r = insertarMencion(texto, cursor, cuenta)
    setTexto(r.texto)
    setMencion(null)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(r.cursor, r.cursor)
    })
  }

  const agregarPendientes = (lista: File[]) => {
    if (lista.length === 0) return
    setPendientes((l) => [...l, ...lista.map((archivo) => ({ archivo, url: URL.createObjectURL(archivo) }))].slice(0, 10))
    setError('')
  }
  const quitarPendiente = (i: number) => setPendientes((l) => { URL.revokeObjectURL(l[i]?.url ?? ''); return l.filter((_, k) => k !== i) })
  useEffect(() => () => pendientes.forEach((p) => URL.revokeObjectURL(p.url)), []) // eslint-disable-line react-hooks/exhaustive-deps
  const alPegar = (e: React.ClipboardEvent) => {
    const imagenes = imagenesDeTransferencia(e.clipboardData?.files)
    if (imagenes.length === 0 || !alSubir) return
    e.preventDefault()
    agregarPendientes(imagenes)
  }
  const alSoltar = (e: React.DragEvent) => {
    if (!alSubir) return
    const todos = Array.from(e.dataTransfer?.files ?? [])
    if (todos.length === 0) return
    e.preventDefault()
    const imagenes = imagenesDeTransferencia(todos)
    agregarPendientes(imagenes)
    const otros = todos.filter((a) => !esImagenAnotable(a))
    if (otros.length) void subir(otros)
  }

  const enviar = async () => {
    const limpio = texto.trim()
    if ((!limpio && adjuntos.length === 0 && pendientes.length === 0) || enviando) return
    setEnviando(true)
    setError('')
    try {
      if (pendientes.length > 0 && alSubir) {
        // Las imágenes van en un mensaje con el texto como pie; lo enlazado (referencias), aparte.
        await alSubir(pendientes.map((p) => p.archivo), { texto: limpio })
        pendientes.forEach((p) => URL.revokeObjectURL(p.url))
        setPendientes([])
        if (adjuntos.length > 0) await alEnviar({ texto: '', entidad: entidad?.id ?? '', archivos: adjuntos.map((a) => ({ referencia: a.id, nombre: a.texto })) })
      } else {
        await alEnviar({ texto: limpio, entidad: entidad?.id ?? '', archivos: adjuntos.map((a) => ({ referencia: a.id, nombre: a.texto })) })
      }
      setTexto('')
      setAdjuntos([])
      setEntidad(null)
      setMencion(null)
      requestAnimationFrame(() => campo.current?.focus())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar.')
    } finally {
      setEnviando(false)
    }
  }

  const subir = async (lista: FileList | File[] | null) => {
    const todos = lista ? Array.from(lista) : []
    if (todos.length === 0 || !alSubir) return
    setError('')
    // Las imágenes esperan en la tira (se pueden anotar antes); lo demás sube al instante, como siempre.
    const imagenes = imagenesDeTransferencia(todos)
    agregarPendientes(imagenes)
    const archivos = todos.filter((a) => !esImagenAnotable(a))
    if (archivos.length === 0) return
    try {
      await alSubir(archivos)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo subir.')
    }
  }

  // --- nota de voz ------------------------------------------------------------------------------
  const grabando = grabadora.estado !== 'inactiva'
  const grabar = async () => {
    setError('')
    setNota('')
    try {
      await grabadora.empezar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el micrófono.')
    }
  }
  const enviarNota = async () => {
    const n = await grabadora.terminar()
    if (!n) {
      setNota('La nota fue muy corta; toque el micrófono y hable.')
      return
    }
    if (!alSubir) return
    try {
      await alSubir([n.archivo], { duracion_ms: n.duracion_ms })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar la nota de voz.')
    }
  }
  // Al llegar al máximo, se envía sola.
  useEffect(() => {
    if (grabadora.estado === 'grabando' && grabadora.ms >= MAX_NOTA_MS) void enviarNota()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grabadora.ms, grabadora.estado])

  // --- el «+» ----------------------------------------------------------------------------------
  const pegarPrompt = async () => {
    // Si el navegador deja leer el portapapeles, se pega solo; si no, basta pegarlo a mano.
    let pegado = ''
    try {
      pegado = (await navigator.clipboard?.readText?.()) ?? ''
    } catch {
      pegado = ''
    }
    if (pegado.trim()) {
      setTexto((t) => (t.trim() ? `${t}\n\n${pegado}` : pegado))
      setNota('')
    } else {
      setNota('Pegue aquí el resultado (mantener pulsado → Pegar): el chat lo reconoce.')
    }
    requestAnimationFrame(() => campo.current?.focus())
  }
  const elegirMas = (o: OpcionMas) => {
    if (o === 'archivo') selector.current?.click()
    else if (o === 'voz') void grabar()
    else if (o === 'prompt') void pegarPrompt()
    else if (o === 'enlazar') setDialogo('adjuntar')
    else if (o === 'vincular') setDialogo('vincular')
    else if (alHerramienta && botonMas.current) alHerramienta(o, botonMas.current)
  }

  const teclas = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (popupAbierto) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setIndice((i) => (i + 1) % candidatos.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setIndice((i) => (i - 1 + candidatos.length) % candidatos.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        elegir(candidatos[indice].cuenta)
        return
      }
      if (e.key === 'Escape') {
        setMencion(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void enviar()
    }
  }

  const puedeEnviar = (texto.trim().length > 0 || adjuntos.length > 0 || pendientes.length > 0) && !enviando
  const subiendo = Boolean(subida)
  const conMicrofono = Boolean(alSubir) && grabadoraDisponible()
  const vacia = texto.trim().length === 0 && adjuntos.length === 0 && pendientes.length === 0
  const reconocido = useMemo(() => avisoPegado(texto), [texto])
  const visibles = useMemo(() => {
    // Lo que depende del anfitrión (Rimay R4): enlazar y vincular, con su buscador de referencias; tarea y agenda,
    // con los diálogos de Tareas y Agenda. Solo, el chat no los ofrece.
    const v = new Set<OpcionMas>(['prompt'])
    if (servicio('referencias.buscar')) ['enlazar', 'vincular'].forEach((x) => v.add(x as OpcionMas))
    if (alSubir) v.add('archivo')
    if (conMicrofono && !vacia) v.add('voz') // con la caja vacía, el micrófono ya está a la vista
    if (alHerramienta) v.add('encuesta')
    if (alHerramienta && hayPieza('tareas.DialogoTarea')) ['tarea', 'agenda'].forEach((x) => v.add(x as OpcionMas))
    return v
  }, [alSubir, conMicrofono, vacia, alHerramienta])

  return (
    <Box ref={caja} onDragOver={(e) => { if (alSubir && e.dataTransfer?.types.includes('Files')) e.preventDefault() }} onDrop={alSoltar} sx={{ bgcolor: 'background.paper', borderTop: '1px solid', borderColor: 'divider', px: { xs: 0.75, sm: 1.5 }, pt: 0.75, pb: { xs: 'max(6px, env(safe-area-inset-bottom))', sm: 1 }, flexShrink: 0 }}>
      {pendientes.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.75, mb: 0.75, px: 0.5, overflowX: 'auto', pb: 0.25 }} aria-label="Imágenes por enviar">
          {pendientes.map((p, i) => (
            <Box key={p.url} sx={{ position: 'relative', flex: '0 0 auto', width: 72, height: 72, borderRadius: 1.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider', bgcolor: PALETA.fondo }}>
              <Box component="img" src={p.url} alt={p.archivo.name} onClick={() => setEditando(i)} sx={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer', display: 'block' }} />
              <IconButton size="small" aria-label="Anotar la imagen" onClick={() => setEditando(i)} sx={{ position: 'absolute', left: 2, bottom: 2, p: 0.35, bgcolor: 'rgba(0,0,0,.55)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,.75)' } }}><EditOutlinedIcon sx={{ fontSize: 15 }} /></IconButton>
              <IconButton size="small" aria-label="Quitar la imagen" onClick={() => quitarPendiente(i)} sx={{ position: 'absolute', right: 2, top: 2, p: 0.35, bgcolor: 'rgba(0,0,0,.55)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,.75)' } }}><CloseIcon sx={{ fontSize: 15 }} /></IconButton>
            </Box>
          ))}
          <Typography variant="caption" sx={{ alignSelf: 'center', color: PALETA.textoTenue, pl: 0.5, flex: '0 0 auto' }}>{pendientes.length === 1 ? 'Toque para anotar · Enviar la manda' : `${pendientes.length} imágenes · toque una para anotar`}</Typography>
        </Box>
      )}
      {subida && (
        <Box sx={{ mb: 0.75, px: 0.5 }}>
          <Typography variant="caption" sx={{ color: PALETA.textoTenue }}>{subida.texto} {Math.round(subida.progreso * 100)} %</Typography>
          <LinearProgress variant="determinate" value={Math.round(subida.progreso * 100)} sx={{ borderRadius: 2, height: 4 }} />
        </Box>
      )}
      {reconocido && !grabando && (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75, px: 1, py: 0.5, borderRadius: 2, bgcolor: PALETA.guindaSuave, color: 'primary.main' }}>
          <FactCheckOutlinedIcon sx={{ fontSize: 17, flexShrink: 0 }} />
          <Typography variant="caption" sx={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3, minWidth: 0 }}>{reconocido.texto}</Typography>
        </Box>
      )}
      {(adjuntos.length > 0 || entidad) && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 0.75 }}>
          {entidad && (
            <Chip size="small" color="primary" variant="outlined" icon={<LinkIcon sx={{ fontSize: '16px !important' }} />} label={`${nombreEntidad(entidad.id)}: ${entidad.texto}`} onDelete={() => setEntidad(null)} sx={{ maxWidth: 320 }} />
          )}
          {adjuntos.map((a) => (
            <Chip key={a.id} size="small" icon={<LinkIcon sx={{ fontSize: '16px !important' }} />} label={a.texto} onDelete={() => setAdjuntos((l) => l.filter((x) => x.id !== a.id))} sx={{ maxWidth: 320 }} />
          ))}
        </Box>
      )}
      {grabando ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 1 }, minHeight: 46 }}>
          <Tooltip title="Descartar">
            <IconButton aria-label="Descartar la nota de voz" onClick={grabadora.cancelar} sx={{ color: PALETA.error }}><DeleteOutlineIcon /></IconButton>
          </Tooltip>
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderRadius: 3, bgcolor: PALETA.fondo }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: PALETA.error, flexShrink: 0, animation: 'latido 1.2s ease-in-out infinite', '@keyframes latido': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.25 } } }} />
            <Typography sx={{ fontSize: 15, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }} aria-live="off">{duracionLegible(grabadora.ms)}</Typography>
            <Typography noWrap sx={{ fontSize: 13.5, color: PALETA.textoTenue }}>{grabadora.estado === 'pidiendo' ? 'Abriendo el micrófono…' : 'Grabando nota de voz'}</Typography>
          </Box>
          <Tooltip title="Enviar la nota de voz">
            <span>
              <IconButton aria-label="Enviar la nota de voz" disabled={grabadora.estado !== 'grabando'} onClick={() => void enviarNota()} sx={BOTON_REDONDO}>
                <SendIcon sx={{ fontSize: 20, ml: 0.25 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      ) : (
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: { xs: 0.25, sm: 0.5 } }}>
        <Tooltip title="Adjuntar, encuesta, tarea…">
          <span>
            <IconButton ref={botonMas} aria-label="Más opciones para enviar" aria-haspopup="true" disabled={subiendo} onClick={(e) => setMenuMas(e.currentTarget)} sx={{ mb: 0.25, color: 'text.secondary' }}><AddIcon /></IconButton>
          </span>
        </Tooltip>
        {alSubir && (
          <Tooltip title="Cámara">
            <span>
              <IconButton aria-label="Cámara" disabled={subiendo} onClick={() => camara.current?.click()} sx={{ mb: 0.25, color: 'text.secondary', display: { xs: 'inline-flex', sm: 'none' } }}><PhotoCameraOutlinedIcon /></IconButton>
            </span>
          </Tooltip>
        )}
        <TextField
          multiline
          maxRows={6}
          fullWidth
          autoFocus={autoFoco}
          placeholder={placeholder}
          value={texto}
          inputRef={campo}
          onChange={cambiar}
          onKeyDown={teclas}
          onPaste={alPegar}
          onFocus={alEnfocar}
          onClick={(e) => revisarMencion(texto, (e.target as HTMLTextAreaElement).selectionStart ?? texto.length)}
          inputProps={{ 'aria-label': 'Mensaje', maxLength: 8000, enterKeyHint: 'send' }}
          sx={{ '& textarea': { fontSize: { xs: 16, md: 14.5 }, lineHeight: 1.45 }, '& .MuiOutlinedInput-root': { py: 0.9, px: 1.75, borderRadius: 3, bgcolor: PALETA.fondo, '& fieldset': { borderColor: 'transparent' }, '&:hover fieldset': { borderColor: PALETA.borde }, '&.Mui-focused fieldset': { borderWidth: 1 } } }}
        />
        {conMicrofono && vacia && !enviando ? (
          <Tooltip title="Grabar una nota de voz">
            <span>
              <IconButton aria-label="Grabar una nota de voz" disabled={subiendo} onClick={() => void grabar()} sx={BOTON_REDONDO}><MicIcon sx={{ fontSize: 22 }} /></IconButton>
            </span>
          </Tooltip>
        ) : (
          <Tooltip title="Enviar (Enter)">
            <span>
              <IconButton aria-label="Enviar" disabled={!puedeEnviar} onClick={() => void enviar()} sx={BOTON_REDONDO}>
                <SendIcon sx={{ fontSize: 20, ml: 0.25 }} />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Box>
      )}
      {error ? (
        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5, px: 0.5 }}>{error}</Typography>
      ) : nota ? (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, px: 0.5, color: PALETA.textoTenue }}>{nota}</Typography>
      ) : (
        <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' }, mt: 0.5, pl: 0.5 }}>Enter envía · Shift+Enter salta de línea · @ menciona · Ctrl+V pega una imagen</Typography>
      )}

      <input ref={selector} type="file" multiple hidden onChange={(e) => { void subir(e.target.files); e.target.value = '' }} />
      <input ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void subir(e.target.files); e.target.value = '' }} />

      <MenuMas ancla={menuMas} alCerrar={() => setMenuMas(null)} alElegir={elegirMas} visibles={visibles} />
      <EditorImagen
        archivo={editando !== null ? pendientes[editando]?.archivo ?? null : null}
        alCerrar={() => setEditando(null)}
        alGuardar={(nuevo) => {
          setPendientes((l) => l.map((p, k) => (k === editando ? (URL.revokeObjectURL(p.url), { archivo: nuevo, url: URL.createObjectURL(nuevo) }) : p)))
          setEditando(null)
        }}
      />

      <Popper open={popupAbierto} anchorEl={caja.current} placement="top-start" sx={{ zIndex: (t) => t.zIndex.modal }}>
        <Paper variant="outlined" sx={{ minWidth: 240, maxWidth: 360, boxShadow: PALETA.sombraFlotante }}>
          <MenuList dense>
            {candidatos.map((p, i) => (
              <MenuItem key={p.id} selected={i === indice} onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(p.cuenta)}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 14 }} noWrap>{p.nombre}</Typography>
                  <Typography variant="caption" sx={{ color: PALETA.textoTenue }} noWrap component="div">@{p.cuenta}{p.cargo ? ` · ${p.cargo}` : ''}</Typography>
                </Box>
              </MenuItem>
            ))}
          </MenuList>
        </Paper>
      </Popper>
      <DialogoReferencia
        abierto={dialogo !== null}
        titulo={dialogo === 'vincular' ? 'Vincular el mensaje' : 'Enlazar algo del sistema'}
        ayuda={dialogo === 'vincular' ? 'El mensaje queda ligado a un proyecto, documento, semana o recibido.' : 'Un documento, un recibido o cualquier cosa que ya está en el sistema.'}
        alCerrar={() => setDialogo(null)}
        alElegir={(r) => {
          if (dialogo === 'vincular') setEntidad(r)
          else setAdjuntos((l) => (l.some((x) => x.id === r.id) ? l : [...l, r]))
        }}
      />
    </Box>
  )
}
