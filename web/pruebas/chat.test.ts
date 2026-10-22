// Pruebas de la lógica pura del chat (fase 8.3). Correr desde frontend/:
//   node --test pruebas/*.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  agruparPorDia, bloqueLargo, claseArchivo, COLORES_PERSONA, colorDePersona, etiquetaDia, fechaCorta, filtrarEquipo, fragmento, fusionar,
  fusionarReacciones, horaDe, idDelToken, insertarMencion, marcarConsecutivos, mencionEnCurso, noLeidosPrimero, nombreEntidad,
  ordenarPorNombre, otroDelDirecto, partirBloque, pesoLegible, rutaDestinoChat, secciones, tituloBloque, trozosConMenciones, vistaPrevia,
  type Canal,
} from '../src/componentes/chat/mensajes.ts'

const iso = (dia: string, hora: string) => new Date(`${dia}T${hora}:00`).toISOString()

test('rótulo del separador: Hoy, Ayer, día de la semana y año si no es el de hoy', () => {
  assert.equal(etiquetaDia('2026-10-12', '2026-10-12'), 'Hoy')
  assert.equal(etiquetaDia('2026-10-11', '2026-10-12'), 'Ayer')
  assert.equal(etiquetaDia('2026-10-05', '2026-10-12'), 'lun 05/10')
  assert.equal(etiquetaDia('2025-12-20', '2026-10-12'), 'sáb 20/12/2025')
  // El cambio de mes no rompe «ayer».
  assert.equal(etiquetaDia('2026-09-30', '2026-10-01'), 'Ayer')
})

test('agrupar por día conserva el orden y parte donde cambia la fecha', () => {
  const lista = [
    { id: 1, creado_en: iso('2026-10-11', '09:00') },
    { id: 2, creado_en: iso('2026-10-11', '18:30') },
    { id: 3, creado_en: iso('2026-10-12', '08:15') },
    { id: 4, creado_en: null },
  ]
  const bloques = agruparPorDia(lista, '2026-10-12')
  assert.equal(bloques.length, 2)
  assert.equal(bloques[0].etiqueta, 'Ayer')
  assert.deepEqual(bloques[0].mensajes.map((m) => m.id), [1, 2])
  assert.equal(bloques[1].etiqueta, 'Hoy')
  assert.deepEqual(bloques[1].mensajes.map((m) => m.id), [3, 4])
  assert.equal(horaDe(iso('2026-10-12', '08:05')), '08:05')
  assert.equal(horaDe(null), '')
  assert.equal(fechaCorta(iso('2026-10-12', '08:05'), '2026-10-12'), '08:05')
  assert.equal(fechaCorta(iso('2026-10-11', '08:05'), '2026-10-12'), 'ayer')
  assert.equal(fechaCorta(iso('2026-10-05', '08:05'), '2026-10-12'), '05/10')
})

test('menciones: se marcan solo las cuentas que existen', () => {
  const t = trozosConMenciones('Hola @ana, mira esto con @nadie y @luis.', ['ana', 'luis'])
  assert.deepEqual(t, [
    { texto: 'Hola ', mencion: false },
    { texto: '@ana', mencion: true },
    { texto: ', mira esto con @nadie y ', mencion: false },
    { texto: '@luis', mencion: true },
    { texto: '.', mencion: false },
  ])
  assert.deepEqual(trozosConMenciones('sin menciones'), [{ texto: 'sin menciones', mencion: false }])
  assert.deepEqual(trozosConMenciones('@todos'), [{ texto: '@todos', mencion: true }])
  assert.deepEqual(trozosConMenciones(''), [{ texto: '', mencion: false }])
})

test('mención en curso e inserción', () => {
  assert.deepEqual(mencionEnCurso('hola @ma', 8), { inicio: 5, consulta: 'ma' })
  assert.equal(mencionEnCurso('correo@casa', 11), null) // una @ pegada a una palabra no es mención
  assert.equal(mencionEnCurso('hola @ana ya', 12), null) // tras el espacio se cerró
  assert.deepEqual(insertarMencion('hola @ma todo', 8, 'maria'), { texto: 'hola @maria  todo', cursor: 12 })
  const equipo = [
    { id: 1, nombre: 'María Quispe', cuenta: 'mquispe' },
    { id: 2, nombre: 'Luis Pérez', cuenta: 'lperez' },
  ]
  assert.deepEqual(filtrarEquipo(equipo, 'ma').map((p) => p.id), [1])
  assert.deepEqual(filtrarEquipo(equipo, 'per').map((p) => p.id), [2]) // «Pérez» sin tilde
  assert.deepEqual(filtrarEquipo(equipo, '').map((p) => p.id), [1, 2])
})

