/**
 * EL AVATAR DE UN CANAL (2026-10-12, fase 9.4), en la lista y en la cabecera: en un directo,
 * la foto de perfil de la otra persona o, sin foto, sus iniciales sobre su color
 * (`AvatarPersona`, con el id leído de la `clave` `u:a-u:b`); en un grupo o un tema, el icono
 * en un círculo tenue.
 */
import Avatar from '@mui/material/Avatar'
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined'
import TagIcon from '@mui/icons-material/Tag'
import { PALETA } from '@qillqa/tiqsi'
import AvatarPersona from './Avatar'
import { otroDelDirecto, type Canal } from './mensajes'

export default function AvatarCanal({ canal, miId, tamano = 36 }: { canal: Canal; miId: number | null; tamano?: number }) {
  if (canal.clase === 'directo') {
    const otro = otroDelDirecto(canal.clave, miId)
    return <AvatarPersona id={otro} nombre={canal.nombre} tamano={tamano} />
  }
  return (
    <Avatar sx={{ width: tamano, height: tamano, bgcolor: canal.clase === 'grupo' ? PALETA.superficieMedia : PALETA.guindaSuave, color: 'primary.main' }}>
      {canal.clase === 'grupo' ? <GroupOutlinedIcon sx={{ fontSize: tamano * 0.52 }} /> : <TagIcon sx={{ fontSize: tamano * 0.52 }} />}
    </Avatar>
  )
}
