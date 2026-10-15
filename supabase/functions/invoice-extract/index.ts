// Supabase Edge Function: reads a photo or PDF of a supplier invoice and returns its header (supplier,
// number, date, totals and VAT) and its lines, each matched to one of the restaurant's ingredients when
// it clearly is one, with the quantity in a unit we can convert.
//
// Nothing is saved here. The back office shows the result, the owner corrects what is wrong and saves
// the purchase himself (stock, prices and the invoice for the accountant).
//
// Security: only owners/managers of that restaurant may call it (checked by the database with the
// caller's own login), because every call spends AI quota. Key: the server secret GEMINI_API_KEY (the
// same one as the menu import and the briefing).
//
// Deploy: Supabase dashboard > Edge Functions > Deploy a new function > via Editor,
// name "invoice-extract", paste this file, turn "Verify JWT" off (we check it ourselves).
// Optional secret: INVOICE_MODEL.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL = Deno.env.get('INVOICE_MODEL') ?? Deno.env.get('MENU_MODEL') ?? Deno.env.get('BRIEFING_MODEL') ?? 'gemini-3.5-flash';
const MAX_FILES = 5;
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_INGS = 500;
const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const prompt = (ings: string) => `Tu lis une facture ou un bon de livraison d'un fournisseur d'un café ou restaurant au Maroc (photos ou PDF, plusieurs pages possibles d'un même document).
Règles strictes :
- N'invente rien. Ce qui est illisible ou absent vaut null.
- Montants en dirhams, en nombres (ex. 125.5), sans devise.
- "supplier" : le nom du fournisseur tel qu'écrit. "ice" : son ICE (15 chiffres) s'il est écrit.
- "number" : le numéro de la facture ou du bon. "date" : la date du document au format AAAA-MM-JJ.
- "total_ttc" : le total à payer TTC. "total_vat" : le total de la TVA s'il est écrit (sinon null). "total_ht" : le total HT s'il est écrit.
- "lines" : chaque ligne d'article, dans l'ordre. "label" : le libellé tel qu'écrit. "qty" et "unit" : la quantité livrée et son unité, ramenée à l'une de : kg, g, l, cl, ml, pc (pièce, boîte, sachet, bouteille comptés à l'unité). Si le libellé donne un conditionnement (ex. "carton 6 x 1 L", "sac 25 kg"), multiplie pour donner la quantité totale (6 l, 25 kg). "total_ttc" : le montant de la ligne TTC ; si la facture donne les lignes HT avec un taux de TVA, calcule le TTC de la ligne. "vat_rate" : le taux de TVA de la ligne en % s'il est connu.
- "ingredient_id" : choisis dans la liste ci-dessous l'ingrédient du restaurant qui correspond CLAIREMENT à la ligne (même produit, synonymes et langues comprises : "poulet" = "دجاج", "huile de table" = "huile"). En cas de doute, null. Ne mets jamais l'id d'un ingrédient qui n'est pas dans la liste.
- Ignore les lignes de remise, consigne, transport ou sous-total ; ne les mets pas dans "lines".
Ingrédients du restaurant (id | nom | unité de base) :
${ings || '(aucun)'}`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    supplier: { type: 'STRING', nullable: true },
    ice: { type: 'STRING', nullable: true },
    number: { type: 'STRING', nullable: true },
    date: { type: 'STRING', nullable: true },
    total_ht: { type: 'NUMBER', nullable: true },
    total_vat: { type: 'NUMBER', nullable: true },
    total_ttc: { type: 'NUMBER', nullable: true },
    lines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          qty: { type: 'NUMBER', nullable: true },
          unit: { type: 'STRING', enum: ['kg', 'g', 'l', 'cl', 'ml', 'pc'], nullable: true },
          total_ttc: { type: 'NUMBER', nullable: true },
          vat_rate: { type: 'NUMBER', nullable: true },
          ingredient_id: { type: 'STRING', nullable: true },
        },
        required: ['label', 'qty', 'unit', 'total_ttc', 'ingredient_id'],
      },
    },
  },
  required: ['supplier', 'number', 'date', 'total_ttc', 'lines'],
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!KEY) return json({ error: 'ai_not_configured' }, 503);

  const auth = req.headers.get('Authorization') ?? '';
  const body = await req.json().catch(() => ({}));
  const { restaurant_id, files, ingredients } = body as { restaurant_id?: string; files?: { mime: string; data: string }[]; ingredients?: { id: string; name: string; unit: string }[] };
  if (!restaurant_id || !/^Bearer /.test(auth) || !Array.isArray(files) || !files.length) return json({ error: 'invalid_request' }, 400);
  if (files.length > MAX_FILES) return json({ error: 'too_many_files' }, 400);
  let bytes = 0;
  for (const f of files) {
    if (!f || !MIMES.includes(f.mime) || typeof f.data !== 'string') return json({ error: 'bad_file' }, 400);
    bytes += Math.floor(f.data.length * 3 / 4);
  }
  if (bytes > MAX_BYTES) return json({ error: 'too_large' }, 413);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { error } = await db.rpc('can_import_menu', { p_restaurant_id: restaurant_id });
  if (error) return json({ error: error.message.includes('not allowed') ? 'not_allowed' : error.message }, error.message.includes('not allowed') ? 403 : 400);

  // the restaurant's ingredients, cleaned (ids are only accepted back if they were sent)
  const ings = (Array.isArray(ingredients) ? ingredients : []).slice(0, MAX_INGS)
    .filter(g => g && /^[0-9a-f-]{36}$/i.test(String(g.id)))
    .map(g => ({ id: String(g.id), name: String(g.name ?? '').replace(/[\n|]/g, ' ').slice(0, 60), unit: ['g', 'ml', 'pc'].includes(g.unit) ? g.unit : 'pc' }));
  const known = new Set(ings.map(g => g.id));

  let out: Record<string, unknown>;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [...files.map(f => ({ inline_data: { mime_type: f.mime, data: f.data } })), { text: prompt(ings.map(g => `${g.id} | ${g.name} | ${g.unit}`).join('\n')) }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.1, maxOutputTokens: 16384 },
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
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e8 ? v : null);
  const lines = (Array.isArray(out.lines) ? out.lines : []).slice(0, 80).map((l: Record<string, unknown>) => ({
    label: String(l.label ?? '').slice(0, 120),
    qty: num(l.qty), unit: ['kg', 'g', 'l', 'cl', 'ml', 'pc'].includes(String(l.unit)) ? String(l.unit) : null,
    total_ttc: num(l.total_ttc), vat_rate: num(l.vat_rate),
    ingredient_id: known.has(String(l.ingredient_id)) ? String(l.ingredient_id) : null,
  })).filter(l => l.label);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(out.date ?? '')) ? String(out.date) : null;
  return json({
    supplier: out.supplier ? String(out.supplier).slice(0, 80) : null,
    ice: /^\d{15}$/.test(String(out.ice ?? '').replace(/\s/g, '')) ? String(out.ice).replace(/\s/g, '') : null,
    number: out.number ? String(out.number).slice(0, 40) : null,
    date, total_ht: num(out.total_ht), total_vat: num(out.total_vat), total_ttc: num(out.total_ttc),
    lines, model: MODEL,
  });
});
