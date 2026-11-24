import type { APIRoute } from 'astro';
import { adminMatch } from '../../../../../lib/admin';
import { savePlanillaLineup } from '../../../../../lib/players';
import { toShirt, type PlanillaPlayer } from '../../../../../lib/planilla-core';

// Guarda la alineación revisada. Recibe JSON { side, players } ya corregido por Jorge.
export const POST: APIRoute = async ({ params, request, locals }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Origen no permitido' }, 403);

  const id = Number(params.id);
  const match = Number.isInteger(id) ? await adminMatch(id) : null;
  if (!match) return json({ error: 'Partido no encontrado' }, 404);

  let data: { side?: string; players?: unknown[] };
  try {
    data = (await request.json()) as typeof data;
  } catch {
    return json({ error: 'Datos inválidos' }, 400);
  }
  const clubId = data.side === 'away' ? match.away_id : data.side === 'home' ? match.home_id : null;
  if (clubId == null) return json({ error: 'Falta indicar si es el equipo local o visitante.' }, 400);

  const players = coercePlayers(data.players);
  if (!players.length) return json({ error: 'La alineación quedó vacía.' }, 400);

  const result = await savePlanillaLineup({ matchId: id, clubId, players }, locals.session?.user ?? 'desconocido');
  if (!result.ok) return json({ error: result.error }, 400);
  return json({ ok: true, created: result.created, linked: result.linked, total: result.total });
};

/** Sanea lo que llega del navegador a PlanillaPlayer confiable. */
function coercePlayers(input: unknown): PlanillaPlayer[] {
  if (!Array.isArray(input)) return [];
  const out: PlanillaPlayer[] = [];
  for (const r of input) {
    const o = r as Record<string, unknown>;
    const fullName = String(o.fullName ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!fullName) continue;
    const ficha = o.fichaOficial == null ? null : String(o.fichaOficial).replace(/\D+/g, '') || null;
    out.push({
      shirtNumber: toShirt(o.shirtNumber),
      fichaOficial: ficha,
      fullName,
      isStarter: Boolean(o.isStarter),
      isGoalkeeper: Boolean(o.isGoalkeeper),
      isCaptain: Boolean(o.isCaptain),
      provisional: ficha === null,
    });
  }
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
