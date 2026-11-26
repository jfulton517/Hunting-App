// Supabase Edge Function: "Ask the coach" — answers a hunter's in-the-moment question with
// the live hunt situation (time, phase, weather, stand, recent events) as context.
// Part of the optional AI upgrade; the Anthropic API key stays in Supabase secrets.
import Anthropic from 'npm:@anthropic-ai/sdk@1.14.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';

const TIERS = {
  basic: { model: 'claude-haiku-5-5' },
  pro: { model: 'claude-opus-5-5' },
} as const;
type Tier = keyof typeof TIERS;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SYSTEM = `You are an experienced whitetail deer and wild turkey hunting guide coaching a hunter in real time through a phone app while they sit in the woods.
The live situation (time, hunt phase, weather and wind, stand, season phase, what they've seen) is provided with each question.
- Answer in 2–5 short sentences or a few bullet points. They are reading on a phone, often in low light. Lead with the action to take right now.
- Be specific: which call, how loud, how long and how often; whether to stay, move and where; how to play the wind and thermals; scent control; decoy and attractant placement.
- Use the situation data. If the wind is wrong for their stand or a buck is in sight, address that first.
- Ethics and safety come first: harness in tree stands, positive target identification, legal shooting light, and blood-trailing advice after a shot.
- Hunting laws vary by state (baiting, scents, electronic calls, legal hours). When a tactic might be restricted, say to check their state regulations. Never claim a specific state's rule.
- If you don't know, say so briefly. Don't invent facts about their property.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY secret is not set in Supabase' }, 500);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Not signed in' }, 401);

  let body: { tier?: string; question?: string; situation?: string; history?: { q: string; a: string }[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const question = (body.question ?? '').trim().slice(0, 1000);
  if (!question) return json({ error: 'Ask a question' }, 400);
  const situation = (body.situation ?? '').slice(0, 6000);
  const tier: Tier = body.tier === 'basic' ? 'basic' : 'pro';
  const history = (body.history ?? []).slice(-4);

  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const h of history) {
    messages.push({ role: 'user', content: String(h.q).slice(0, 1000) });
    messages.push({ role: 'assistant', content: String(h.a).slice(0, 2000) });
  }
  messages.push({ role: 'user', content: `Current situation:\n${situation}\n\nQuestion: ${question}` });

  const client = new Anthropic({ apiKey });
  try {
    const request = {
      model: TIERS[tier].model,
      max_tokens: 16000,
      output_config: { effort: 'low' as const },
      system: SYSTEM,
      messages,
    };
    const response =
      tier === 'pro'
        ? await client.beta.messages.create({ ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : await client.beta.messages.create(request);
    if (response.stop_reason === 'refusal') return json({ error: "The coach can't help with that one." }, 422);
    const answer = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n')
      .trim();
    if (!answer) return json({ error: 'No answer returned; try again' }, 502);
    return json({ answer, model: response.model });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'Too many questions at once; try again in a minute' }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'The Anthropic API key is invalid' }, 500);
    if (e instanceof Anthropic.APIError) return json({ error: `AI service error (${e.status})` }, 502);
    return json({ error: 'Unexpected error' }, 500);
  }
});
