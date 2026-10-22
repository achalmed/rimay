/**
 * El chat SOLO en el navegador (Rimay): la cáscara mínima de Tiqsi con el módulo web del chat, contra el
 * anfitrión mínimo del backend (rimay/sola.py). No importa nada de Qillqa. Se construye desde la raíz con
 * `npm run web:construir`.
 */
import { createRoot } from 'react-dom/client'
import { CascaronMinimo } from '@qillqa/tiqsi/minimo'
import { RIMAY } from './componentes/chat/modulo'

createRoot(document.getElementById('root')!).render(<CascaronMinimo modulo={RIMAY} />)
