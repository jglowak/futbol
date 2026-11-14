# futbol

Sistema de resultados, tablas y fixture para el fútbol del interior (Astro + Cloudflare Workers + D1).

> Estado: esquema de datos, cálculo de tablas y páginas públicas con los **datos reales de la temporada 2026**
> de la Liga de Fútbol de Florida (Apertura completo + Clausura en curso), importados desde AnWP.

## Estructura

- `db/migrations/` — esquema de la base (D1).
- `db/seed-2026.sql` — temporada 2026 generada por `scripts/import-anwp.mjs` desde los exports de AnWP (`data/anwp/`).
  Regenerar: `node scripts/import-anwp.mjs --clubs <clubes.xml> --apertura data/anwp/apertura-2026-games.csv --clausura data/anwp/clausura-2026-games.csv > db/seed-2026.sql`
  (el XML de clubes no está en el repo).
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

1. ~~Crear la base~~ — hecho: `futbol-db` ya existe y su `database_id` está en `wrangler.jsonc`.
2. ~~Aplicar el esquema~~ — hecho (migración `0001_init.sql` registrada como aplicada). Las próximas: `npm run db:migrate:remote`.
3. ~~Datos~~ — la temporada 2026 ya está cargada en la base remota.
4. Conectar el repo al proyecto `futbol` en Cloudflare:
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
5. Agregar el dominio de prueba al proyecto.

Las páginas llevan `noindex` mientras sea una prueba: quitarlo en `src/layouts/Base.astro` al pasar a producción.

## Panel de carga (`/admin`)

Pensado para el celular: lista de partidos (en juego, hoy, próximos, últimos) y, por partido,
botones de gol (+1/−1), estado (Programado / En vivo / Final / Postergado), minuto opcional y
**Deshacer**. Cada cambio queda en `audit_log` con antes/después y autor.

Acceso (en este orden):
1. **Cloudflare Access**, si están definidos `CF_ACCESS_TEAM_DOMAIN` (ej. `miequipo.cloudflareaccess.com`)
   y `CF_ACCESS_AUD` (el Application Audience tag): se verifica el JWT de Access.
2. **Clave de administrador**: secreto `ADMIN_PASSWORD` en el Worker → login en `/admin/login`,
   cookie firmada por 30 días (`ADMIN_SESSION_SECRET` opcional para firmar con otro valor).

Sin ninguna de las dos, el panel queda cerrado. En local: `.dev.vars` con `ADMIN_PASSWORD=...`.
Las páginas públicas se actualizan en ~20 s (caché de borde).

## Próximos pasos

- Panel: goleadores y tarjetas por partido (eventos), colaboradores con acceso a un solo partido.
- Plantillas de torneo (Apertura/Clausura, copa eliminatoria) y motor de etapas condicionales.
- Alineaciones y goles desde la planilla (foto → IA → revisión).