test('el id de la sesión sale del sub del JWT', () => {
  const carga = Buffer.from(JSON.stringify({ sub: '7', exp: 1 })).toString('base64url')
  assert.equal(idDelToken(`xxx.${carga}.firma`), 7)
  assert.equal(idDelToken('basura'), null)
  assert.equal(idDelToken(null), null)
})

const canal = (parcial: Partial<Canal>): Canal => ({
  id: 0, clase: 'grupo', nombre: '', descripcion: '', entidad: '', padre_id: null, visibilidad: 'privado', clave: '',
  archivado: false, miembro: true, papel: '', no_leidos: 0, ultimo: null, ...parcial,
})

test('secciones de la lista: directos, grupos y temas con sus subtemas', () => {
  const s = secciones([
    canal({ id: 1, clase: 'directo', nombre: 'Ana' }),
    canal({ id: 2, clase: 'tema', nombre: 'General' }),
    canal({ id: 3, clase: 'tema', nombre: 'PL 3', padre_id: 2 }),
    canal({ id: 4, clase: 'grupo', nombre: 'Asesores' }),
    canal({ id: 5, clase: 'tema', nombre: 'Huérfano', padre_id: 99 }),
  ])
  assert.deepEqual(s.directos.map((c) => c.id), [1])
  assert.deepEqual(s.grupos.map((c) => c.id), [4])
  assert.deepEqual(s.temas.map((t) => [t.canal.id, t.hijos.map((h) => h.id)]), [[2, [3]], [5, []]])
  assert.equal(s.comisiones, null)
})

test('comisiones van aparte (plegables) y los directos con no leídos, primero', () => {
  const s = secciones([
    canal({ id: 1, clase: 'directo', nombre: 'Ana', clave: 'u:1-u:2' }),
    canal({ id: 2, clase: 'directo', nombre: 'Luis', clave: 'u:1-u:3', no_leidos: 2 }),
    canal({ id: 3, clase: 'tema', nombre: 'General', clave: 'general' }),
    canal({ id: 4, clase: 'tema', nombre: 'Comisiones', clave: 'comisiones' }),
    canal({ id: 5, clase: 'tema', nombre: 'Salud', clave: 'comision:salud', padre_id: 4 }),
    canal({ id: 6, clase: 'tema', nombre: 'Educación', clave: 'comision:educacion', padre_id: 4 }),
  ])
  assert.deepEqual(s.directos.map((c) => c.id), [2, 1])
  assert.deepEqual(s.temas.map((t) => t.canal.id), [3])
  assert.equal(s.comisiones?.canal.id, 4)
  assert.deepEqual(s.comisiones?.hijos.map((h) => h.nombre), ['Educación', 'Salud'])
  // El orden entre iguales se conserva (el de la API, por recencia).
  assert.deepEqual(noLeidosPrimero([canal({ id: 1 }), canal({ id: 2, no_leidos: 1 }), canal({ id: 3 }), canal({ id: 4, no_leidos: 5 })]).map((c) => c.id), [2, 4, 1, 3])
  assert.equal(otroDelDirecto('u:1-u:7', 1), 7)
  assert.equal(otroDelDirecto('u:1-u:7', 7), 1)
  assert.equal(otroDelDirecto('u:1-u:7', null), 1)
  assert.equal(otroDelDirecto('', 1), null)
})

test('color por persona: estable, de la paleta y repartido', () => {
  assert.equal(colorDePersona(7), colorDePersona(7))
  assert.ok((COLORES_PERSONA as readonly string[]).includes(colorDePersona(7)))
  assert.ok((COLORES_PERSONA as readonly string[]).includes(colorDePersona('u:3')))
  assert.equal(colorDePersona(null), COLORES_PERSONA[0])
  const distintos = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(colorDePersona))
  assert.equal(distintos.size, COLORES_PERSONA.length)
  // Sin naranja ni rosa: ningún color de la lista es un tono cálido saturado claro.
  for (const c of COLORES_PERSONA) assert.match(c, /^#[0-9A-F]{6}$/i)
})

