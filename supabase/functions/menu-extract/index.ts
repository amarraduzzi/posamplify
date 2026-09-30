// Supabase Edge Function: reads a photo or PDF of a paper menu and returns the
// dishes as structured rows, so a new restaurant does not type its menu again.
//
// Nothing is saved here. The back office shows the result for checking and the
// owner imports it himself (database function import_menu).
//
// Security: only owners/managers of that restaurant may call it (checked by the
// database with the caller's own login), because every call spends AI quota.
// The key is a server secret: GEMINI_API_KEY (same one as the briefing).
// A menu is public information, no personal data is sent.
//
// Deploy: Supabase dashboard > Edge Functions > Deploy a new function > via Editor,
// name "menu-extract", paste this file, turn "Verify JWT" off (we check it ourselves).
// Optional secret: MENU_MODEL.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL = Deno.env.get('MENU_MODEL') ?? Deno.env.get('BRIEFING_MODEL') ?? 'gemini-3.5-flash';
const MAX_FILES = 6;
const MAX_BYTES = 12 * 1024 * 1024; // all files together, after base64 decoding
const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const PROMPT = `Tu lis la carte (menu) d'un café ou restaurant au Maroc, à partir de photos ou d'un PDF.
Recopie TOUS les articles avec leur prix, dans l'ordre de la carte.
Règles strictes :
- N'invente aucun article et aucun prix. Si un prix est illisible ou absent, mets null.
- Les prix sont en dirhams (DH/MAD). Donne un nombre (ex. 25 ou 12.5), sans devise.
- Si un article a plusieurs tailles ou formules avec des prix différents (Petit/Grand, S/M/L, 1 pers./2 pers., Verre/Bouteille), mets-les dans "variants" et laisse "price" à null.
- Garde les catégories de la carte (Boissons chaudes, Pizzas, Desserts...). Si la carte n'en a pas, regroupe logiquement.
- Donne chaque nom en français (fr), en arabe (ar) et en anglais (en). Garde l'orthographe de la carte pour la langue d'origine, traduis les autres simplement. Les noms propres de plats (Tajine, Pastilla, Harira...) restent tels quels en fr et en.
- "description" : seulement si la carte en donne une (ingrédients...), sinon chaîne vide. Ne traduis pas la description, garde-la dans la langue de la carte.
- "icon" : un seul emoji adapté à la catégorie. "station" : "bar" pour les boissons, sinon "kitchen".
- Si les photos se chevauchent, ne répète pas un article deux fois.`;

const I18N = {
  type: 'OBJECT',
  properties: { fr: { type: 'STRING' }, ar: { type: 'STRING' }, en: { type: 'STRING' } },
  required: ['fr', 'ar', 'en'],
};
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    categories: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: I18N,
          icon: { type: 'STRING' },
          station: { type: 'STRING', enum: ['kitchen', 'bar'] },
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                name: I18N,
                description: { type: 'STRING' },
                price: { type: 'NUMBER', nullable: true },
                variants: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: { name: I18N, price: { type: 'NUMBER', nullable: true } },
                    required: ['name', 'price'],
                  },
                },
              },
              required: ['name', 'price'],
            },
          },
        },
        required: ['name', 'items'],
      },
    },
  },
  required: ['categories'],
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!KEY) return json({ error: 'ai_not_configured' }, 503);

  const auth = req.headers.get('Authorization') ?? '';
  const body = await req.json().catch(() => ({}));
  const { restaurant_id, files } = body as { restaurant_id?: string; files?: { mime: string; data: string }[] };
  if (!restaurant_id || !/^Bearer /.test(auth) || !Array.isArray(files) || !files.length) return json({ error: 'invalid_request' }, 400);
  if (files.length > MAX_FILES) return json({ error: 'too_many_files' }, 400);
  let bytes = 0;
  for (const f of files) {
    if (!f || !MIMES.includes(f.mime) || typeof f.data !== 'string') return json({ error: 'bad_file' }, 400);
    bytes += Math.floor(f.data.length * 3 / 4);
  }
  if (bytes > MAX_BYTES) return json({ error: 'too_large' }, 413);

  // the caller's own rights decide (owners and managers of this restaurant)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { error } = await db.rpc('can_import_menu', { p_restaurant_id: restaurant_id });
  if (error) return json({ error: error.message.includes('not allowed') ? 'not_allowed' : error.message }, error.message.includes('not allowed') ? 403 : 400);

  let out: unknown;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [...files.map(f => ({ inline_data: { mime_type: f.mime, data: f.data } })), { text: PROMPT }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.1, maxOutputTokens: 32768 },
      }),
    });
    if (!res.ok) {
      const t = (await res.text()).slice(0, 200);
      return json({ error: res.status === 429 ? 'ai_busy' : 'ai_failed', detail: `gemini ${res.status} ${t}` }, res.status === 429 ? 429 : 502);
    }
    const g = await res.json();
    const text = (g?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
    const m = text.match(/\{[\s\S]*\}/);
    out = JSON.parse(m ? m[0] : text);
  } catch (e) {
    return json({ error: 'ai_failed', detail: String(e).slice(0, 200) }, 502);
  }
  const cats = (out as { categories?: unknown[] })?.categories;
  if (!Array.isArray(cats)) return json({ error: 'ai_bad_format' }, 502);
  return json({ categories: cats, model: MODEL });
});
