/**
 * ELEGIR UNA REFERENCIA del sistema para el chat (fase 8.3): lo mismo que encuentra el
 * buscador de citas (`GET /api/referencias/buscar`, el patrón de `tareas/SelectorVinculos.tsx`),
 * en grupos. Sirve para adjuntar (`entrada:12`, `doc:95`…) y para vincular el mensaje a una
 * entidad. Lo subido entra por la puerta de su módulo (Recibidos, Mediateca): aquí solo se
 * referencia lo que ya existe.
 */
import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import InputAdornment from '@mui/material/InputAdornment'
import LinearProgress from '@mui/material/LinearProgress'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import SearchIcon from '@mui/icons-material/Search'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import { PALETA } from '@qillqa/tiqsi'
import { buscarReferencias, prefijos } from './apoyo'

export interface Referencia {
  /** `doc:95`, `entrada:12`, `pl:3`… */
  id: string
  texto: string
}

interface Resultado {
  tipo: string
  id: string
  etiqueta: string
  detalle: string
  grupo: string
}

interface Props {
  abierto: boolean
  titulo: string
  ayuda: string
  alCerrar: () => void
  alElegir: (r: Referencia) => void
}

export default function DialogoReferencia({ abierto, titulo, ayuda, alCerrar, alElegir }: Props) {
  const tema = useTheme()
  const celular = useMediaQuery(tema.breakpoints.down('sm'))
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<(Resultado & { ref: string; grupoNombre: string })[]>([])
  const [buscando, setBuscando] = useState(false)
  const turno = useRef(0)

  useEffect(() => {
    if (!abierto) {
      setQ('')
      setResultados([])
    }
  }, [abierto])

  useEffect(() => {
    const texto = q.trim()
    if (texto.length < 2) {
      setResultados([])
      return
    }
    const mio = ++turno.current
    setBuscando(true)
    const t = window.setTimeout(() => {
      const { PREFIJO_REFERENCIA, NOMBRE_PREFIJO } = prefijos()
      buscarReferencias<Resultado>(texto, 'chat')
        .then((r) => {
          if (mio !== turno.current) return
          setResultados(
            r.filter((x) => PREFIJO_REFERENCIA[x.tipo]).map((x) => {
              const p = PREFIJO_REFERENCIA[x.tipo]
              return { ...x, ref: `${p}:${x.id}`, grupoNombre: NOMBRE_PREFIJO[p] ?? x.grupo }
            }),
          )
        })
        .catch(() => setResultados([]))
        .finally(() => mio === turno.current && setBuscando(false))
    }, 250)
    return () => window.clearTimeout(t)
  }, [q])

  let grupoAnterior = ''
  return (
    <Dialog open={abierto} onClose={alCerrar} fullWidth maxWidth="xs" fullScreen={celular}>
      <DialogTitle>{titulo}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="caption" color="text.secondary">{ayuda}</Typography>
        <TextField
          autoFocus
          size="small"
          placeholder="Número, título o nombre"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          sx={{ '& input': { fontSize: { xs: 16, md: 14 } } }}
        />
        {buscando && <LinearProgress />}
        <Box sx={{ minHeight: 160, maxHeight: 380, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          {q.trim().length < 2 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>Escriba parte del número, título o nombre.</Typography>
          ) : !buscando && resultados.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>Sin resultados.</Typography>
          ) : (
            resultados.map((r) => {
              const cabecera = r.grupoNombre !== grupoAnterior
              grupoAnterior = r.grupoNombre
              return (
                <Box key={r.ref}>
                  {cabecera && <Typography variant="subtitle2" sx={{ px: 1.5, pt: 1, pb: 0.25 }}>{r.grupoNombre}</Typography>}
                  <ButtonBase onClick={() => { alElegir({ id: r.ref, texto: r.etiqueta }); alCerrar() }} sx={{ display: 'block', width: '100%', textAlign: 'left', px: 1.5, py: 0.75, '&:hover': { bgcolor: PALETA.superficieTenue } }}>
                    <Typography sx={{ fontSize: 14 }} noWrap>{r.etiqueta}</Typography>
                    {r.detalle && <Typography variant="caption" color="text.secondary" noWrap component="div">{r.detalle}</Typography>}
                  </ButtonBase>
                </Box>
              )
            })
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={alCerrar}>Cerrar</Button>
      </DialogActions>
    </Dialog>
  )
}