test('mensajes consecutivos del mismo autor se agrupan si pasan menos de cinco minutos', () => {
  const lista = [
    { id: 1, autor_id: 1, creado_en: iso('2026-10-12', '09:00') },
    { id: 2, autor_id: 1, creado_en: iso('2026-10-12', '09:02') },
    { id: 3, autor_id: 2, creado_en: iso('2026-10-12', '09:03') },
    { id: 4, autor_id: 2, creado_en: iso('2026-10-12', '09:20') }, // más de 5 min: grupo nuevo
    { id: 5, autor_id: null, creado_en: iso('2026-10-12', '09:21') }, // el sistema, siempre solo
    { id: 6, autor_id: 2, creado_en: iso('2026-10-12', '09:21') },
    { id: 7, autor_id: 2, creado_en: null }, // sin hora (recién enviado): sigue al anterior
  ]
  assert.deepEqual(marcarConsecutivos(lista), [
    { inicio: true, fin: false }, { inicio: false, fin: true },
    { inicio: true, fin: true }, { inicio: true, fin: true },
    { inicio: true, fin: true },
    { inicio: true, fin: false }, { inicio: false, fin: true },
  ])
  assert.deepEqual(marcarConsecutivos([]), [])
})

test('el bloque tipo: se separa del texto y se pliega si es largo', () => {
  const texto = 'Mira esto:\n```yaml\ntipo: agenda-actividades\nactividades:\n  - titulo: Sesión\n```\n¿lo registras?'
  const p = partirBloque(texto)
  assert.equal(p.antes, 'Mira esto:')
  assert.equal(p.bloque, 'tipo: agenda-actividades\nactividades:\n  - titulo: Sesión')
  assert.equal(p.despues, '¿lo registras?')
  // Sin cerca: desde «tipo:» hasta la línea en blanco seguida de prosa.
  const q = partirBloque('tipo: pieza-de-prensa\ntitular: Algo\n\nfuente: Diario\n\nGracias por revisar.')
  assert.equal(q.antes, '')
  assert.equal(q.bloque, 'tipo: pieza-de-prensa\ntitular: Algo\n\nfuente: Diario')
  assert.equal(q.despues, 'Gracias por revisar.')
  assert.deepEqual(partirBloque('sin bloque, el tipo: no va al inicio'), { antes: 'sin bloque, el tipo: no va al inicio', bloque: null, despues: '' })
  assert.equal(bloqueLargo(null), false)
  assert.equal(bloqueLargo('a\nb\nc'), false)
  assert.equal(bloqueLargo('1\n2\n3\n4\n5\n6\n7'), true)
  assert.equal(tituloBloque('fuente: x\ntipo: pieza-de-prensa\ntitular: y'), 'tipo: pieza-de-prensa')
})

test('reacciones: lo que llega por el socket conserva «mía» y la deduce si fui yo', () => {
  const actuales = [{ emoji: '👍', n: 1, mia: true }, { emoji: '✅', n: 2, mia: false }]
  // Otra persona añade ❤️: mis marcas se conservan.
  const a = fusionarReacciones(actuales, [{ emoji: '👍', n: 1, mia: false }, { emoji: '✅', n: 2, mia: false }, { emoji: '❤️', n: 1, mia: false }], false, '❤️')
  assert.deepEqual(a, [{ emoji: '👍', n: 1, mia: true }, { emoji: '✅', n: 2, mia: false }, { emoji: '❤️', n: 1, mia: false }])
  // Yo (desde otra pestaña) pongo ✅: sube y pasa a mía.
  const b = fusionarReacciones(actuales, [{ emoji: '👍', n: 1, mia: false }, { emoji: '✅', n: 3, mia: false }], true, '✅')
  assert.equal(b[1].mia, true)
  // Yo quito 👍: desaparece de la lista o baja y deja de ser mía.
  const c = fusionarReacciones(actuales, [{ emoji: '✅', n: 2, mia: false }], true, '👍')
  assert.deepEqual(c, [{ emoji: '✅', n: 2, mia: false }])
  const d = fusionarReacciones([{ emoji: '👍', n: 2, mia: true }], [{ emoji: '👍', n: 1, mia: false }], true, '👍')
  assert.equal(d[0].mia, false)
  assert.deepEqual(fusionarReacciones(undefined, [{ emoji: '👏', n: 1, mia: false }], false, '👏'), [{ emoji: '👏', n: 1, mia: false }])
})

