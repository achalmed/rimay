/**
 * UNA ENCUESTA dentro de la burbuja (2026-10-12, fase 9.6), como en WhatsApp: la pregunta, cada
 * opción con su círculo (o casilla, si admite varias), su barra y su porcentaje, y debajo quién
 * la votó (si no es anónima). Tocar una opción la vota; tocar la propia, quita el voto; en una de
 * respuesta única, tocar otra cambia el voto (`servicios/chat.py::aplicar_voto`). Los resultados
 * llegan al día por el socket (`tipo: 'encuesta'`). Quien la creó o administra el canal la cierra.
 */
import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import CheckBoxIcon from '@mui/icons-material/CheckBox'
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import PollOutlinedIcon from '@mui/icons-material/PollOutlined'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import { PALETA, confirmar } from '@qillqa/tiqsi'
import { pieEncuesta, type Encuesta } from './mensajes'

interface Props {
  e: Encuesta
  /** La hora del mensaje, al pie (a la derecha). */
  hora: string
  puedeCerrar: boolean
  alVotar?: (opcion: number) => Promise<void>
  alCerrar?: () => Promise<void>
}

export default function VistaEncuesta({ e, hora, puedeCerrar, alVotar, alCerrar }: Props) {
  const [ocupada, setOcupada] = useState<number | 'cerrar' | null>(null)
  const votable = !e.cerrada && Boolean(alVotar)

  const votar = async (i: number) => {
    if (!votable || ocupada !== null || !alVotar) return
    setOcupada(i)
    try {
      await alVotar(i)
    } finally {
      setOcupada(null)
    }
  }

  const cerrar = async () => {
    if (!alCerrar || !(await confirmar('¿Cerrar la encuesta? Nadie podrá votar ni cambiar su voto.', { aceptar: 'Cerrar encuesta' }))) return
    setOcupada('cerrar')
    try {
      await alCerrar()
    } finally {
      setOcupada(null)
    }
  }

  return (
    <Box sx={{ width: { xs: 'min(100%, 300px)', sm: 320 }, maxWidth: '100%', pt: 0.25 }}>
      <Typography component="div" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 12, color: PALETA.textoTenue, mb: 0.25 }}>
        <PollOutlinedIcon sx={{ fontSize: 15 }} />
        {e.cerrada ? 'Encuesta cerrada' : e.multiple ? 'Encuesta · elija una o más' : 'Encuesta · elija una'}
      </Typography>
      <Typography component="div" sx={{ fontSize: { xs: 15.5, md: 14.5 }, fontWeight: 650, lineHeight: 1.35, overflowWrap: 'anywhere', mb: 0.75 }}>{e.pregunta}</Typography>
      <Box role="group" aria-label={`Opciones de «${e.pregunta}»`} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {e.opciones.map((o, i) => {
          const Icono = o.mia ? (e.multiple ? CheckBoxIcon : CheckCircleIcon) : e.multiple ? CheckBoxOutlineBlankIcon : RadioButtonUncheckedIcon
          const nombres = o.votantes.map((v) => v.nombre.split(' ')[0] || v.nombre).join(', ')
          return (
            <ButtonBase
              key={i}
              disabled={!votable || ocupada !== null}
              onClick={() => void votar(i)}
              aria-pressed={o.mia}
              aria-label={`${o.texto}: ${o.votos} ${o.votos === 1 ? 'voto' : 'votos'}${o.mia ? ', su voto' : ''}`}
              sx={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: 1.5, px: 0.5, py: 0.5, '&:hover': { bgcolor: votable ? PALETA.velo : undefined }, '&.Mui-disabled': { color: 'inherit' } }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                {ocupada === i ? (
                  <CircularProgress size={18} sx={{ m: '1px', flexShrink: 0 }} />
                ) : (
                  <Icono sx={{ fontSize: 20, flexShrink: 0, color: o.mia ? 'primary.main' : e.cerrada ? PALETA.apagado : PALETA.textoTenue }} />
                )}
                <Typography component="span" sx={{ flex: 1, minWidth: 0, fontSize: { xs: 15, md: 14 }, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{o.texto}</Typography>
                <Typography component="span" sx={{ fontSize: 12.5, fontWeight: 700, color: o.mia ? 'primary.main' : PALETA.textoTenue, flexShrink: 0, minWidth: 34, textAlign: 'right' }}>{o.porcentaje} %</Typography>
              </Box>
              <Box sx={{ ml: '26px', mt: 0.5, height: 6, borderRadius: 3, bgcolor: PALETA.veloMedio, overflow: 'hidden' }}>
                <Box sx={{ width: `${Math.min(100, o.porcentaje)}%`, height: '100%', borderRadius: 3, bgcolor: o.mia ? 'primary.main' : PALETA.doradoLinea, transition: 'width .25s' }} />
              </Box>
              {o.votos > 0 && (
                <Typography component="div" sx={{ ml: '26px', mt: 0.25, fontSize: 11.5, color: PALETA.textoTenue, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {e.anonima ? `${o.votos} ${o.votos === 1 ? 'voto' : 'votos'}` : nombres}
                </Typography>
              )}
            </ButtonBase>
          )
        })}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
        <Typography component="span" sx={{ flex: 1, minWidth: 0, fontSize: 11.5, color: PALETA.textoTenue }}>{pieEncuesta(e)}</Typography>
        {puedeCerrar && !e.cerrada && alCerrar && (
          <Button size="small" disabled={ocupada !== null} onClick={() => void cerrar()} sx={{ py: 0, minHeight: 24, fontSize: 12, textTransform: 'none' }}>
            {ocupada === 'cerrar' ? 'Cerrando…' : 'Cerrar'}
          </Button>
        )}
        <Typography component="span" sx={{ fontSize: 11, color: PALETA.textoTenue, whiteSpace: 'nowrap' }}>{hora}</Typography>
      </Box>
    </Box>
  )
}
