// Visto y leído y temas por sección del chat (2026-10-13). Correr desde frontend/:
//   node --test pruebas/*.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  agruparTemas, categoriaDe, detalleLecturas, estadoEntrega, fusionarLecturas, noLeidosDe, OTROS_TEMAS, rotuloLecturas, type Lectura,
} from '../src/componentes/chat/entrega.ts'

const yo = 1
const l = (usuario_id: number, ultimo_recibido_id: number, ultimo_leido_id: number): Lectura => ({ usuario_id, ultimo_recibido_id, ultimo_leido_id })

test('directo: enviado, recibido y leído', () => {
  assert.equal(estadoEntrega(10, [l(1, 10, 10), l(2, 9, 9)], yo), 'enviado')
  assert.equal(estadoEntrega(10, [l(1, 10, 10), l(2, 10, 9)], yo), 'recibido')
  assert.equal(estadoEntrega(10, [l(1, 10, 10), l(2, 12, 11)], yo), 'leido')
  // Leer implica recibir aunque el recibido no se haya subido.
  assert.equal(estadoEntrega(10, [l(2, 0, 10)], yo), 'leido')
})

test('pendiente sin id y enviado si no hay nadie más', () => {
  assert.equal(estadoEntrega(-3, [l(2, 99, 99)], yo), 'pendiente')
  assert.equal(estadoEntrega(0, [], yo), 'pendiente')
  assert.equal(estadoEntrega(5, [l(1, 5, 5)], yo), 'enviado')
})

test('grupo: la marca es la del más atrasado y «Leído por» dice quién', () => {
  const ls = [l(1, 20, 20), l(2, 20, 20), l(3, 20, 15), l(4, 12, 12)]
  assert.equal(estadoEntrega(20, ls, yo), 'enviado')
  const d = detalleLecturas(20, ls, yo)
  assert.deepEqual(d.leyeron.map((x) => x.usuario_id), [2])
  assert.deepEqual(d.recibieron.map((x) => x.usuario_id), [3])
  assert.deepEqual(d.faltan.map((x) => x.usuario_id), [4])
  assert.equal(rotuloLecturas(20, ls, yo), 'Leído por 1 de 3')
  assert.equal(rotuloLecturas(10, [l(2, 10, 0)], yo), 'Recibido')
})

test('las lecturas que llegan por el socket nunca bajan', () => {
  const r = fusionarLecturas([l(2, 10, 8)], [{ usuario_id: 2, ultimo_recibido_id: 9, ultimo_leido_id: 9 }, { usuario_id: 3, ultimo_recibido_id: 4, ultimo_leido_id: 0 }])
  assert.deepEqual(r, [l(2, 10, 9), l(3, 4, 0)])
})

const canal = (id: number, clave: string, no_leidos = 0, categoria = '', silenciado = false) => ({ id, clave, no_leidos, categoria, silenciado })

test('secciones de temas en orden fijo, las propias después y Otros al final', () => {
  const temas = [
    { canal: canal(1, 'prensa'), hijos: [] },
    { canal: canal(2, 'general'), hijos: [] },
    { canal: canal(3, '', 0, 'Bancada'), hijos: [] },
    { canal: canal(4, ''), hijos: [] },
    { canal: canal(5, 'documentos'), hijos: [] },
    { canal: canal(6, 'documentos-listos', 2), hijos: [] },
  ]
  const g = agruparTemas(temas)
  assert.deepEqual(g.map((x) => x.categoria), ['Equipo', 'Documentos', 'Prensa y medios', 'Bancada', OTROS_TEMAS])
  // Dentro de la sección, lo que tiene algo sin leer va primero; la sección suma sus no leídos.
  assert.deepEqual(g[1].temas.map((t) => t.canal.id), [6, 5])
  assert.equal(g[1].noLeidos, 2)
})

test('lo silenciado no suma y la categoría guardada manda sobre la de fábrica', () => {
  assert.equal(noLeidosDe({ canal: canal(1, 'x', 3, '', true), hijos: [{ id: 2, no_leidos: 2 }] }), 2)
  assert.equal(categoriaDe({ clave: 'prensa', categoria: 'Equipo' }), 'Equipo')
  assert.equal(categoriaDe({ clave: 'recibidos' }), 'Documentos')
  assert.equal(categoriaDe({ clave: 'pl:3' }), OTROS_TEMAS)
})
