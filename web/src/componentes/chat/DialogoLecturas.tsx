/**
 * INFO DEL MENSAJE (2026-10-13): quién lo leyó, a quién solo le llegó y a quién todavía no, como
 * «Info» de WhatsApp. Se abre con la pulsación larga sobre un mensaje propio («Info»). Los datos
 * son las lecturas del canal (`entrega.ts::detalleLecturas`), al día por el socket.
 */
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import { PALETA } from '@qillqa/tiqsi'
import AvatarPersona from './Avatar'
import { MarcaEntrega } from './Burbuja'
import { detalleLecturas, type EstadoEntrega, type Lectura } from './entrega'
import { fragmento, horaDe, type Mensaje, type PersonaEquipo } from './mensajes'

interface Props {
  m: Mensaje | null
  lecturas: Lectura[]
  miId: number | null
  equipo: PersonaEquipo[]
  alCerrar: () => void
}

export default function DialogoLecturas({ m, lecturas, miId, equipo, alCerrar }: Props) {
  const d = m ? detalleLecturas(m.id, lecturas, miId) : { leyeron: [], recibieron: [], faltan: [] }
  const nombre = (l: Lectura) => l.nombre || equipo.find((p) => p.id === l.usuario_id)?.nombre || 'Alguien del equipo'
  const grupo = (titulo: string, lista: Lectura[], estado: EstadoEntrega, vacio: string) => (
    <Box sx={{ mb: 1.5 }}>
      <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: PALETA.textoTenue, display: 'flex', alignItems: 'center', gap: 0.25, mb: 0.25 }}>
        <MarcaEntrega estado={estado} />&nbsp;{titulo} · {lista.length}
      </Typography>
      {lista.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ pl: 0.5 }}>{vacio}</Typography>
      ) : (
        lista.map((l) => (
          <Box key={l.usuario_id} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 0.5 }}>
            <AvatarPersona id={l.usuario_id} nombre={nombre(l)} tamano={30} />
            <Typography sx={{ fontSize: 14 }} noWrap>{nombre(l)}</Typography>
          </Box>
        ))
      )}
    </Box>
  )
  return (
    <Dialog open={Boolean(m)} onClose={alCerrar} fullWidth maxWidth="xs">
      <DialogTitle sx={{ pb: 0.5 }}>Info del mensaje</DialogTitle>
      <DialogContent>
        {m && (
          <Typography variant="body2" sx={{ bgcolor: PALETA.guindaSuave, borderRadius: 2, px: 1.25, py: 0.75, mb: 1.5 }}>
            {fragmento(m.texto || m.archivos[0]?.nombre || '', 140)} <Box component="span" sx={{ color: PALETA.textoTenue, fontSize: 11 }}>{horaDe(m.creado_en)}</Box>
          </Typography>
        )}
        {grupo('Leído por', d.leyeron, 'leido', 'Nadie todavía.')}
        {grupo('Recibido, sin leer', d.recibieron, 'recibido', 'Nadie.')}
        {d.faltan.length > 0 && grupo('Aún no le llega', d.faltan, 'enviado', '')}
      </DialogContent>
      <DialogActions>
        <Button onClick={alCerrar}>Cerrar</Button>
      </DialogActions>
    </Dialog>
  )
}
