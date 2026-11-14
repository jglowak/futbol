# futbol

Sistema de resultados, tablas y fixture para el fútbol del interior (Astro + Cloudflare Workers + D1).

> Estado: **paso 1** — esquema de datos, cálculo de tablas y páginas públicas con datos de ejemplo.
> Los clubes y resultados del seed son **ficticios**.

## Estructura

- `db/migrations/` — esquema de la base (D1).
- `db/seed.sql` — datos de ejemplo (Apertura, Clausura y Tabla Anual de demo).
- `src/lib/standings.ts` — cálculo de tablas (módulo puro, con tests).
- `src/lib/db.ts` — consultas a D1.
- `src/pages/` — portada, `/torneo/[slug]`, `/tabla/[slug]`.

## Modelo en una línea

Torneo → etapas (liga / grupos / eliminatoria) → partidos. Una **tabla de posiciones** es una vista
configurable sobre una o varias etapas (`standing_tables` + `standing_table_sources`), con ajustes
manuales y motivo (`standing_adjustments`). Por eso "Anual = Apertura + Clausura" no es un caso especial.

**Privacidad:** no se guardan cédulas de identidad ni fechas de nacimiento. Los jugadores se identifican por su ficha oficial.
No subir al repo datos reales de jugadores ni fotos de menores.

## Desarrollo local

```bash
npm install
npm run db:migrate:local      # crea las tablas en la D1 local
npm run db:seed:local         # carga datos de ejemplo
npm run dev                   # http://localhost:4321
npm test                      # tests del cálculo de tablas
```

## Deploy en Cloudflare (primera vez)

1. Crear la base: `npx wrangler d1 create futbol-db` y pegar el `database_id` en `wrangler.jsonc`.
2. Aplicar el esquema: `npm run db:migrate:remote`.
3. (Solo para la demo) cargar ejemplo: `npx wrangler d1 execute futbol-db --remote --file=./db/seed.sql`.
4. Conectar el repo al proyecto `futbol` en Cloudflare:
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
5. Agregar el dominio de prueba al proyecto.

Las páginas llevan `noindex` mientras sea una prueba: quitarlo en `src/layouts/Base.astro` al pasar a producción.

## Próximos pasos

- Panel de carga de resultados (PWA, mobile-first) con autenticación.
- Plantillas de torneo (Apertura/Clausura, copa eliminatoria) y motor de etapas condicionales.
- Alineaciones y goles desde la planilla (foto → IA → revisión).
