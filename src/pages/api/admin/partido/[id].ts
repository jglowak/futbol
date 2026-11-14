import type { APIRoute } from 'astro';
import { performAction, type Action } from '../../../../lib/admin';

function parseAction(form: FormData): Action | null {
  const a = String(form.get('action') ?? '');
  switch (a) {
    case 'home_plus':
      return { type: 'goal', side: 'home', delta: 1 };
    case 'home_minus':
      return { type: 'goal', side: 'home', delta: -1 };
    case 'away_plus':
      return { type: 'goal', side: 'away', delta: 1 };
    case 'away_minus':
      return { type: 'goal', side: 'away', delta: -1 };
    case 'live':
    case 'finished':
    case 'scheduled':
    case 'postponed':
      return { type: 'status', status: a };
    case 'minute': {
      const raw = String(form.get('minute') ?? '').trim();
      if (raw === '') return { type: 'minute', minute: null };
      const n = Number(raw);
      return Number.isInteger(n) && n >= 0 && n <= 130 ? { type: 'minute', minute: n } : null;
    }
    case 'pens': {
      const n = (k: string) => { const raw = String(form.get(k) ?? '').trim(); if (raw === '') return null; const v = Number(raw); return Number.isInteger(v) && v >= 0 && v <= 30 ? v : NaN; };
      const home = n('home_pens'), away = n('away_pens');
      if (Number.isNaN(home) || Number.isNaN(away)) return null;
      return { type: 'pens', home, away };
    }
    case 'undo':
      return { type: 'undo' };
    default:
      return null;
  }
}

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return new Response('ID inválido', { status: 400 });

  // Defensa contra envíos desde otros sitios: el origen debe ser el propio.
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Origen no permitido', { status: 403 });

  const form = await request.formData();
  const action = parseAction(form);
  if (!action) return new Response('Acción inválida', { status: 400 });

  const result = await performAction(id, action, locals.session?.user ?? 'desconocido');
  if (!result) return new Response('Partido no encontrado', { status: 404 });

  if (request.headers.get('accept')?.includes('application/json')) {
    return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
  }
  return redirect(`/admin/partido/${id}`, 303);
};
