// Pruebas de lo que el chat suma en la fase 9.6 (encuestas, notas de voz, aviso del bloque
// pegado). Correr desde la raíz:  npm run web:pruebas
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import {
  avisoPegado, duracionLegible, esAudio, extDeTipo, formatoGrabacion, FORMATOS_PEGADO, nombreNotaDeVoz, opcionesValidas, pieEncuesta, tipoPegado,
} from '../src/componentes/chat/mensajes.ts'

test('el aviso antes de enviar reconoce el bloque y dice qué se ofrecerá', () => {
  const agenda = 'Para la semana:\n\n```yaml\ntipo: agenda-actividades\nversion: 1\nactividades:\n  - titulo: Comisión\n```'
  assert.equal(tipoPegado(agenda), 'agenda-actividades')
  assert.deepEqual(avisoPegado(agenda), { tipo: 'agenda-actividades', texto: 'Reconocido: Agenda · se ofrecerá registrarlo' })
  assert.equal(avisoPegado('tipo: proyecto-de-ley\ntitulo: Ley X')?.texto, 'Reconocido: Proyectos de ley · se ofrecerá abrirlo en Proyectos de ley')
  assert.equal(avisoPegado('tipo: documento-recibido\nasunto: Oficio')?.texto, 'Reconocido: Mesa de Partes · adjunte el PDF o la foto del documento para registrarlo')
  assert.equal(avisoPegado('hola, ¿el tipo de cambio?'), null)
  assert.equal(avisoPegado('tipo: algo-desconocido\nx: 1'), null)
})

// Los esquemas de pegado son del anfitrión (en Qillqa, backend/app/esquemas/pegado/; «pegado.v1»): PEGADO_ESQUEMAS o la
// carpeta hermana qillqa. Sin anfitrión a la vista (la demo pública), la prueba se salta.
const ESQUEMAS = process.env.PEGADO_ESQUEMAS || new URL('../../../qillqa/backend/app/esquemas/pegado/', import.meta.url).pathname
test('la tabla de formatos cubre todos los esquemas de pegado del anfitrión', { skip: !existsSync(ESQUEMAS) && 'sin los esquemas del anfitrión' }, () => {
  const tipos = readdirSync(ESQUEMAS).filter((f) => f.endsWith('.yml')).map((f) => f.slice(0, -4))
  assert.ok(tipos.length > 0)
  for (const t of tipos) assert.ok(FORMATOS_PEGADO[t], `falta ${t} en FORMATOS_PEGADO`)
})

test('nota de voz: se reconoce por su nombre, su duración o su extensión', () => {
  assert.ok(esAudio({ nombre: 'nota-de-voz-20261012-101500.webm' }))
  assert.ok(esAudio({ nombre: 'audio.opus' }) && esAudio({ nombre: 'grabacion.m4a' }))
  assert.ok(!esAudio({ nombre: 'reunion.webm' }))
  assert.ok(esAudio({ nombre: 'reunion.webm', duracion_ms: 3000 }))
  assert.ok(!esAudio({ nombre: 'foto.jpg', duracion_ms: 3000 }) && !esAudio({ nombre: 'oficio.pdf' }))
})

test('duración legible y nombre de la grabación', () => {
  assert.equal(duracionLegible(0), '0:00')
  assert.equal(duracionLegible(7400), '0:07')
  assert.equal(duracionLegible(723_000), '12:03')
  assert.equal(duracionLegible(3_723_000), '1:02:03')
  assert.equal(duracionLegible(Infinity), '0:00')
  assert.equal(nombreNotaDeVoz(new Date(2026, 9, 12, 10, 5, 3), 'm4a'), 'nota-de-voz-20261012-100503.m4a')
})

test('formato de grabación: webm/opus si se puede, mp4 en Safari de iOS', () => {
  assert.deepEqual(formatoGrabacion((m) => m.startsWith('audio/webm')), { mime: 'audio/webm;codecs=opus', ext: 'webm' })
  assert.deepEqual(formatoGrabacion((m) => m === 'audio/mp4'), { mime: 'audio/mp4', ext: 'm4a' })
  assert.deepEqual(formatoGrabacion(() => false), { mime: '', ext: '' })
  assert.deepEqual(formatoGrabacion(() => { throw new Error('viejo') }), { mime: '', ext: '' })
  assert.equal(extDeTipo('audio/mp4; codecs=mp4a'), 'm4a')
  assert.equal(extDeTipo('audio/webm;codecs=opus'), 'webm')
})

test('opciones de la encuesta y su pie', () => {
  assert.deepEqual(opcionesValidas([' Lunes ', 'lunes', '', 'Martes  por la tarde']), ['Lunes', 'Martes por la tarde'])
  assert.equal(pieEncuesta({ votantes: 1, multiple: false, anonima: false, cerrada: false }), '1 voto')
  assert.equal(pieEncuesta({ votantes: 3, multiple: true, anonima: true, cerrada: true }), '3 votos · varias respuestas · anónima · cerrada')
})
