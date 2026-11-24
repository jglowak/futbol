// Parte pura del módulo de IA: el prompt y el parseo del JSON que devuelve el modelo.
// Sin dependencias del Worker, para poder testearlo.
import type { RawPlanilla } from './planilla-core';

export const PROMPT = `Sos un lector de "Actas oficiales de encuentro" de la Liga de Fútbol de Florida (fútbol uruguayo).
Transcribí lo que está escrito a mano en la foto y devolvé SOLO un JSON con esta forma exacta:

{
  "header": { "torneo": "", "categoria": "", "campo": "", "rival": "", "club": "", "fecha": "", "condicion": "" },
  "guardameta_numero": null,
  "capitan_numero": null,
  "titulares": [ { "numero": null, "ficha": "", "nombre": "", "apellido": "" } ],
  "suplentes": [ { "numero": null, "ficha": "", "nombre": "", "apellido": "" } ]
}

Reglas:
- La planilla tiene una lista de TITULARES (11) y otra de SUPLENTES. Cada fila: Nº (camiseta), FICHA OFI, NOMBRE, APELLIDO.
- "guardameta_numero" y "capitan_numero" salen de los campos "Guardameta Nº" y "Capitán Nº".
- "condicion": "local" o "visitante" según lo que NO esté tachado en "LOCAL / VISITANTE".
- Si la ficha dice "PROVISORIO" o está vacía, poné "ficha": "".
- IMPORTANTE (privacidad): NO transcribas la columna CÉDULA DE IDENTIDAD. Ignorala por completo. No la incluyas en ningún campo.
- No incluyas al cuerpo técnico (director técnico, médico, etc.), solo jugadores.
- Si un dato es ilegible, dejá el campo vacío. No inventes nombres ni números.
- Respondé únicamente el JSON, sin texto antes ni después.`;

/** Extrae el primer objeto JSON del texto del modelo (tolera ```json o texto suelto). */
export function parseJsonObject(text: string): RawPlanilla {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('El modelo no devolvió JSON');
  return JSON.parse(body.slice(start, end + 1)) as RawPlanilla;
}
