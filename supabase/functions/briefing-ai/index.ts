// Supabase Edge Function: writes the owner's evening briefing in plain language.
//
// Security: it runs the database function owner_briefing() WITH THE CALLER'S
// OWN LOGIN, so only owners and managers of that restaurant get an answer
// (the database refuses everyone else). The AI key is a server secret, never
// sent to the browser: GEMINI_API_KEY (Google, has a free tier) or
// ANTHROPIC_API_KEY (Claude). If both are set, Gemini is used.
//
// Privacy: staff names and the restaurant name are replaced by neutral labels
// before the figures leave for the AI, and put back in the answer. (Google's
// free tier may use prompts to improve its products; the labels keep people's
// names out of it.)
//
// Reliability: the model receives the exact figures and must not compute new
// ones; it only explains them and proposes actions. No accusations of staff.
//
// Deploy: Supabase dashboard > Edge Functions > Deploy a new function > via Editor,
// name "briefing-ai", paste this file. Secret: Edge Functions > Secrets > GEMINI_API_KEY
// (or ANTHROPIC_API_KEY). Optional: BRIEFING_MODEL.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY');
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('BRIEFING_MODEL') ?? (GEMINI_KEY ? 'gemini-3.5-flash' : 'claude-sonnet-5');
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SYSTEM = {
  fr: `Tu es le conseiller personnel d'un propriétaire de café ou restaurant au Maroc. Tu reçois les chiffres exacts d'une journée, calculés par la caisse.
Règles strictes :
- Utilise UNIQUEMENT les chiffres fournis. N'invente rien, ne recalcule pas de nouveaux totaux. Les montants sont en centimes : divise par 100 et écris "DH".
- Si une donnée manque (stock, coûts, météo...), ne fais pas de supposition.
- Ne jamais accuser un employé de vol ou de fraude. Pour une anomalie, propose de "vérifier" calmement.
- Style : phrases courtes, concrètes, chaleureuses, comme un associé expérimenté. Pas de jargon. Pas de tiret long.
Réponds UNIQUEMENT avec un JSON : {"summary": "3 phrases maximum sur la journée", "actions": ["3 actions concrètes pour demain, les plus utiles d'abord"], "watch": ["0 à 2 points à vérifier, ou tableau vide"]}`,
  ar: `أنت المستشار الشخصي لصاحب مقهى أو مطعم في المغرب. تتلقى الأرقام الدقيقة ليوم واحد، محسوبة من طرف الصندوق.
قواعد صارمة:
- استعمل فقط الأرقام المقدمة. لا تخترع شيئا ولا تحسب مجاميع جديدة. المبالغ بالسنتيم: اقسم على 100 واكتب "درهم".
- إذا كانت معلومة ناقصة (المخزون، التكاليف...) فلا تفترض شيئا.
- لا تتهم أي موظف بالسرقة أو الغش أبدا. عند وجود شيء غير عادي، اقترح "التحقق" بهدوء.
- الأسلوب: جمل قصيرة وعملية وودية، مثل شريك ذي خبرة. بالعربية الفصحى البسيطة.
أجب فقط بـ JSON: {"summary": "3 جمل كحد أقصى عن اليوم", "actions": ["3 إجراءات عملية للغد، الأهم أولا"], "watch": ["0 إلى 2 نقاط للتحقق، أو قائمة فارغة"]}`,
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!GEMINI_KEY && !ANTHROPIC_KEY) return json({ error: 'ai_not_configured' }, 503);

  const auth = req.headers.get('Authorization') ?? '';
  const { restaurant_id, business_date = null, lang = 'fr' } = await req.json().catch(() => ({}));
  if (!restaurant_id || !/^Bearer /.test(auth)) return json({ error: 'invalid_request' }, 400);

  // the caller's own rights decide what can be read
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: facts, error } = await db.rpc('owner_briefing', { p_restaurant_id: restaurant_id, p_business_date: business_date });
  if (error) return json({ error: error.message }, error.message.includes('not allowed') ? 403 : 400);

  // pseudonymise: people's names never leave, labels come back and are replaced
  const names = new Map<string, string>();
  const staff = (facts.staff ?? []).map((s: { name: string | null }, i: number) => {
    const label = `EMPLOYE_${i + 1}`;
    if (s.name) names.set(label, s.name);
    return { ...s, name: label, staff_id: undefined };
  });
  const anon = { ...facts, restaurant: undefined, staff, today: { ...facts.today, by_staff: undefined }, last_week: { ...facts.last_week, by_staff: undefined } };
  const unmask = (x: string) => x.replace(/EMPLOYE_\d+/g, m => names.get(m) ?? m);

  const l = lang === 'ar' ? 'ar' : 'fr';
  const prompt = `Chiffres de la journée (JSON). Les employés sont désignés par EMPLOYE_1, EMPLOYE_2... : garde exactement ces libellés dans ta réponse.\n${JSON.stringify(anon)}`;
  let text = '';
  try {
    text = GEMINI_KEY ? await gemini(SYSTEM[l], prompt) : await claude(SYSTEM[l], prompt);
  } catch (e) {
    return json({ error: 'ai_failed', detail: String(e).slice(0, 200) }, 502);
  }
  const m = text.match(/\{[\s\S]*\}/);
  try {
    const parsed = JSON.parse(m ? m[0] : text);
    return json({
      summary: unmask(String(parsed.summary ?? '')),
      actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 3).map((x: unknown) => unmask(String(x))) : [],
      watch: Array.isArray(parsed.watch) ? parsed.watch.slice(0, 2).map((x: unknown) => unmask(String(x))) : [],
      business_date: facts.business_date, model: MODEL,
    });
  } catch {
    return json({ error: 'ai_bad_format' }, 502);
  }
});

async function gemini(system: string, prompt: string): Promise<string> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': GEMINI_KEY!, 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 1024, temperature: 0.4 },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status} ${(await res.text()).slice(0, 150)}`);
  const out = await res.json();
  return (out?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
}

async function claude(system: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 700, system, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`claude ${res.status}`);
  const out = await res.json();
  return out?.content?.[0]?.text ?? '';
}
