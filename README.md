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

## Fixture desde el panel

`/admin/torneos` → torneo → fechas con enlace a **editar** cada partido (etapa, serie, fecha, clubes, día/hora en
hora de Uruguay, cancha, borrar). Formulario de **nuevo partido** al pie. Una etapa sin partidos ofrece
**generar fixture** (todos contra todos, una rueda o ida y vuelta, por serie). Las URLs públicas de los partidos
usan nombres y fecha (`/partido/candil-vs-alianza-14-11-2026`); los enlaces numéricos redirigen.

Para volver los resultados al estado importado de AnWP después de hacer pruebas:
`npx wrangler d1 execute futbol-db --remote --file=scripts/reset-resultados.sql`.

## Motor de fases y cierre de temporada

`src/lib/phases-core.ts` (puro, con tests) resuelve **llaves** cuyos participantes son referencias
("1° de la tabla X", "ganador de la llave Y") y que pueden tener una **condición** para jugarse. La temporada 2026
tiene: semifinales y final del Clausura, y las tres finales posibles del art. 5 (B, C y D). `docs/reglamento-divisional-a-2026.md`
resume las reglas. Igualdades que el reglamento resuelve con partido extra, fair play o sorteo se cargan como
**desempate manual** de la tabla (panel → torneo → "Desempates de tabla").

Panel: `/admin/torneos/[id]` muestra las llaves y permite crear su partido cuando está lista; `/admin/temporada/[id]`
muestra campeones, descensos, cupos OFI y el **cierre** (registra títulos en el palmarés; reversible).
Público: llave en `/torneo/[slug]`, página de club en `/club/[slug]`, zona de descenso en la Tabla Anual.

## Clubes, temporadas y plantillas de torneo

- `/admin/clubes`: alta y edición de clubes (escudo por archivo o URL, guardado en R2).
- `/admin/temporadas`: alta de temporadas (descensos y cupos OFI) y, dentro de cada una, **plantillas**:
  - **LFF Apertura/Clausura** (12 clubes): crea Apertura, Clausura (series + semifinales + final), la definición
    de temporada (finales B/C/D del art. 5) y las cuatro tablas. Al cerrar el Apertura, el botón **Armar series**
    del Clausura aplica el art. 4 (Serie A = 1°, 4°, 5°, 7°, 9°, 11°) y genera el fixture con el **modelo OFI para
    seis** (`src/lib/templates-core.ts`, deducido del fixture oficial 2026 y verificado contra él) con localías
    invertidas respecto del Apertura.
  - **Copa eliminatoria** (2 a 32 clubes, potencia de 2): llaves encadenadas hasta la final.
  - **Liga simple**: una tabla, fixture generable.

## Histórico de AnWP

`scripts/import-anwp-history.mjs` genera `db/import-history.sql` (idempotente) a partir de los exports XML de
WordPress: clubes unificados (`club_legacy_ids` guarda todos los IDs viejos), cancha habitual desde los estadios,
competiciones → torneos/etapas (`source = 'anwp'`) y tablas finales como **tablas históricas** (totales en
`standing_adjustments`, con `snapshot: true` en la config). Se ejecuta desde el panel: Herramientas →
"Importar histórico de AnWP". `docs/importacion-anwp-informe.md` lista las unificaciones y los probables campeones.
Los partidos con resultado vienen de la tabla `wp_anwpfl_matches` (volcado SQL parseado a `data/anwp/matches.json`):
1.054 partidos y 3.106 eventos (goles, tarjetas, cambios; `legacy_player_ref` guarda el jugador de AnWP para
enlazarlo cuando se importen los jugadores). Con los partidos cargados, las tablas históricas dejan de ser
congeladas: las 65 se verificaron idénticas a las de AnWP.

## Próximos pasos

- Panel: goleadores y tarjetas por partido (eventos), colaboradores con acceso a un solo partido.
- Copas con cantidad de clubes que no sea potencia de 2 (byes) e ida y vuelta en llaves.
- Jugadores (export de AnWP) para goleadores históricos; palmarés confirmado por Jorge.
- Alineaciones y goles desde la planilla (foto → IA → revisión).
