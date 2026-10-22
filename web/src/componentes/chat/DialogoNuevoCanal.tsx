/**
 * NUEVA CONVERSACIÓN (fase 8.3): un directo con alguien del equipo (`POST /api/chat/directo/{id}`,
 * se reutiliza si ya existe), un grupo privado con sus integrantes o, solo para quien
 * administra, un tema abierto a todo el equipo (`POST /api/chat/canales`). Los contactos van
 * por orden alfabético con buscador arriba y avatar en el color de cada persona (fase 9.4).
 * Un tema elige su sección de la lista (2026-10-13): una de las de siempre o una nueva («Bancada»,
 * «Radio»…), así lo propio del despacho se crea aquí, como dato, sin tocar el código.
 */
import { useEffect, useState } from 'react'
import Autocomplete from '@mui/material/Autocomplete'
import Badge from '@mui/material/Badge'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import { api, PALETA } from '@qillqa/tiqsi'
import AvatarPersona from './Avatar'
import { ordenarPorNombre, type Canal, type ClaseCanal, type PersonaEquipo } from './mensajes'
import { ORDEN_CATEGORIAS } from './entrega'

interface Props {
  abierto: boolean
  equipo: PersonaEquipo[]
  esAdmin: boolean
  alCerrar: () => void
  alCrear: (canal: Canal) => void
}

const completar = (c: Partial<Canal> & { id: number; clase: ClaseCanal; nombre: string }): Canal => ({
  descripcion: '', entidad: '', padre_id: null, visibilidad: c.clase === 'tema' ? 'equipo' : 'privado', clave: '', archivado: false,
  miembro: true, papel: 'admin', no_leidos: 0, ultimo: null, ...c,
})

export default function DialogoNuevoCanal({ abierto, equipo, esAdmin, alCerrar, alCrear }: Props) {
  const tema = useTheme()
  const celular = useMediaQuery(tema.breakpoints.down('sm'))
  const [clase, setClase] = useState<ClaseCanal>('directo')
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [categoria, setCategoria] = useState('')
  const [miembros, setMiembros] = useState<PersonaEquipo[]>([])
  const [filtro, setFiltro] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!abierto) return
    setClase('directo')
    setNombre('')
    setDescripcion('')
    setCategoria('')
    setMiembros([])
    setFiltro('')
    setError('')
  }, [abierto])

  const crearDirecto = async (p: PersonaEquipo) => {
    setGuardando(true)
    setError('')
    try {
      const c = await api<Canal>(`/api/chat/directo/${p.id}`, { method: 'POST' })
      alCrear(completar({ ...c, nombre: c.nombre || p.nombre }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el directo.')
    } finally {
      setGuardando(false)
    }
  }

  const crearCanal = async () => {
    if (!nombre.trim()) return
    setGuardando(true)
    setError('')
    try {
      const c = await api<Canal>('/api/chat/canales', {
        method: 'POST',
        body: JSON.stringify({ clase, nombre: nombre.trim(), descripcion: descripcion.trim(), miembros: miembros.map((m) => m.id), categoria: clase === 'tema' ? categoria.trim() : '' }),
      })
      alCrear(completar(c))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la conversación.')
    } finally {
      setGuardando(false)
    }
  }

  const sinTildes = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const q = sinTildes(filtro.trim())
  const personas = ordenarPorNombre(equipo).filter((p) => !q || sinTildes(p.nombre).includes(q) || sinTildes(p.cuenta).includes(q) || sinTildes(p.cargo).includes(q))

  return (
    <Dialog open={abierto} onClose={alCerrar} fullWidth maxWidth="xs" fullScreen={celular}>
      <DialogTitle>Nueva conversación</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <ToggleButtonGroup exclusive size="small" value={clase} onChange={(_, v: ClaseCanal | null) => v && setClase(v)} fullWidth>
          <ToggleButton value="directo">Directo</ToggleButton>
          <ToggleButton value="grupo">Grupo</ToggleButton>
          {esAdmin && <ToggleButton value="tema">Tema</ToggleButton>}
        </ToggleButtonGroup>
        {clase === 'directo' ? (
          <>
            <TextField autoFocus size="small" placeholder="Buscar en el equipo" value={filtro} onChange={(e) => setFiltro(e.target.value)} inputProps={{ 'aria-label': 'Buscar en el equipo' }}
              sx={{ '& input': { fontSize: { xs: 16, md: 14 } }, '& .MuiOutlinedInput-root': { borderRadius: 999, bgcolor: PALETA.fondo, '& fieldset': { borderColor: 'transparent' }, '&.Mui-focused fieldset': { borderWidth: 1 } } }} />
            <Box sx={{ maxHeight: { xs: 'none', sm: 400 }, overflow: 'auto', borderRadius: 2 }}>
              {personas.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>Nadie coincide.</Typography>}
              {personas.map((p) => (
                <ButtonBase key={p.id} disabled={guardando} onClick={() => void crearDirecto(p)} sx={{ display: 'flex', width: '100%', textAlign: 'left', gap: 1.5, px: 1, py: 0.9, borderRadius: 2, '&:hover': { bgcolor: PALETA.superficieTenue } }}>
                  <Badge overlap="circular" variant="dot" anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} invisible={!p.en_linea} sx={{ '& .MuiBadge-badge': { bgcolor: PALETA.exito, boxShadow: `0 0 0 2px ${PALETA.superficie}`, width: 10, height: 10, borderRadius: 5 } }}>
                    <AvatarPersona id={p.id} nombre={p.nombre} tamano={42} />
                  </Badge>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontSize: 15 }} noWrap>{p.nombre}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap component="div">{p.cargo || `@${p.cuenta}`}</Typography>
                  </Box>
                </ButtonBase>
              ))}
            </Box>
          </>
        ) : (
          <>
            <TextField autoFocus label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} inputProps={{ maxLength: 120 }} sx={{ '& input': { fontSize: { xs: 16, md: 14 } } }} />
            <TextField label="Descripción" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} multiline minRows={2} inputProps={{ maxLength: 2000 }} sx={{ '& textarea': { fontSize: { xs: 16, md: 14 } } }} />
            {clase === 'grupo' ? (
              <Autocomplete
                multiple
                options={equipo}
                value={miembros}
                onChange={(_, v) => setMiembros(v)}
                getOptionLabel={(p) => p.nombre}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                renderInput={(params) => <TextField {...params} label="Integrantes" placeholder={miembros.length ? '' : 'Quiénes entran'} />}
                noOptionsText="Nadie coincide"
              />
            ) : (
              <>
                <Autocomplete
                  freeSolo
                  options={[...ORDEN_CATEGORIAS]}
                  value={categoria}
                  onInputChange={(_, v) => setCategoria(v.slice(0, 30))}
                  renderInput={(params) => <TextField {...params} label="Sección de la lista" placeholder="Documentos, Agenda… o una nueva" />}
                />
                <Typography variant="caption" color="text.secondary">Un tema lo ve todo el equipo.</Typography>
              </>
            )}
          </>
        )}
        {error && <Typography variant="body2" color="error">{error}</Typography>}
      </DialogContent>
      <DialogActions>
        <Button onClick={alCerrar}>Cancelar</Button>
        {clase !== 'directo' && (
          <Button variant="contained" disabled={!nombre.trim() || guardando} onClick={() => void crearCanal()}>Crear</Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
