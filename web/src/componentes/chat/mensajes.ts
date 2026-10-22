/**
 * CHAT — lógica PURA del módulo (fase 8.3, 2026-10-12): los tipos del contrato de
 * `backend/app/api/chat.py` (`mensaje_dict`, `canal_dict`, `canales_de`), agrupar mensajes por
 * día con el rótulo del separador («Hoy», «Ayer», «lun 12/10»), la hora, las menciones
 * `@cuenta`, el id de la sesión leído del JWT, las secciones de la lista de canales y la
 * fusión de lo que llega por el socket. Sin React ni API: `node --test pruebas/chat.test.ts`
 * lo carga sin bundler, así que no importa nada de `src/`.
 *
 * Todo se calcula con la hora LOCAL del navegador (la del despacho): un día es AAAA-MM-DD
 * local, nunca `toISOString()`.
 */

export type ClaseCanal = 'directo' | 'grupo' | 'tema'

export interface UltimoMensaje {
  id?: number
  autor_id?: number | null
  texto: string
  autor: string
  creado_en: string
}

export interface Canal {
  id: number
  clase: ClaseCanal
  nombre: string
  descripcion: string
  /** `pl:3`, `sr:2`, `doc:95`… cuando el canal es el de una entidad. */
  entidad: string
  /** Su nombre VIGENTE, resuelto por el servidor (servicios/etiquetas.py). */
  entidad_etiqueta?: string
  padre_id: number | null
  visibilidad: 'equipo' | 'privado'
  clave: string
  archivado: boolean
  creado_por?: number | null
  /** Sección de la lista para un tema (2026-10-13): «Documentos», «Agenda», «Legislativo»… ('' = Otros temas). */
  categoria?: string
  miembro: boolean
  papel: string
  no_leidos: number
  ultimo: UltimoMensaje | null
}

export interface Miembro {
  usuario_id: number
  nombre: string
  cuenta: string
  papel: string
  ultimo_leido_id: number | null
  /** Hasta dónde le llegó a un dispositivo (2026-10-13): el segundo ✓. */
  ultimo_recibido_id?: number | null
}

export interface PersonaEquipo {
  id: number
  nombre: string
  cuenta: string
  cargo: string
  en_linea: boolean
}

export interface Archivo {
  id?: number
  /** `entrada:12`, `foto:3`, `doc:95`: lo adjunto entra por la puerta de su módulo. */
  referencia: string
  archivo?: string
  nombre: string
  bytes?: number
  /** Nota de voz: duración medida al grabar o con ffprobe (fase 9.6). */
  duracion_ms?: number | null
}

/**
 * Un botón bajo un mensaje: abre una entidad (`entidad`), navega a una ruta (`ruta`), registra
 * el bloque pegado (`accion: 'registrar'` + `mensaje_id`) o mete el archivo subido en su
 * módulo (`archivo_a_recibidos` / `archivo_a_mediateca` + `archivo_id`).
 */
export interface Accion {
  texto: string
  entidad?: string
  ruta?: string
  /** `pegar_tareas` (fase 9.6): abre «Pegar tareas» en el chat con el texto de `mensaje_id`. */
  accion?: 'registrar' | 'archivo_a_recibidos' | 'archivo_a_mediateca' | 'pegar_tareas'
  mensaje_id?: number
  archivo_id?: number
}

export interface Reaccion {
  emoji: string
  n: number
  mia: boolean
}

/** Las mismas del backend (`servicios/chat.py::EMOJIS`): otra se rechaza con 422. */
export const EMOJIS = ['👍', '❤️', '👏', '✅', '👀', '😂', '🙏', '⚠️'] as const

export interface Mensaje {
  id: number
  canal_id: number
  /** Nulo: lo escribió el sistema (una regla de eventos). */
  autor_id: number | null
  autor: string
  padre_id: number | null
  /** Respuesta citada en la misma conversación (los directos, 2026-10-19): el id del mensaje citado. */
  responde_a_id?: number | null
  texto: string
  menciones: string[]
  entidad: string
  /** El nombre VIGENTE de `entidad` (número, asunto, nombre de hoy), resuelto por el servidor. */
  entidad_etiqueta?: string
  evento_sistema_id: number | null
  acciones: Accion[]
  respuestas: number
  editado_en: string | null
  eliminado: boolean
  creado_en: string | null
  archivos: Archivo[]
  /** No viaja en todas las cargas (el socket y el POST no lo traen): sin él, ninguna. */
  reacciones?: Reaccion[]
  /** Si el mensaje es una encuesta (fase 9.6): su texto es la pregunta. */
  encuesta?: Encuesta | null
  /** Tarjeta de un mensaje del sistema (2026-10-13; `servicios/chat.py::tarjeta_de`); vacía = texto llano. */
  tarjeta?: Tarjeta | Record<string, never>
}

