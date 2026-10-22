/**
 * Lo que la web del chat ofrece a otros (proyecto Rimay; fase 10.2b R4, 2026-10-20): el equivalente web de
 * «conversaciones.v1». Nadie fuera del chat importa sus archivos internos; solo esto (lo comprueba
 * backend/tests/test_fronteras.py). Lo usan el marco de Qillqa (el contador del chat en el encabezado, la cuenta de la
 * sesión), la campana (a dónde lleva un aviso del chat), la ficha de un contacto, el avatar de una persona (su color)
 * y el perfil (los sonidos y la ventana visible). Al extraer Rimay, es lo que exporta su paquete web.
 */
export { default as ContadorChat } from './ContadorChat'
export { colorDePersona, idDelToken, rutaDestinoChat } from './mensajes'
export { ponerSonidos, sonarLlegada, sonidosActivos } from './sonidos'
export { useVentanaVisible } from './teclado'
