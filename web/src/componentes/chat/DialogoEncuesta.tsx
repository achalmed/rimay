/**
 * NUEVA ENCUESTA (2026-10-12, fase 9.6): breve, como en WhatsApp. La pregunta, de 2 a 10
 * opciones (al escribir en la última aparece otra vacía) y dos interruptores: «Varias
 * respuestas» y «Anónima». En el celular ocupa la pantalla; Enviar la publica en el canal
 * (`POST /api/chat/canales/{id}/encuestas`, la hace quien llama con `alCrear`).
 */
import { useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import CloseIcon from '@mui/icons-material/Close'
import { opcionesValidas } from './mensajes'

export interface EncuestaNueva {
  pregunta: string
  opciones: string[]
  multiple: boolean
  anonima: boolean
}

interface Props {
  abierto: boolean
  alCerrar: () => void
  alCrear: (datos: EncuestaNueva) => Promise<void>
}

const MAX = 10
const CAMPO = { '& input': { fontSize: { xs: 16, md: 14.5 } } } as const

export default function DialogoEncuesta({ abierto, alCerrar, alCrear }: Props) {
  const tema = useTheme()
  const celular = useMediaQuery(tema.breakpoints.down('sm'))
  const [pregunta, setPregunta] = useState('')
  const [opciones, setOpciones] = useState<string[]>(['', ''])
  const [multiple, setMultiple] = useState(false)
  const [anonima, setAnonima] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const campos = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    if (!abierto) return
    setPregunta('')
    setOpciones(['', ''])
    setMultiple(false)
    setAnonima(false)
    setError('')
  }, [abierto])

  const cambiar = (i: number, v: string) => {
    setOpciones((l) => {
      const n = l.map((x, j) => (j === i ? v : x))
      // Al escribir en la última, aparece otra vacía (hasta diez).
      if (i === n.length - 1 && v.trim() && n.length < MAX) n.push('')
      return n
    })
  }
  const quitar = (i: number) => setOpciones((l) => (l.length > 2 ? l.filter((_, j) => j !== i) : l.map((x, j) => (j === i ? '' : x))))

  const validas = opcionesValidas(opciones)
  const repetidas = opciones.filter((o) => o.trim()).length > validas.length
  const lista = pregunta.trim().length > 0 && validas.length >= 2

  const enviar = async () => {
    if (!lista || enviando) return
    setEnviando(true)
    setError('')
    try {
      await alCrear({ pregunta: pregunta.trim(), opciones: validas, multiple, anonima })
      alCerrar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la encuesta.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open={abierto} onClose={alCerrar} fullWidth maxWidth="xs" fullScreen={celular} aria-labelledby="titulo-encuesta">
      <DialogTitle id="titulo-encuesta" sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1, py: 1.25 }}>
        <Box sx={{ flex: 1 }}>Nueva encuesta</Box>
        <IconButton onClick={alCerrar} aria-label="Cerrar"><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 2 }}>
        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
        <TextField
          label="Pregunta"
          value={pregunta}
          onChange={(e) => setPregunta(e.target.value)}
          autoFocus
          fullWidth
          multiline
          maxRows={3}
          inputProps={{ maxLength: 300 }}
          placeholder="¿Qué día nos reunimos?"
          sx={{ '& textarea': { fontSize: { xs: 16, md: 14.5 } } }}
        />
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.75 }}>Opciones (de 2 a 10)</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {opciones.map((o, i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <TextField
                  size="small"
                  fullWidth
                  value={o}
                  placeholder={`Opción ${i + 1}`}
                  inputRef={(el) => { campos.current[i] = el }}
                  onChange={(e) => cambiar(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      campos.current[i + 1]?.focus()
                    }
                  }}
                  inputProps={{ maxLength: 120, 'aria-label': `Opción ${i + 1}`, enterKeyHint: 'next' }}
                  sx={CAMPO}
                />
                {/* La vacía del final (la que espera la siguiente opción) no se quita. */}
                <IconButton size="small" aria-label={`Quitar la opción ${i + 1}`} onClick={() => quitar(i)} disabled={!o && (opciones.length <= 2 || i === opciones.length - 1)}
                  sx={{ visibility: o || (opciones.length > 2 && i !== opciones.length - 1) ? 'visible' : 'hidden' }}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
          </Box>
          {repetidas && <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>Las opciones repetidas cuentan una sola vez.</Typography>}
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <FormControlLabel control={<Switch checked={multiple} onChange={(e) => setMultiple(e.target.checked)} />} label={<Typography variant="body2">Varias respuestas</Typography>} />
          <FormControlLabel control={<Switch checked={anonima} onChange={(e) => setAnonima(e.target.checked)} />} label={<Typography variant="body2">Anónima <Typography component="span" variant="caption" color="text.secondary">— no se ve quién votó</Typography></Typography>} />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: { xs: 'max(8px, env(safe-area-inset-bottom))', sm: 1 } }}>
        <Button onClick={alCerrar}>Cancelar</Button>
        <Button variant="contained" disableElevation disabled={!lista || enviando} onClick={() => void enviar()}>{enviando ? 'Enviando…' : 'Enviar'}</Button>
      </DialogActions>
    </Dialog>
  )
}