/** Lo que el sistema publica, ordenado: qué pasó, el número o nombre, el asunto y los datos sueltos. */
export interface Tarjeta {
  que: string
  /** numerado · firmado · enviado · revision · observado · seguimiento · recibido · vencido · agenda · recordatorio · programacion · prensa · proyecto · tarea · evento */
  icono: string
  titulo: string
  detalle: string
  meta: string[]
  /** 'mensaje' (2026-10-18): el texto ya viene escrito como lo escribía el equipo en Telegram
   *  (`servicios/redaccion_chat.py`) y se pinta como la burbuja de una persona que firma `firma`. */
  estilo?: 'mensaje'
  firma?: string
  /** El sistema lo puso al día porque cambió la entidad (2026-10-18, `chat.refrescar_mensajes_de`): se
   *  muestra «· actualizado», no «editado» (nadie lo editó). */
  actualizado_en?: string
}

/** ¿El mensaje del sistema viene escrito como el de una persona (burbuja con firma, no tarjeta)? */
export const esMensajeHumano = (m: Pick<Mensaje, 'autor_id' | 'tarjeta'>): boolean =>
  m.autor_id === null && Boolean(m.tarjeta && 'estilo' in m.tarjeta && m.tarjeta.estilo === 'mensaje')

/** Una opción de la encuesta con su conteo (`servicios/chat.py::resumen_encuesta`). */
export interface OpcionEncuesta {
  texto: string
  votos: number
  /** Sobre quienes votaron (en una de varias respuestas la suma pasa de 100). */
  porcentaje: number
  mia: boolean
  /** Vacío si la encuesta es anónima. */
  votantes: { id: number; nombre: string }[]
}

export interface Encuesta {
  id: number
  mensaje_id: number
  pregunta: string
  multiple: boolean
  anonima: boolean
  cierra_en: string | null
  cerrada: boolean
  creado_por: number | null
  /** Cuántas personas votaron. */
  votantes: number
  opciones: OpcionEncuesta[]
}

const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const dos = (n: number): string => String(n).padStart(2, '0')

/** AAAA-MM-DD local de una fecha. */
export const claveDia = (d: Date): string => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`

export const hoyLocal = (): string => claveDia(new Date())

/** «Hoy», «Ayer», «lun 12/10» (y el año si no es el de hoy: «sáb 20/12/2025»). */
export function etiquetaDia(dia: string, hoy = hoyLocal()): string {
  if (dia === hoy) return 'Hoy'
  const [a, m, d] = dia.split('-').map(Number)
  const [ha, hm, hd] = hoy.split('-').map(Number)
  const fecha = new Date(a, m - 1, d)
  if (fecha.getTime() === new Date(ha, hm - 1, hd - 1).getTime()) return 'Ayer'
  const base = `${DIAS_CORTOS[fecha.getDay()]} ${dos(d)}/${dos(m)}`
  return a === ha ? base : `${base}/${a}`
}

/** Los mensajes (ya ordenados del más viejo al más nuevo) en bloques por día, cada uno con su rótulo. */
export function agruparPorDia<T extends { creado_en: string | null }>(
  mensajes: T[],
  hoy = hoyLocal(),
): { dia: string; etiqueta: string; mensajes: T[] }[] {
  const bloques: { dia: string; etiqueta: string; mensajes: T[] }[] = []
  for (const m of mensajes) {
    const dia = m.creado_en ? claveDia(new Date(m.creado_en)) : hoy
    const ultimo = bloques[bloques.length - 1]
    if (ultimo && ultimo.dia === dia) ultimo.mensajes.push(m)
    else bloques.push({ dia, etiqueta: etiquetaDia(dia, hoy), mensajes: [m] })
  }
  return bloques
}

/** «14:05» con la hora local; sin fecha, vacío. */
export const horaDe = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${dos(d.getHours())}:${dos(d.getMinutes())}`
}

/** Para la lista: la hora si fue hoy, «ayer», o «12/10». */
export function fechaCorta(iso: string | null, hoy = hoyLocal()): string {
  if (!iso) return ''
  const d = new Date(iso)
  const dia = claveDia(d)
  if (dia === hoy) return horaDe(iso)
  const rotulo = etiquetaDia(dia, hoy)
  return rotulo === 'Ayer' ? 'ayer' : rotulo.slice(4)
}

