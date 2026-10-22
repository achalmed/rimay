/**
 * LO QUE ABRE EL «+» DE LA CAJA (2026-10-12, fase 9.6), fuera de la caja para no cargarla: la
 * encuesta (su diálogo y el `POST /canales/{id}/encuestas`) y la entrada doble de Tarea y de
 * Actividad de agenda (`ElegirEntrada`: llenar el formulario o desde el resultado del prompt,
 * con copiar o bajar el prompt). Lo manual reusa los diálogos de siempre (`DialogoTarea`,
 * `DialogoEvento`); el resultado del prompt se pega aquí mismo («Pegar actividades»,
 * `DialogoPegarTareas`). Si el canal es el de una entidad (`pl:3`, `doc:95`…), lo creado
 * nace vinculado a ella (el modelo de tareas no vincula canales ni mensajes).
 *
 * «Registrar en Tareas» bajo un plan de tareas pegado (`accion: 'pegar_tareas'`) llega aquí como
 * pedido con el texto del mensaje y abre «Pegar tareas» ya leído.
 *
 * Al crear, el sistema deja la tarjeta en el canal (`POST /canales/{id}/anunciar`: «Tarea
 * creada: … · vence …» con «Abrir»), como los demás mensajes automáticos.
 */
import { useEffect, useState } from 'react'
import { api, ElegirEntrada, Pieza } from '@qillqa/tiqsi'
import { isoDia, type Vinculo } from './apoyo'
import DialogoEncuesta, { type EncuestaNueva } from './DialogoEncuesta'
import type { Canal, Mensaje } from './mensajes'

export type Herramienta = 'encuesta' | 'tarea' | 'agenda' | 'pegar_tareas'

interface Props {
  canal: Canal
  /** En un hilo, lo creado se anuncia en el hilo. */
  padreId: number | null
  /** Lo que se eligió en el «+» (y el botón, para anclar el menú en escritorio); `pegar_tareas` trae el texto. */
  pedido: { que: Herramienta; ancla: HTMLElement | null; texto?: string; mensajeId?: number } | null
  alAtender: () => void
  /** Un mensaje nuevo que publicó esta acción (se funde ya, sin esperar al socket). */
  alPublicado: (m: Mensaje) => void
  alAviso: (texto: string, tipo: 'success' | 'error' | 'info') => void
  /** Se registraron las tareas de un plan pegado (la acción «Registrar en Tareas» ya cumplió). */
  alTareasRegistradas?: () => void
}

// Los mismos prefijos que `servicios/tareas_reglas.py::PREFIJOS_VINCULO`.
const VINCULABLE = /^(doc|pl|sr|persona|inst|foto|pedido|evento|tarea|entrada):\d{1,9}$/

export default function HerramientasChat({ canal, padreId, pedido, alAtender, alPublicado, alAviso, alTareasRegistradas }: Props) {
  const [encuesta, setEncuesta] = useState(false)
  const [entrada, setEntrada] = useState<{ tipo: 'tarea' | 'agenda'; ancla: HTMLElement } | null>(null)
  const [tarea, setTarea] = useState(false)
  const [evento, setEvento] = useState(false)
  const [pegarAgenda, setPegarAgenda] = useState(false)
  const [pegarTareas, setPegarTareas] = useState(false)
  const [textoTareas, setTextoTareas] = useState('')
  const [deMensaje, setDeMensaje] = useState<number | null>(null)
  // Cada apertura monta el diálogo de nuevo: el texto inicial se vuelve a leer aunque sea el mismo.
  const [apertura, setApertura] = useState(0)

  useEffect(() => {
    if (!pedido) return
    if (pedido.que === 'encuesta') setEncuesta(true)
    else if (pedido.que === 'pegar_tareas') {
      setTextoTareas(pedido.texto ?? '')
      setDeMensaje(pedido.mensajeId ?? null)
      setApertura((n) => n + 1)
      setPegarTareas(true)
    } else if (pedido.ancla) setEntrada({ tipo: pedido.que, ancla: pedido.ancla })
    alAtender()
  }, [pedido, alAtender])

  const vinculos: Vinculo[] = VINCULABLE.test(canal.entidad) ? [{ id: canal.entidad, texto: canal.nombre || canal.entidad }] : []

  const crearEncuesta = async (d: EncuestaNueva) => {
    const m = await api<Mensaje>(`/api/chat/canales/${canal.id}/encuestas`, { method: 'POST', body: JSON.stringify({ ...d, padre_id: padreId }) })
    alPublicado(m)
  }

  const anunciar = async (entidad: string, de?: number | null) => {
    try {
      const m = await api<Mensaje>(`/api/chat/canales/${canal.id}/anunciar`, { method: 'POST', body: JSON.stringify({ entidad, padre_id: padreId, de_mensaje: de ?? null }) })
      alPublicado(m)
    } catch (e) {
      alAviso(`Se creó, pero no se pudo avisar en el chat: ${e instanceof Error ? e.message : 'error'}`, 'error')
    }
  }

  return (
    <>
      <DialogoEncuesta abierto={encuesta} alCerrar={() => setEncuesta(false)} alCrear={crearEncuesta} />
      <ElegirEntrada
        ancla={entrada?.ancla ?? null}
        alCerrar={() => setEntrada(null)}
        tipo={entrada?.tipo === 'agenda' ? 'agenda-actividades' : 'plan-de-tareas'}
        alManual={() => (entrada?.tipo === 'agenda' ? setEvento(true) : setTarea(true))}
        alPrompt={() => {
          if (entrada?.tipo === 'agenda') return setPegarAgenda(true)
          setTextoTareas('')
          setDeMensaje(null)
          setApertura((n) => n + 1)
          setPegarTareas(true)
        }}
      />
      {/* Los diálogos de Tareas y Agenda los da el anfitrión (piezas «tareas.*», Rimay R4); solo, no están. */}
      <Pieza pieza="tareas.DialogoTarea"
        abierto={tarea}
        inicial={{ vinculos }}
        alCerrar={() => setTarea(false)}
        alGuardar={(t: { id: number }) => void anunciar(`tarea:${t.id}`)}
      />
      <Pieza pieza="tareas.DialogoEvento"
        abierto={evento}
        inicial={{ fecha: isoDia(new Date()), vinculos }}
        alCerrar={() => setEvento(false)}
        alCrear={(id: number) => void anunciar(`evento:${id}`)}
      />
      <Pieza pieza="tareas.DialogoPegarTareas"
        key={apertura}
        abierto={pegarTareas}
        textoInicial={textoTareas || undefined}
        vinculo={vinculos[0]?.id}
        alCerrar={() => setPegarTareas(false)}
        alRegistrado={(ids: number[]) => {
          ids.forEach((id) => void anunciar(`tarea:${id}`, deMensaje))
          if (textoTareas) alTareasRegistradas?.()
        }}
      />
      <Pieza pieza="tareas.DialogoPegarAgenda"
        abierto={pegarAgenda}
        vinculos={vinculos.map((v) => v.id)}
        alCerrar={() => setPegarAgenda(false)}
        alCrear={(id: number) => void anunciar(`evento:${id}`)}
      />
    </>
  )
}
