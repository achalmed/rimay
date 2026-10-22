# Rimay — un chat de equipo

Rimay («hablar» en quechua) es un chat de equipo: conversaciones y grupos, hilos, adjuntos y notas de voz, encuestas,
lecturas, avisos en vivo y un puente con Telegram; reconoce los bloques pegados y ofrece registrarlos en el módulo que
corresponde. Es un módulo de [Tiqsi](https://github.com/achalmed/tiqsi): funciona solo, con el anfitrión mínimo de
Tiqsi, o dentro de una plataforma que lo monte por su manifiesto (como Qillqa).

**Recorrido interactivo:** <https://achalmed.github.io/rimay/> (el código del sitio está en [`sitio/`](sitio/)).

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -e '.[pruebas,sola]'   # requiere tiqsi
.venv/bin/python -m pytest -q tests
npm install && npm run web:construir && npm run web:pruebas
RIMAY_DATABASE_URL=postgresql+asyncpg://…/rimay JWT_SECRET=<32 o más caracteres> RIMAY_WEB=web/dist \
  .venv/bin/uvicorn rimay.sola:app --port 8033
```

Esta es una **versión de demostración**. Licencia: AGPL-3.0 (`LICENSE`).
