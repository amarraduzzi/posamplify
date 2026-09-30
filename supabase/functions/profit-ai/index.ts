// Supabase Edge Function (Amplify Profit): proposes a standard recipe card per
// dish, with usual quantities per portion and an ESTIMATED Moroccan purchase
// price per ingredient. Nothing is saved here: the owner checks the proposal
// and saves it himself (database function apply_recipe_suggestions), where the
// prices are marked "prix estimé" until confirmed.
//
// Security: owners/managers of that restaurant only (checked by the database
// with the caller's own login). Dish names are not personal data.
// Deploy: Edge Functions > Deploy a new function > Via Editor, name "profit-ai",
// paste this file, turn "Verify JWT" off (checked here). Uses GEMINI_API_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL = Deno.env.get('PROFIT_MODEL') ?? Deno.env.get('BRIEFING_MODEL') ?? 'gemini-3.5-flash';
const MAX_DISHES = 12;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const PROMPT = `Tu es chef et contrôleur de gestion pour des cafés et restaurants au Maroc.
Pour chaque plat de la liste, propose la fiche technique standard d'UNE portion, telle qu'on la sert habituellement au Maroc.
Règles :
- Seulement les ingrédients qui coûtent de l'argent (pas l'eau du robinet). Regroupe les épices en un seul ingrédient "Épices" si elles sont nombreuses.
- Quantités réalistes par portion. base_unit : "g" (solides), "ml" (liquides) ou "pc" (pièces : œuf, pain, sachet de thé, canette).
- Réutilise EXACTEMENT les noms de la liste "ingrédients existants" quand c'est le même produit.
- Nom de l'ingrédient en français (name) et en arabe marocain simple (name_ar).
- Prix d'achat ESTIMÉ au Maroc en 2026, en dirhams, prix grossiste ou souk pour un restaurant : purchase_unit ("kg", "litre", "pièce", "botte", "douzaine"...), purchase_qty = nombre de base_unit dans cette unité (kg = 1000 g, litre = 1000 ml, douzaine = 12 pc), price_dh = prix de cette unité. Sois réaliste, pas optimiste.
- Si un plat a une taille (variante), adapte les quantités à cette taille.
- category parmi : legumes, fruits, viande, poisson, laitier, epicerie, boissons, boulangerie, emballage, autre.
- Pour une boisson industrielle (Coca, eau en bouteille), une seule ligne : la bouteille/canette en "pc".
Réponds uniquement avec le JSON demandé, un élément par "key" reçu.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    dishes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          key: { type: 'STRING' },
          lines: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' }, name_ar: { type: 'STRING' },
                category: { type: 'STRING' },
                base_unit: { type: 'STRING', enum: ['g', 'ml', 'pc'] },
                qty: { type: 'NUMBER' },
                purchase_unit: { type: 'STRING' }, purchase_qty: { type: 'NUMBER' }, price_dh: { type: 'NUMBER' },
              },
              required: ['name', 'base_unit', 'qty', 'purchase_unit', 'purchase_qty', 'price_dh'],
            },
          },
        },
        required: ['key', 'lines'],
      },
    },
  },
  required: ['dishes'],
};

// quick answers: recipes need common sense, not long reasoning
const THINK = { thinkingConfig: { thinkingLevel: 'low' } };
function call(prompt: string, think: boolean) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': KEY!, 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.2, maxOutputTokens: 12000, ...(think ? THINK : {}) },
    }),
  });
}

type Dish = { key: string; name: string; variant?: string; category?: string; description?: string; price_dh?: number };

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!KEY) return json({ error: 'ai_not_configured' }, 503);

  const auth = req.headers.get('Authorization') ?? '';
  const body = await req.json().catch(() => ({}));
  const { restaurant_id, dishes, ingredients } = body as { restaurant_id?: string; dishes?: Dish[]; ingredients?: string[] };
  if (!restaurant_id || !/^Bearer /.test(auth) || !Array.isArray(dishes) || !dishes.length) return json({ error: 'invalid_request' }, 400);
  if (dishes.length > MAX_DISHES) return json({ error: 'too_many_dishes' }, 400);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { error } = await db.rpc('can_import_menu', { p_restaurant_id: restaurant_id });
  if (error) return json({ error: error.message.includes('not allowed') ? 'not_allowed' : error.message }, error.message.includes('not allowed') ? 403 : 400);

  const clean = dishes.map(d => ({
    key: String(d.key).slice(0, 80), name: String(d.name ?? '').slice(0, 80), variant: d.variant ? String(d.variant).slice(0, 60) : undefined,
    category: d.category ? String(d.category).slice(0, 60) : undefined, description: d.description ? String(d.description).slice(0, 300) : undefined,
    price_dh: typeof d.price_dh === 'number' ? d.price_dh : undefined,
  }));
  const known = (Array.isArray(ingredients) ? ingredients : []).slice(0, 300).map(x => String(x).slice(0, 80));
  const prompt = `${PROMPT}\n\nIngrédients existants : ${JSON.stringify(known)}\n\nPlats :\n${JSON.stringify(clean)}`;

  try {
    let res = await call(prompt, true);
    // a model that does not know the "thinking" setting: ask again without it
    if (res.status === 400 && /thinking/i.test(await res.clone().text())) res = await call(prompt, false);
    if (!res.ok) {
      const t = (await res.text()).slice(0, 200);
      return json({ error: res.status === 429 ? 'ai_busy' : 'ai_failed', detail: `gemini ${res.status} ${t}` }, res.status === 429 ? 429 : 502);
    }
    const g = await res.json();
    const text = (g?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
    const m = text.match(/\{[\s\S]*\}/);
    const out = JSON.parse(m ? m[0] : text);
    if (!Array.isArray(out?.dishes)) return json({ error: 'ai_bad_format' }, 502);
    return json({ dishes: out.dishes, model: MODEL });
  } catch (e) {
    return json({ error: 'ai_failed', detail: String(e).slice(0, 200) }, 502);
  }
});
