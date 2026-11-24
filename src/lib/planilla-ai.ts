// Lectura de la planilla con un modelo de visión. Proveedor configurable (Claude o Gemini) para
// poder cambiar sin tocar el resto. Devuelve la lectura CRUDA; planilla-core la normaliza.
//
// Config por variables de entorno del Worker (secretos):
//   PLANILLA_AI_PROVIDER = 'anthropic' | 'gemini'   (default: 'anthropic')
//   PLANILLA_AI_MODEL    = id del modelo            (default según proveedor)
//   ANTHROPIC_API_KEY / GEMINI_API_KEY              (la clave del proveedor elegido)
//
// La imagen llega ya reducida desde el navegador (como los escudos), así que acá no se procesa:
// solo se reenvía. Igual se controla un tope de tamaño por las dudas.
import { env } from 'cloudflare:workers';
import type { RawPlanilla } from './planilla-core';
import { PROMPT, parseJsonObject } from './planilla-ai-core';

export { parseJsonObject } from './planilla-ai-core';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB: una foto reducida entra holgada

type Provider = 'anthropic' | 'gemini';

export interface PlanillaAiConfig {
  provider: Provider;
  model: string;
  apiKey: string;
}

/** Lee la config del entorno. Devuelve null si falta la clave (el panel lo avisa). */
export function planillaAiConfig(): PlanillaAiConfig | null {
  const e = env as unknown as Record<string, string | undefined>;
  const provider: Provider = e.PLANILLA_AI_PROVIDER === 'gemini' ? 'gemini' : 'anthropic';
  const apiKey = provider === 'gemini' ? e.GEMINI_API_KEY : e.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = e.PLANILLA_AI_MODEL || (provider === 'gemini' ? 'gemini-2.5-flash' : 'claude-sonnet-5-5');
  return { provider, model, apiKey };
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

async function callAnthropic(image: { data: string; mime: string }, cfg: PlanillaAiConfig): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.data } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Claude respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = json.content?.find((c) => c.type === 'text')?.text;
  if (!text) throw new Error('Claude no devolvió texto');
  return text;
}

async function callGemini(image: { data: string; mime: string }, cfg: PlanillaAiConfig): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent?key=${cfg.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: image.mime, data: image.data } },
            { text: PROMPT },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
  if (!text) throw new Error('Gemini no devolvió texto');
  return text;
}

/** Lee la planilla de una foto y devuelve la transcripción cruda (sin normalizar). */
export async function extractPlanilla(
  image: { bytes: ArrayBuffer; mime: string },
  cfg: PlanillaAiConfig,
): Promise<RawPlanilla> {
  if (image.bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('La imagen es demasiado grande; reducila antes de subir.');
  const mime = ['image/jpeg', 'image/png', 'image/webp'].includes(image.mime) ? image.mime : 'image/jpeg';
  const payload = { data: toBase64(image.bytes), mime };
  const text = cfg.provider === 'gemini' ? await callGemini(payload, cfg) : await callAnthropic(payload, cfg);
  return parseJsonObject(text);
}
