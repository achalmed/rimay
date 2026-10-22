/**
 * El avatar de una persona en el chat (Rimay R4, 2026-10-20): la foto de perfil la da el anfitrión (la pieza
 * «personas.Avatar» de Qillqa); mientras llega, o si el anfitrión no la tiene (el chat solo), sus iniciales sobre su
 * color (`colorDePersona`), como siempre.
 */
import Avatar from '@mui/material/Avatar'
import type { SxProps, Theme } from '@mui/material/styles'
import { Pieza } from '@qillqa/tiqsi'
import { colorDePersona } from './mensajes'

/** «María Quispe Rojas» → MQ: nombre y primer apellido, no dos nombres. */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  const a = partes[0][0] ?? ''
  const b = partes.length >= 3 ? partes[partes.length - 2][0] : partes[1]?.[0] ?? ''
  return (a + b).toUpperCase()
}

type Props = { id: number | null | undefined; nombre: string; tamano?: number; sx?: SxProps<Theme> }

function Iniciales({ id, nombre, tamano = 36, sx }: Props) {
  return (
    <Avatar sx={[
      { width: tamano, height: tamano, fontSize: tamano * 0.38, bgcolor: colorDePersona(id ?? nombre), color: '#fff', fontWeight: 700 },
      ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
    ]}>
      {iniciales(nombre)}
    </Avatar>
  )
}

export default function AvatarPersona(props: Props) {
  return <Pieza pieza="personas.Avatar" {...props} respaldo={<Iniciales {...props} />} />
}
