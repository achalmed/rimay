/**
 * El módulo web del chat (proyecto Rimay; fase 10.2b R4 del contrato de Tiqsi, 2026-10-20): su pantalla, su ruta y cómo
 * entra al menú del anfitrión. Qillqa arma con esto su entrada en el menú (navegacion.ts) y su ruta (App.tsx); la
 * página del chat SOLO (src/rimay_sola.tsx), su cáscara mínima.
 *
 * La conversación del equipo dentro del sistema (2026-10-12, fase 8), con los mensajes automáticos de las reglas de
 * eventos: directos, grupos y temas; hilos; la ficha de la entidad del canal al lado. Lista, conversación y búsqueda
 * van en la página (?canal=N, ?directo=UID, ?mensaje=M).
 */
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined'
import AddCommentOutlinedIcon from '@mui/icons-material/AddCommentOutlined'
import { definirModuloWeb } from '@qillqa/tiqsi'

export const RIMAY = definirModuloWeb({
  id: 'chat',
  nombre: 'Chat',
  corto: 'Chat',
  ruta: '/chat',
  icono: ForumOutlinedIcon,
  descripcion: 'Conversar con el equipo: directos, grupos y temas, con lo que el sistema avisa solo.',
  opciones: [
    { etiqueta: 'Conversaciones', ruta: '/chat', icono: ForumOutlinedIcon },
    { etiqueta: 'Nueva conversación', ruta: '/chat?nuevo=1', icono: AddCommentOutlinedIcon, accion: true, ayuda: 'Un directo con alguien del equipo o un grupo' },
  ],
  cargar: () => import('../../paginas/Chat'),
})