test('archivos: clase por extensión, peso legible, fragmento y orden por nombre', () => {
  assert.equal(claseArchivo('foto.JPG'), 'imagen')
  assert.equal(claseArchivo('oficio.pdf'), 'pdf')
  assert.equal(claseArchivo('video.mp4'), 'video')
  assert.equal(claseArchivo('tabla.xlsx'), 'otro')
  assert.equal(claseArchivo('sin-extension'), 'otro')
  assert.equal(pesoLegible(0), '')
  assert.equal(pesoLegible(900), '900 B')
  assert.equal(pesoLegible(340 * 1024), '340 KB')
  assert.equal(pesoLegible(1.25 * 1024 * 1024), '1,3 MB')
  assert.equal(fragmento('  hola\n  mundo  '), 'hola mundo')
  assert.equal(fragmento('x'.repeat(100), 10), 'xxxxxxxxx…')
  assert.deepEqual(ordenarPorNombre([{ nombre: 'Óscar' }, { nombre: 'ana' }, { nombre: 'Luis' }]).map((p) => p.nombre), ['ana', 'Luis', 'Óscar'])
})

test('fusionar no duplica lo que llega dos veces y respeta el orden por id', () => {
  const a = fusionar([{ id: 1, t: 'a' }, { id: 3, t: 'c' }], { id: 2, t: 'b' })
  assert.deepEqual(a.map((m) => m.id), [1, 2, 3])
  const b = fusionar(a, { id: 2, t: 'B' })
  assert.equal(b.length, 3)
  assert.equal(b[1].t, 'B')
  assert.deepEqual(fusionar([], { id: 9, t: 'z' }).map((m) => m.id), [9])
})

test('entidad, destino del aviso y vista previa', () => {
  assert.equal(nombreEntidad('pl:3'), 'Proyecto de ley 3')
  assert.equal(nombreEntidad('raro:1'), 'raro:1')
  assert.equal(rutaDestinoChat('chat:4:120'), '/chat?canal=4&mensaje=120')
  assert.equal(rutaDestinoChat('chat:4'), '/chat?canal=4')
  assert.equal(rutaDestinoChat('tarea:4'), null)
  const c = canal({ clase: 'grupo', ultimo: { texto: 'Listo  el\noficio', autor: 'Ana', creado_en: '' } })
  assert.equal(vistaPrevia(c), 'Ana: Listo el oficio')
  assert.equal(vistaPrevia(c, 'Ana'), 'Usted: Listo el oficio')
  assert.equal(vistaPrevia(canal({ clase: 'directo', ultimo: { texto: 'Hola', autor: 'Ana', creado_en: '' } })), 'Hola')
  assert.equal(vistaPrevia(canal({ clase: 'directo' })), 'Sin mensajes todavía')
})

test('formato de WhatsApp y Telegram: *negrita* sin asteriscos y con menciones dentro (2026-10-18)', async () => {
  const { trozosConFormato, esMensajeHumano } = await import('../src/componentes/chat/mensajes.ts')
  const negritas = (t: string) => trozosConFormato(t, ['ana']).filter((x) => x.negrita).map((x) => x.texto)
  assert.deepEqual(negritas('📑 *OFICIO N°0018-2026-2027-ABC-CD/CRP*'), ['OFICIO N°0018-2026-2027-ABC-CD/CRP'])
  assert.deepEqual(negritas('📌 *NUEVO* y *otro dato* aquí'), ['NUEVO', 'otro dato'])
  // Sin pareja, con espacio junto al asterisco, en dos líneas o dentro de una palabra: texto llano.
  assert.deepEqual(negritas('2 * 3 = 6'), [])
  assert.deepEqual(negritas('* nada *'), [])
  assert.deepEqual(negritas('*uno\ndos*'), [])
  assert.deepEqual(negritas('a*b*c'), [])
  const trozos = trozosConFormato('Hola *@ana* y @ana', ['ana'])
  assert.deepEqual(trozos.map((x) => [x.texto, x.mencion, x.negrita]), [['Hola ', false, false], ['@ana', true, true], [' y ', false, false], ['@ana', true, false]])
  assert.equal(trozosConFormato('', []).length, 1)
  assert.equal(trozosConFormato('📄 Expediente\n📑 *N1*\nfin').map((x) => x.texto).join(''), '📄 Expediente\n📑 N1\nfin')
  const tarjeta = { que: 'Llegó', icono: 'recibido', titulo: '', detalle: '', meta: [] }
  assert.equal(esMensajeHumano({ autor_id: null, tarjeta: { ...tarjeta, estilo: 'mensaje', firma: 'Mesa de Partes' } }), true)
  assert.equal(esMensajeHumano({ autor_id: null, tarjeta }), false)
  assert.equal(esMensajeHumano({ autor_id: 3, tarjeta: { ...tarjeta, estilo: 'mensaje' } }), false)
})

