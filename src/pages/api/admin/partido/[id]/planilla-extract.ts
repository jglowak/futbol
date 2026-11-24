import type { APIRoute } from 'astro';
import { adminMatch } from '../../../../../lib/admin';
import { extractPlanilla, planillaAiConfig } from '../../../../../lib/planilla-ai';
import { normalizePlanilla } from '../../../../../lib/planilla-core';

// Lee la foto de una planilla con la IA y devuelve la propuesta normalizada (para revisar).
// No guarda nada: eso lo hace planilla-guardar tras la revisión de Jorge.
export const POST: APIRoute = async ({ params, request }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Origen no permitido' }, 403);

  const id = Number(params.id);
  const match = Number.isInteger(id) ? await adminMatch(id) : null;
  if (!match) return json({ error: 'Partido no encontrado' }, 404);

  const cfg = planillaAiConfig();
  if (!cfg) return json({ error: 'Falta configurar la clave de la IA (ANTHROPIC_API_KEY o GEMINI_API_KEY) en el Worker.' }, 503);

  const form = await request.formData();
  const file = form.get('image');
  if (!(file instanceof File) || file.size === 0) return json({ error: 'Subí una foto de la planilla.' }, 400);
  if (file.size > 4 * 1024 * 1024) return json({ error: 'La foto es muy pesada; se reduce sola, probá de nuevo.' }, 400);

  try {
    const raw = await extractPlanilla({ bytes: await file.arrayBuffer(), mime: file.type || 'image/jpeg' }, cfg);
    const normalized = normalizePlanilla(raw);
    return json({ ok: true, ...normalized });
  } catch (e) {
    return json({ error: `No se pudo leer la planilla: ${(e as Error).message}` }, 502);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
