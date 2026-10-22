/**
 * Mensajes escritos sin servidor que esperan para enviarse (2026-10-13). Van en la cola de
 * sinconexion.ts y salen solos al volver la conexión (FranjaSinConexion); mientras tanto se ven al
 * final de la conversación, a la derecha y atenuados, con «En espera». Al enviarse desaparecen de
 * aquí y llegan como mensajes de verdad por el sondeo o el socket.
 */
import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import ScheduleIcon from '@mui/icons-material/Schedule'
import { alCambiarCola, mensajesEnEspera, type CambioPendiente } from './apoyo'
import { PALETA } from '@qillqa/tiqsi'

const textoDe = (c: CambioPendiente): string => {
  try {
    return String((JSON.parse(c.cuerpo) as { texto?: string }).texto ?? '')
  } catch {
    return ''
  }
}

export default function EnEspera({ ruta }: { ruta: string }) {
  const [lista, setLista] = useState(() => mensajesEnEspera(ruta))
  useEffect(() => {
    setLista(mensajesEnEspera(ruta))
    return alCambiarCola(() => setLista(mensajesEnEspera(ruta)))
  }, [ruta])
  if (lista.length === 0) return null
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, px: 2, pb: 1, flexShrink: 0, maxHeight: '30dvh', overflowY: 'auto' }}>
      {lista.map((c) => (
        <Box key={c.id} sx={{ maxWidth: '80%', px: 1.5, py: 0.75, borderRadius: '14px 14px 4px 14px', bgcolor: PALETA.guindaSuave, color: PALETA.texto, opacity: 0.75, fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {textoDe(c)}
          <Box component="span" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5, mt: 0.25, fontSize: 11, color: PALETA.textoTenue }}>
            <ScheduleIcon sx={{ fontSize: 12 }} /> En espera · se enviará al volver la conexión
          </Box>
        </Box>
      ))}
    </Box>
  )
}
