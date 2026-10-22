/**
 * SUBIR Y VER ARCHIVOS DEL CHAT (2026-10-12, fase 9.1/9.4). `subirConProgreso` manda el
 * multipart con XHR (fetch no informa el avance) a `POST /api/chat/canales/{id}/archivos`,
 * con el mismo token y los mismos errores que `api.ts`. `urlDeArchivo` trae un adjunto
 * autenticado (`GET /api/chat/archivos/{id}`) y devuelve un `blob:` que se recuerda por id,
 * para que las miniaturas no se vuelvan a pedir en cada repintado.
 */
import { cerrarSesion, ErrorApi } from '@qillqa/tiqsi'
import { traerArchivo } from './apoyo'

const token = () => localStorage.getItem('qillqa_token')

/** Sube `datos` y avisa del avance (0..1). Resuelve con el JSON del servidor. */
export function subirConProgreso<T>(ruta: string, datos: FormData, alProgresar: (fraccion: number) => void): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', ruta)
    const t = token()
    if (t) xhr.setRequestHeader('Authorization', `Bearer ${t}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) alProgresar(Math.min(1, e.loaded / e.total))
    }
    xhr.onerror = () => rechazar(new ErrorApi('No se pudo conectar con el servidor. Revise su conexión e intente otra vez.', { codigo: 'sin_conexion' }, 503))
    xhr.onload = () => {
      if (xhr.status === 401) {
        cerrarSesion()
        rechazar(new Error('Sesión vencida'))
        return
      }
      let cuerpo: unknown = null
      try {
        cuerpo = JSON.parse(xhr.responseText) as unknown
      } catch {
        cuerpo = null
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const detalle = (cuerpo as { detail?: unknown } | null)?.detail
        const mensaje = typeof detalle === 'string' ? detalle : ((detalle as { mensaje?: string } | undefined)?.mensaje ?? `Error ${xhr.status}`)
        rechazar(new ErrorApi(mensaje, detalle, xhr.status))
        return
      }
      resolver(cuerpo as T)
    }
    xhr.send(datos)
  })
}

const urls = new Map<number, Promise<string>>()

/** El `blob:` de un adjunto del chat (se pide una sola vez por id). */
export function urlDeArchivo(id: number): Promise<string> {
  let p = urls.get(id)
  if (!p) {
    p = traerArchivo(`/api/chat/archivos/${id}`).then((r) => URL.createObjectURL(r.blob))
    p.catch(() => urls.delete(id))
    urls.set(id, p)
  }
  return p
}