// La misma regla que `servicios/chat.py::_MENCION`: una @ pegada a una palabra o a un punto no
// es mención, y el punto final de la frase («hola @ana.») no es parte de la cuenta.
const MENCION = /(?<![\w.])@([A-Za-z0-9][A-Za-z0-9._-]{1,48})/g

/**
 * El texto partido en trozos: los que son una mención `@cuenta` van marcados. Con la lista de
 * cuentas del equipo, solo cuentan las que existen; sin ella, cualquier `@palabra`.
 */
export function trozosConMenciones(texto: string, cuentas?: Iterable<string>): { texto: string; mencion: boolean }[] {
  const conocidas = cuentas ? new Set([...cuentas].map((c) => c.toLowerCase())) : null
  const trozos: { texto: string; mencion: boolean }[] = []
  let desde = 0
  for (const m of texto.matchAll(MENCION)) {
    const inicio = m.index ?? 0
    const cuenta = m[1].replace(/\.+$/, '')
    if (conocidas && !conocidas.has(cuenta.toLowerCase())) continue
    if (inicio > desde) trozos.push({ texto: texto.slice(desde, inicio), mencion: false })
    trozos.push({ texto: `@${cuenta}`, mencion: true })
    desde = inicio + 1 + cuenta.length
  }
  if (desde < texto.length || trozos.length === 0) trozos.push({ texto: texto.slice(desde), mencion: false })
  return trozos
}