test('mensaje ordenado: la marca en su columna y el texto con sangría colgante (2026-10-18)', async () => {
  const { lineasOrdenadas } = await import('../src/componentes/chat/mensajes.ts')
  const l = lineasOrdenadas('📄 Expediente N° 1\n📑 *OF-1*\n\n📝 ASUNTO:\n"Pide informe"\n- Uno\n   • Dos\n      📍 Hemiciclo\n⚖️ Plazo legal: no indicado\n🕒 Hora: 10:00 h\n1️⃣ Primero')
  assert.deepEqual(l.map((x) => [x.marca, x.texto, x.nivel, x.vacia]), [
    ['📄', 'Expediente N° 1', 0, false], ['📑', '*OF-1*', 0, false], ['', '', 0, true], ['📝', 'ASUNTO:', 0, false],
    ['', '"Pide informe"', 0, false], ['•', 'Uno', 1, false], ['•', 'Dos', 1, false], ['📍', 'Hemiciclo', 1, false],
    ['⚖️', 'Plazo legal: no indicado', 0, false], ['🕒', 'Hora: 10:00 h', 0, false], ['', '1️⃣ Primero', 0, false],
  ])
})

test('enlaces en el texto (2026-10-18): enteros, sin la puntuación final, antes que la negrita y las menciones', async () => {
  const { trozosConFormato, recortarEnlace, hrefDe } = await import('../src/componentes/chat/mensajes.ts')
  const t = trozosConFormato('Vea *la agenda* en https://www.congreso.gob.pe/agenda?d=1. Luego @ana.', ['ana'])
  const enlace = t.find((x) => x.enlace)!
  assert.equal(enlace.texto, 'https://www.congreso.gob.pe/agenda?d=1')
  assert.equal(enlace.enlace, 'https://www.congreso.gob.pe/agenda?d=1')
  assert.deepEqual(t.filter((x) => x.negrita).map((x) => x.texto), ['la agenda'])
  assert.deepEqual(t.filter((x) => x.mencion).map((x) => x.texto), ['@ana'])
  assert.equal(t.map((x) => x.texto).join(''), 'Vea la agenda en https://www.congreso.gob.pe/agenda?d=1. Luego @ana.')
  // Una @ dentro de la dirección no es mención; «www.» sin esquema abre con https.
  const u = trozosConFormato('Perfil: www.x.com/@ana', ['ana'])
  assert.equal(u.filter((x) => x.mencion).length, 0)
  assert.equal(u.find((x) => x.enlace)?.enlace, 'https://www.x.com/@ana')
  assert.equal(hrefDe('congreso.gob.pe'), 'https://congreso.gob.pe')
  // Paréntesis: se queda si la dirección abrió uno; se devuelve al texto si no.
  assert.deepEqual(recortarEnlace('https://es.wikipedia.org/wiki/Perú_(país)'), { url: 'https://es.wikipedia.org/wiki/Perú_(país)', resto: '' })
  assert.deepEqual(recortarEnlace('https://x.pe/a).'), { url: 'https://x.pe/a', resto: ').' })
  // Sin dirección, todo igual que antes.
  assert.deepEqual(trozosConFormato('hola'), [{ texto: 'hola', mencion: false, negrita: false }])
})

test('imágenes pegadas o arrastradas (2026-10-18): solo las anotables, con nombre propio si venían sin él', async () => {
  const { imagenesDeTransferencia, nombreCaptura, esImagenAnotable } = await import('../src/componentes/chat/mensajes.ts')
  const d = new Date(2026, 9, 18, 9, 5, 7)
  assert.equal(nombreCaptura(d), 'captura-20261018-090507.png')
  const pegada = new File([new Uint8Array([1])], 'image.png', { type: 'image/png' })
  const foto = new File([new Uint8Array([1])], 'IMG_2031.jpg', { type: 'image/jpeg' })
  const pdf = new File([new Uint8Array([1])], 'oficio.pdf', { type: 'application/pdf' })
  const heic = new File([new Uint8Array([1])], 'x.heic', { type: 'image/heic' })
  const r = imagenesDeTransferencia([pegada, foto, pdf, heic], d)
  assert.deepEqual(r.map((f) => f.name), ['captura-20261018-090507.png', 'IMG_2031.jpg'])
  assert.ok(esImagenAnotable(foto) && !esImagenAnotable(pdf) && !esImagenAnotable(heic))
  assert.deepEqual(imagenesDeTransferencia(null), [])
})
