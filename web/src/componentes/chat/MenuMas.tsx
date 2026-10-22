/**
 * EL «+» DE LA CAJA (2026-10-12, fase 9.6): todo lo que se puede mandar además de texto. En el
 * celular es una hoja inferior con filas altas para el pulgar (como WhatsApp en Android); en
 * escritorio, un menú anclado al botón. Cada fila dice en una línea qué hace; «Pegar resultado
 * de un prompt» aclara que basta pegarlo en la caja (el chat lo reconoce solo). La hoja y el
 * círculo de color son los de HojaInferior: los mismos del botón flotante de cada módulo.
 */
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import ContentPasteOutlinedIcon from '@mui/icons-material/ContentPasteOutlined'
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import LinkIcon from '@mui/icons-material/Link'
import MicNoneOutlinedIcon from '@mui/icons-material/MicNoneOutlined'
import PollOutlinedIcon from '@mui/icons-material/PollOutlined'
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined'
import { PALETA } from '@qillqa/tiqsi'
import { Circulo, HojaInferior } from '@qillqa/tiqsi/estilo'

export type OpcionMas = 'archivo' | 'voz' | 'encuesta' | 'tarea' | 'agenda' | 'prompt' | 'enlazar' | 'vincular'

interface Fila {
  clave: OpcionMas
  texto: string
  ayuda: string
  icono: JSX.Element
  color: string
}

interface Props {
  ancla: HTMLElement | null
  alCerrar: () => void
  alElegir: (o: OpcionMas) => void
  /** Qué filas mostrar (las demás no aplican aquí: sin subida, sin micrófono a la vista…). */
  visibles: ReadonlySet<OpcionMas>
}

// Colores de la marca y de apoyo (paleta.ts), oscuros y sin naranja.
const FILAS: Fila[] = [
  { clave: 'archivo', texto: 'Foto o archivo', ayuda: 'Del dispositivo; se envía al instante', icono: <InsertDriveFileOutlinedIcon />, color: PALETA.guinda },
  { clave: 'voz', texto: 'Nota de voz', ayuda: 'Grabar y enviar', icono: <MicNoneOutlinedIcon />, color: PALETA.guinda },
  { clave: 'encuesta', texto: 'Encuesta', ayuda: 'Una pregunta con opciones; se vota aquí', icono: <PollOutlinedIcon />, color: PALETA.dorado },
  { clave: 'tarea', texto: 'Tarea', ayuda: 'A mano o con el resultado del prompt', icono: <TaskAltOutlinedIcon />, color: PALETA.guinda },
  { clave: 'agenda', texto: 'Actividad de agenda', ayuda: 'A mano o con el resultado del prompt', icono: <EventOutlinedIcon />, color: PALETA.dorado },
  { clave: 'prompt', texto: 'Pegar resultado de un prompt', ayuda: 'Basta pegarlo en la caja: el chat lo reconoce', icono: <ContentPasteOutlinedIcon />, color: PALETA.dorado },
  { clave: 'enlazar', texto: 'Enlazar algo del sistema', ayuda: 'Un documento, un recibido, una semana…', icono: <LinkIcon />, color: PALETA.textoTenue },
  { clave: 'vincular', texto: 'Vincular el mensaje', ayuda: 'Queda ligado a un proyecto, documento o semana', icono: <LinkIcon sx={{ opacity: 0.7 }} />, color: PALETA.textoTenue },
]

export default function MenuMas({ ancla, alCerrar, alElegir, visibles }: Props) {
  const tema = useTheme()
  const celular = useMediaQuery(tema.breakpoints.down('sm'))
  const filas = FILAS.filter((f) => visibles.has(f.clave))
  const elegir = (o: OpcionMas) => () => {
    alCerrar()
    alElegir(o)
  }
  const separar = (f: Fila, i: number) => f.clave === 'enlazar' && i > 0

  if (celular) {
    return (
      <HojaInferior abierta={Boolean(ancla)} alCerrar={alCerrar}>
        <List sx={{ py: 0.5 }}>
          {filas.map((f, i) => (
            <Box key={f.clave}>
              {separar(f, i) && <Divider sx={{ my: 0.5 }} />}
              <ListItemButton onClick={elegir(f.clave)} sx={{ py: 0.9, gap: 0.5 }}>
                <ListItemIcon sx={{ minWidth: 48 }}><Circulo color={f.color}>{f.icono}</Circulo></ListItemIcon>
                <ListItemText primary={f.texto} secondary={f.ayuda} primaryTypographyProps={{ fontSize: 15.5, fontWeight: 600 }} secondaryTypographyProps={{ fontSize: 12.5, noWrap: true }} sx={{ minWidth: 0, my: 0 }} />
              </ListItemButton>
            </Box>
          ))}
        </List>
      </HojaInferior>
    )
  }

  return (
    <Menu anchorEl={ancla} open={Boolean(ancla)} onClose={alCerrar} anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{ paper: { sx: { borderRadius: 2.5, minWidth: 300 } } }}>
      {filas.map((f, i) => [
        separar(f, i) ? <Divider key={`sep-${f.clave}`} sx={{ my: 0.5 }} /> : null,
        <MenuItem key={f.clave} onClick={elegir(f.clave)} sx={{ py: 0.6, gap: 0.5 }}>
          <ListItemIcon sx={{ minWidth: 44 }}><Circulo color={f.color}>{f.icono}</Circulo></ListItemIcon>
          <ListItemText primary={f.texto} secondary={f.ayuda} primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }} secondaryTypographyProps={{ fontSize: 12 }} sx={{ my: 0 }} />
        </MenuItem>,
      ])}
    </Menu>
  )
}