const NEGRITA = /(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g

// Una dirección web escrita en el mensaje: con esquema o empezando por «www.». Se corta en el espacio
// y en las comillas; la puntuación final («.», «,», «)»…) se devuelve al texto en `recortarEnlace`.
const ENLACE = /\b((?:https?:\/\/|www\.)[^\s<>"'“”«»]+)/gi

/** Un trozo del texto de un mensaje: mención, negrita o enlace (la dirección completa en `enlace`). */
export interface Trozo { texto: string; mencion: boolean; negrita: boolean; enlace?: string }

/** Separa la dirección de la puntuación que la sigue en la frase: «https://x.pe/a.» → la dirección y el
 *  punto. Un paréntesis de cierre se queda si la dirección abrió uno (Wikipedia). */
export function recortarEnlace(crudo: string): { url: string; resto: string } {
  let url = crudo
  let resto = ''
  for (;;) {
    const ultimo = url.slice(-1)
    if (/[.,;:!?»"'’]/.test(ultimo) || (ultimo === ')' && !url.includes('(')) || (ultimo === ']' && !url.includes('['))) {
      resto = ultimo + resto
      url = url.slice(0, -1)
    } else break
  }
  return { url, resto }
}

/** El `href` de una dirección escrita: «www.» sin esquema se abre con https. */
export const hrefDe = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`)

/**
 * El texto con el formato de WhatsApp y Telegram (2026-10-18): `*negrita*` (sin espacio junto a los
 * asteriscos, en una sola línea) y, dentro de cada trozo, las menciones `@cuenta`. Los asteriscos
 * de la negrita no se muestran; al copiar el mensaje se copian (así se pega igual en el grupo).
 * Las direcciones web (2026-10-18, Edison: «enlaces clicables») salen primero y enteras: una «@»
 * dentro de la dirección no es una mención ni un «*» suyo abre una negrita; se abren en otra pestaña.
 */
export function trozosConFormato(texto: string, cuentas?: Iterable<string>): Trozo[] {
  const lista = cuentas ? [...cuentas] : undefined
  const salida: Trozo[] = []
  const llano = (t: string, negrita: boolean) => {
    if (t) for (const x of trozosConMenciones(t, lista)) if (x.texto) salida.push({ ...x, negrita })
  }
  const conNegrita = (t: string) => {
    let desde = 0
    for (const m of t.matchAll(NEGRITA)) {
      const inicio = (m.index ?? 0) + m[1].length
      llano(t.slice(desde, inicio), false)
      llano(m[2], true)
      desde = inicio + m[2].length + 2
    }
    llano(t.slice(desde), false)
  }
  let desde = 0
  for (const m of texto.matchAll(ENLACE)) {
    const inicio = m.index ?? 0
    const { url, resto } = recortarEnlace(m[1])
    if (!url || !/[.\/]/.test(url.replace(/^https?:\/\//i, ''))) continue
    conNegrita(texto.slice(desde, inicio))
    salida.push({ texto: url, mencion: false, negrita: false, enlace: hrefDe(url) })
    desde = inicio + m[1].length - resto.length
  }
  conNegrita(texto.slice(desde))
  return salida.length ? salida : [{ texto, mencion: false, negrita: false }]
}

/** Una línea de un mensaje escrito como en Telegram: su marca (el emoji o la viñeta), el texto y si va
 *  metida un nivel (viñeta o línea que empieza con espacios). */
export interface LineaOrdenada {
  marca: string
  texto: string
  nivel: 0 | 1
  vacia: boolean
}

const MARCA_EMOJI = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\uFE0F|\u20E3|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*\uFE0F?)\s+(.*)$/u
const MARCA_VINETA = /^([-•])\s+(.*)$/

/**
 * El mensaje partido en líneas con su marca (2026-10-18; Edison: «hay que agregar una sangría; la
 * columna del emoji debe estar libre»). La web pinta la marca en una columna fija y el texto al lado,
 * con sangría colgante: lo que salta de línea queda alineado con el texto, no debajo del emoji. Una
 * línea sin marca (el asunto entre comillas) va en la columna del texto; una viñeta, un nivel adentro.
 */
export function lineasOrdenadas(texto: string): LineaOrdenada[] {
  return texto.split('\n').map((cruda) => {
    const sangrada = /^\s{2,}/.test(cruda)
    const linea = cruda.trim()
    if (!linea) return { marca: '', texto: '', nivel: 0, vacia: true }
    const vineta = MARCA_VINETA.exec(linea)
    if (vineta) return { marca: '•', texto: vineta[2], nivel: 1, vacia: false }
    const emoji = MARCA_EMOJI.exec(linea)
    if (emoji) return { marca: emoji[1], texto: emoji[2], nivel: sangrada ? 1 : 0, vacia: false }
    return { marca: '', texto: linea, nivel: sangrada ? 1 : 0, vacia: false }
  })
}

/** El id de la cuenta de la sesión, leído del `sub` del JWT (sin verificarlo: solo para saber
 *  cuáles mensajes son propios; la verdad la tiene el servidor). */
export function idDelToken(token: string | null | undefined): number | null {
  if (!token) return null
  const partes = token.split('.')
  if (partes.length < 2) return null
  try {
    const b64 = partes[1].replace(/-/g, '+').replace(/_/g, '/')
    const relleno = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const crudo = typeof atob === 'function' ? atob(relleno) : ''
    const bytes = Uint8Array.from(crudo, (c) => c.charCodeAt(0))
    const carga = JSON.parse(new TextDecoder().decode(bytes)) as { sub?: string | number }
    const n = Number(carga.sub)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

/** Si el cursor está escribiendo una mención («hola @ma|»), dónde empieza y lo escrito tras la @. */
export function mencionEnCurso(texto: string, cursor: number): { inicio: number; consulta: string } | null {
  const antes = texto.slice(0, cursor)
  const arroba = antes.lastIndexOf('@')
  if (arroba === -1) return null
  if (arroba > 0 && !/\s/.test(antes[arroba - 1])) return null
  const consulta = antes.slice(arroba + 1)
  if (/\s/.test(consulta)) return null
  return { inicio: arroba, consulta }
}

/** Reemplaza la mención en curso por `@cuenta ` y devuelve el texto y dónde queda el cursor. */
export function insertarMencion(texto: string, cursor: number, cuenta: string): { texto: string; cursor: number } {
  const m = mencionEnCurso(texto, cursor)
  if (!m) return { texto, cursor }
  const nuevo = `${texto.slice(0, m.inicio)}@${cuenta} ${texto.slice(cursor)}`
  return { texto: nuevo, cursor: m.inicio + cuenta.length + 2 }
}

/** Quiénes del equipo coinciden con lo escrito tras la @ (cuenta o nombre, sin tildes ni mayúsculas). */
export function filtrarEquipo<T extends { nombre: string; cuenta: string }>(equipo: T[], consulta: string, maximo = 6): T[] {
  const q = sinTildes(consulta)
  return equipo
    .filter((p) => !q || sinTildes(p.cuenta).startsWith(q) || sinTildes(p.nombre).split(/\s+/).some((t) => t.startsWith(q)))
    .slice(0, maximo)
}

const sinTildes = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export interface Tema {
  canal: Canal
  hijos: Canal[]
}

/** Los que tienen algo sin leer van primero; entre iguales se conserva el orden (el de la API: por recencia). */
export function noLeidosPrimero(canales: Canal[]): Canal[] {
  return canales.slice().sort((a, b) => Number(b.no_leidos > 0) - Number(a.no_leidos > 0))
}

/**
 * La lista en sus secciones: directos (los que tienen no leídos, primero), grupos, temas (con
 * sus subtemas colgando del padre; un hijo sin padre visible va suelto) y, aparte, Comisiones:
 * el tema `comisiones` con un canal por comisión (`clave` `comision:…`, `padre_id` = ese tema).
 */
export function secciones(canales: Canal[]): { directos: Canal[]; grupos: Canal[]; temas: Tema[]; comisiones: Tema | null } {
  const directos = noLeidosPrimero(canales.filter((c) => c.clase === 'directo'))
  const grupos = canales.filter((c) => c.clase === 'grupo')
  const todosTemas = canales.filter((c) => c.clase === 'tema')
  const ids = new Set(todosTemas.map((c) => c.id))
  const padreComisiones = todosTemas.find((c) => c.clave === 'comisiones') ?? null
  const esComision = (c: Canal) => c.clave.startsWith('comision:') && (padreComisiones ? c.padre_id === padreComisiones.id : true)
  const temas = todosTemas
    .filter((c) => c !== padreComisiones && !esComision(c))
    .filter((c) => !c.padre_id || !ids.has(c.padre_id))
    .map((c) => ({ canal: c, hijos: todosTemas.filter((h) => h.padre_id === c.id && !esComision(h)) }))
  const hijosComision = todosTemas.filter(esComision).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  const comisiones = padreComisiones ? { canal: padreComisiones, hijos: hijosComision } : null
  return { directos, grupos, temas, comisiones }
}

/** En un directo (`clave` `u:3-u:7`), el id de la otra persona; null si no se puede saber. */
export function otroDelDirecto(clave: string, miId: number | null): number | null {
  const m = /^u:(\d+)-u:(\d+)$/.exec(clave)
  if (!m) return null
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (miId === null) return a
  return a === miId ? b : b === miId ? a : a
}

/** Mete o reemplaza un mensaje en la lista (ordenada por id); lo repetido del socket no duplica. */
export function fusionar<T extends { id: number }>(lista: T[], nuevo: T): T[] {
  const i = lista.findIndex((m) => m.id === nuevo.id)
  if (i !== -1) {
    const copia = lista.slice()
    copia[i] = { ...lista[i], ...nuevo }
    return copia
  }
  if (lista.length === 0 || lista[lista.length - 1].id < nuevo.id) return [...lista, nuevo]
  const j = lista.findIndex((m) => m.id > nuevo.id)
  return [...lista.slice(0, j), nuevo, ...lista.slice(j)]
}

const NOMBRE_ENTIDAD: Record<string, string> = {
  doc: 'Documento', pl: 'Proyecto de ley', sr: 'Semana', entrada: 'Recibido', evento: 'Evento', tarea: 'Tarea',
  foto: 'Foto', persona: 'Persona', inst: 'Institución', pedido: 'Pedido', comision: 'Comisión', norma: 'Norma',
}

/** El nombre vigente que dio el servidor (`etiqueta`); si no lo hay, «Proyecto de ley 3» para
 *  `pl:3`; lo desconocido se muestra tal cual. */
export function nombreEntidad(entidad: string, etiqueta?: string): string {
  if (etiqueta) return etiqueta
  const [p, ...resto] = entidad.split(':')
  const nombre = NOMBRE_ENTIDAD[p]
  return nombre ? `${nombre} ${resto.join(':')}` : entidad
}

/** El destino `chat:<canal>:<mensaje>` de un aviso de la campana → la ruta de la web. */
export function rutaDestinoChat(destino: string): string | null {
  const m = /^chat:(\d+)(?::(\d+))?$/.exec(destino)
  if (!m) return null
  return `/chat?canal=${m[1]}${m[2] ? `&mensaje=${m[2]}` : ''}`
}

/** «Quien: lo último que se dijo», para la fila de la lista. */
export function vistaPrevia(c: Canal, yo: string | null = null): string {
  if (!c.ultimo) return c.descripcion || (c.clase === 'directo' ? 'Sin mensajes todavía' : 'Sin mensajes')
  const quien = yo && c.ultimo.autor === yo ? 'Usted' : c.ultimo.autor
  const texto = c.ultimo.texto.replace(/\s+/g, ' ').trim()
  return c.clase === 'directo' && quien !== 'Usted' ? texto : `${quien}: ${texto}`
}

/** «3 respuestas», «1 respuesta». */
export const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`

// --- aspecto (2026-10-12, fase 9.4: «como WhatsApp/Telegram») --------------------------------------

/**
 * Colores para el nombre y el avatar de cada persona: todos de la marca o de apoyo (paleta.ts),
 * oscuros (≥ 4,5:1 sobre blanco y con texto blanco encima); sin naranja ni rosa.
 */
// Tonos apagados (2026-10-19, rediseño tipo macOS): se distinguen entre sí sin colores vivos.
export const COLORES_PERSONA = ['#5E5E63', '#5E7A7B', '#6A7A94', '#6F8A72', '#9A7A3C', '#7D6A60', '#7A6A8C', '#8A6F4E'] as const

/** El color de una persona, estable por su id (el mismo en la lista, el avatar y el nombre). */
export function colorDePersona(id: number | string | null | undefined): string {
  if (id === null || id === undefined || id === '') return COLORES_PERSONA[0]
  const n = typeof id === 'number' ? Math.abs(Math.trunc(id)) : [...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
  return COLORES_PERSONA[n % COLORES_PERSONA.length]
}

export const VENTANA_GRUPO_MS = 5 * 60 * 1000

/**
 * Agrupa los mensajes seguidos del mismo autor (humano, no eliminado el anterior importa poco)
 * escritos con menos de cinco minutos entre uno y otro: el primero del grupo lleva nombre y
 * el último, avatar y cola. Los del sistema van siempre solos.
 */
export function marcarConsecutivos<T extends { autor_id: number | null; creado_en: string | null }>(
  mensajes: T[],
  ventanaMs = VENTANA_GRUPO_MS,
): { inicio: boolean; fin: boolean }[] {
  const t = (m: T) => (m.creado_en ? new Date(m.creado_en).getTime() : NaN)
  const sigue = (a: T | undefined, b: T): boolean =>
    Boolean(a) && a!.autor_id !== null && b.autor_id !== null && a!.autor_id === b.autor_id &&
    (Number.isNaN(t(a!)) || Number.isNaN(t(b)) || t(b) - t(a!) < ventanaMs)
  return mensajes.map((m, i) => ({ inicio: !sigue(mensajes[i - 1], m), fin: !(mensajes[i + 1] && sigue(m, mensajes[i + 1])) }))
}

const RE_CERCA = /```[^\n]*\n([\s\S]*?)```/g
const RE_TIPO = /^[ \t]*tipo[ \t]*:[ \t]*\S/m

/**
 * Parte un mensaje en lo que va antes del bloque `tipo: …`, el bloque y lo que va después
 * (la misma regla que `pegado/lector.py::extraer_bloque`: una cerca ``` con `tipo:`, o desde
 * la línea `tipo:` hasta una línea en blanco seguida de texto que no parece YAML). Sin
 * bloque, `bloque` es nulo y `antes` es todo el texto.
 */
export function partirBloque(texto: string): { antes: string; bloque: string | null; despues: string } {
  const t = (texto || '').replace(/\r\n/g, '\n')
  for (const m of t.matchAll(RE_CERCA)) {
    if (RE_TIPO.test(m[1])) {
      const inicio = m.index ?? 0
      return { antes: t.slice(0, inicio).trim(), bloque: m[1].replace(/^\n+|\n+$/g, ''), despues: t.slice(inicio + m[0].length).trim() }
    }
  }
  const m = RE_TIPO.exec(t)
  if (!m) return { antes: t, bloque: null, despues: '' }
  const lineas = t.slice(m.index).split('\n')
  const bloque: string[] = []
  let i = 0
  for (; i < lineas.length; i += 1) {
    const ln = lineas[i]
    if (ln.trim() === '') {
      const siguiente = lineas.slice(i + 1).find((x) => x.trim()) ?? ''
      if (!/^\s*(-\s|[A-Za-z_][\w-]*\s*:)/.test(siguiente)) break
      bloque.push(ln)
      continue
    }
    if (ln.trim().startsWith('```')) break
    bloque.push(ln)
  }
  const cuerpo = bloque.join('\n').replace(/^\n+|\n+$/g, '')
  return { antes: t.slice(0, m.index).trim(), bloque: cuerpo, despues: lineas.slice(i).join('\n').trim() }
}

/** Un bloque de más de seis líneas se muestra plegado («Ver el bloque»). */
export const bloqueLargo = (bloque: string | null, maximo = 6): boolean => Boolean(bloque) && bloque!.split('\n').length > maximo

/** La primera línea útil del bloque, para el resumen plegado: «tipo: agenda-actividades». */
export function tituloBloque(bloque: string): string {
  const linea = bloque.split('\n').find((l) => /^\s*tipo\s*:/.test(l)) ?? bloque.split('\n')[0] ?? ''
  return linea.trim().slice(0, 60)
}

/**
 * Lo que llega por el socket (`{reacciones}` con `mia: false` para todos) sobre lo que ya se
 * tenía: `mia` se conserva de lo actual y, si quien reaccionó soy yo (otra pestaña), se
 * deduce de si el emoji subió o bajó.
 */
export function fusionarReacciones(actuales: Reaccion[] | undefined, nuevas: Reaccion[], esMio: boolean, emoji: string): Reaccion[] {
  const previas = new Map((actuales ?? []).map((r) => [r.emoji, r]))
  return nuevas.map((r) => {
    const antes = previas.get(r.emoji)
    let mia = antes?.mia ?? false
    if (esMio && r.emoji === emoji) mia = !antes || r.n > antes.n ? true : r.n < antes.n ? false : antes.mia
    return { emoji: r.emoji, n: r.n, mia }
  })
}

/** «1,2 MB», «340 KB», «12 B». */
export function pesoLegible(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

const EXT_IMAGEN = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'heic', 'heif'])
const EXT_VIDEO = new Set(['mp4', 'mov', 'webm', 'mkv', 'm4v', '3gp'])

/** Qué es un archivo por su extensión: imagen (miniatura), video, pdf o «otro» (tarjeta con icono). */
export function claseArchivo(nombre: string): 'imagen' | 'video' | 'pdf' | 'otro' {
  const ext = (nombre.split('.').pop() ?? '').toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (EXT_IMAGEN.has(ext)) return 'imagen'
  if (EXT_VIDEO.has(ext)) return 'video'
  return 'otro'
}

/** Un fragmento de una línea para citar («Ana: Listo el oficio…»). */
export function fragmento(texto: string, maximo = 90): string {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  return limpio.length > maximo ? `${limpio.slice(0, maximo - 1)}…` : limpio
}

/** Los contactos por nombre, sin tildes ni mayúsculas (para el diálogo de nuevo chat). */
export function ordenarPorNombre<T extends { nombre: string }>(lista: T[]): T[] {
  return lista.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
}

// --- fase 9.6: encuestas, notas de voz y el aviso de un bloque pegado ----------------------------

/**
 * Los formatos de `backend/app/esquemas/pegado/*.yml` y el módulo donde entran (la misma tabla
 * que `servicios/chat.py::RUTA_MODULO` / `REGISTRABLES`; `tests/test_chat_encuestas.py`
 * comprueba que estén todos). `registrable`: el chat lo registra con un toque; si no, ofrece
 * abrirlo en el módulo. Un recibido se registra solo si va con su PDF; el plan de tareas se revisa
 * y registra en el mismo chat («Pegar tareas», `servicios/chat.py::EN_EL_CHAT`).
 */
export const FORMATOS_PEGADO: Record<string, { modulo: string; registrable: boolean | 'con_pdf' }> = {
  'agenda-actividades': { modulo: 'Agenda', registrable: true },
  'pieza-de-prensa': { modulo: 'Prensa', registrable: true },
  'seguimiento-documento': { modulo: 'Seguimiento', registrable: true },
  'documento-recibido': { modulo: 'Mesa de Partes', registrable: 'con_pdf' },
  'registro-representacion': { modulo: 'Semana de representación', registrable: false },
  'proyecto-de-ley': { modulo: 'Proyectos de ley', registrable: false },
  'documento-administrativo': { modulo: 'Nuevo documento', registrable: false },
  'plan-de-tareas': { modulo: 'Tareas', registrable: true },
  'comprobantes-gasto': { modulo: 'Rendición de cuentas', registrable: false },
}

/** El `tipo:` del bloque que trae el texto (la misma regla que `partirBloque`); '' si no hay. */
export function tipoPegado(texto: string): string {
  const { bloque } = partirBloque(texto)
  if (!bloque) return ''
  const m = /^\s*tipo\s*:\s*["']?([a-z0-9_-]+)["']?\s*$/im.exec(bloque)
  return m ? m[1].toLowerCase() : ''
}

/**
 * Lo que se dice sobre la caja ANTES de enviar un bloque pegado: «Reconocido: Agenda · se
 * ofrecerá registrarlo». Null si el texto no trae un bloque de un formato conocido.
 */
export function avisoPegado(texto: string): { tipo: string; texto: string } | null {
  const tipo = tipoPegado(texto)
  const f = tipo ? FORMATOS_PEGADO[tipo] : undefined
  if (!f) return null
  const que = f.registrable === true ? 'se ofrecerá registrarlo' : f.registrable === 'con_pdf' ? 'adjunte el PDF o la foto del documento para registrarlo' : `se ofrecerá abrirlo en ${f.modulo}`
  return { tipo, texto: `Reconocido: ${f.modulo} · ${que}` }
}

const EXT_AUDIO = new Set(['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'weba', 'flac', 'amr'])

/** ¿Se reproduce como nota de voz? Lo que graba el chat (`nota-de-voz-…`), lo que trae duración o un audio por su extensión. */
export function esAudio(a: { nombre: string; duracion_ms?: number | null }): boolean {
  const nombre = (a.nombre || '').toLowerCase()
  const ext = nombre.split('.').pop() ?? ''
  if (nombre.startsWith('nota-de-voz') && (EXT_AUDIO.has(ext) || ext === 'webm' || ext === 'mp4')) return true
  if (a.duracion_ms && a.duracion_ms > 0 && !EXT_IMAGEN.has(ext) && ext !== 'pdf') return true
  return EXT_AUDIO.has(ext)
}

/** «0:07», «12:03», «1:02:03» (lo que muestra la nota de voz y el contador al grabar). */
export function duracionLegible(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '0:00'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sg = total % 60
  return h ? `${h}:${dos(m)}:${dos(sg)}` : `${m}:${dos(sg)}`
}

/**
 * El formato en que graba el micrófono: webm/opus (Chrome, Android, Firefox) o mp4/aac (Safari de
 * iOS, que no graba webm); ogg/opus si es lo único. `admite` es `MediaRecorder.isTypeSupported`.
 * Sin ninguno, `mime` vacío (el navegador elige) y la extensión se deduce después.
 */
export function formatoGrabacion(admite: (mime: string) => boolean): { mime: string; ext: string } {
  const candidatos: [string, string][] = [
    ['audio/webm;codecs=opus', 'webm'], ['audio/webm', 'webm'], ['audio/mp4;codecs=mp4a.40.2', 'm4a'], ['audio/mp4', 'm4a'],
    ['audio/aac', 'm4a'], ['audio/ogg;codecs=opus', 'ogg'],
  ]
  for (const [mime, ext] of candidatos) {
    try {
      if (admite(mime)) return { mime, ext }
    } catch {
      /* un navegador viejo que lanza en vez de responder no */
    }
  }
  return { mime: '', ext: '' }
}

/** La extensión de un tipo que eligió el navegador («audio/mp4» → m4a). */
export function extDeTipo(tipo: string): string {
  const t = (tipo || '').toLowerCase()
  if (t.includes('webm')) return 'webm'
  if (t.includes('mp4') || t.includes('aac') || t.includes('m4a')) return 'm4a'
  if (t.includes('ogg')) return 'ogg'
  return 'webm'
}

/** `nota-de-voz-20261012-101503.webm`: el nombre que reconoce el servidor (`es_nota_de_voz`). */
/** Nombre de una imagen pegada o arrastrada sin nombre útil («image.png» del portapapeles, 2026-10-18). */
export const nombreCaptura = (d: Date, ext = 'png'): string =>
  `captura-${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}.${ext}`

/** ¿El archivo es una imagen que se puede anotar en el navegador (no HEIC ni video)? */
export const esImagenAnotable = (a: Pick<File, 'type' | 'name'>): boolean =>
  /^image\/(png|jpe?g|webp|gif|bmp)$/i.test(a.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(a.name)

/** Las imágenes que trae un pegado o un arrastre, con nombre propio si venían sin él; `[]` si no hay. */
export function imagenesDeTransferencia(archivos: ArrayLike<File> | null | undefined, ahora = new Date()): File[] {
  if (!archivos) return []
  const salida: File[] = []
  for (const a of Array.from(archivos)) {
    if (!esImagenAnotable(a)) continue
    const ext = (a.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
    const sinNombre = !a.name || /^(image|imagen|captura|screenshot)\.[a-z]+$/i.test(a.name)
    salida.push(sinNombre ? new File([a], nombreCaptura(new Date(ahora.getTime() + salida.length * 1000), ext), { type: a.type }) : a)
  }
  return salida
}

export const nombreNotaDeVoz = (d: Date, ext: string): string =>
  `nota-de-voz-${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}.${ext || 'webm'}`

/** Las opciones del diálogo de encuesta, listas para enviar: sin blancos ni repetidas. */
export function opcionesValidas(opciones: string[]): string[] {
  const vistas = new Set<string>()
  const salida: string[] = []
  for (const o of opciones) {
    const t = o.replace(/\s+/g, ' ').trim()
    if (t && !vistas.has(t.toLowerCase())) {
      vistas.add(t.toLowerCase())
      salida.push(t)
    }
  }
  return salida
}

/** El pie de la encuesta: «3 votos · varias respuestas · anónima · cerrada». */
export function pieEncuesta(e: Pick<Encuesta, 'votantes' | 'multiple' | 'anonima' | 'cerrada'>): string {
  return [plural(e.votantes, 'voto', 'votos'), e.multiple ? 'varias respuestas' : '', e.anonima ? 'anónima' : '', e.cerrada ? 'cerrada' : ''].filter(Boolean).join(' · ')
}
