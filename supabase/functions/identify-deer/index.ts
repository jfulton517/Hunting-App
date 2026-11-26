// Supabase Edge Function: identify the deer in a trail-camera photo with Claude.
//
// The Anthropic API key is stored as a Supabase secret (ANTHROPIC_API_KEY) and never
// reaches the browser. Photos are read with the caller's own login, so row-level
// security guarantees a user can only analyze their own pictures.
import Anthropic from 'npm:@anthropic-ai/sdk@1.14.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';

// Upgrade levels chosen in the app. Basic is a low-cost sorter; Pro does careful buck matching.
const TIERS = {
  basic: { model: 'claude-haiku-5-5', maxReferencePhotos: 3 },
  pro: { model: 'claude-opus-5-5', maxReferencePhotos: 6 },
} as const;
type Tier = keyof typeof TIERS;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

interface Candidate {
  id: string;
  name: string;
  description: string;
  points: number | null;
  age_class: string;
  reference_photo_path: string | null;
}

const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] });

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    primary_kind: { type: 'string', enum: ['buck', 'doe', 'fawn', 'turkey', 'other', 'none'] },
    deer_count: { type: 'integer' },
    buck_description: { type: 'string' },
    points_estimate: nullable('integer'),
    age_class: { type: 'string', enum: ['young', 'mid-age', 'mature', 'unknown'] },
    match_deer_id: nullable('string'),
    match_confidence: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
    match_reasoning: { type: 'string' },
    is_new_buck: { type: 'boolean' },
    stamp_datetime: nullable('string'),
    stamp_temperature_f: nullable('number'),
    summary: { type: 'string' },
  },
  required: [
    'primary_kind', 'deer_count', 'buck_description', 'points_estimate', 'age_class', 'match_deer_id',
    'match_confidence', 'match_reasoning', 'is_new_buck', 'stamp_datetime', 'stamp_temperature_f', 'summary',
  ],
  additionalProperties: false,
};

const SYSTEM = `You help a deer hunter catalog trail-camera photos from Browning cameras.
For the photo to analyze:
- Identify the main animal: buck (antlered deer), doe, fawn, turkey, other, or none (empty frame, false trigger).
- For a buck, describe the antlers precisely enough to recognize him again: frame shape, estimated points, brow tines, G2/G3 length, kickers, split or broken tines, drop tines, spread relative to the ears; plus body features (age class from body shape, scars, ear notches).
- Compare against the hunter's known deer (reference photos and descriptions are provided). Only report a match when antler features genuinely agree; antlers look different from different angles, so say "low" or "none" when unsure rather than guessing. Never match a buck to a deer whose reference shows a clearly different frame.
- Set is_new_buck to true only for an antlered buck that matches none of the known deer.
- Browning photos usually have an info strip along the bottom with the date, time and temperature. Read it if present: stamp_datetime as "YYYY-MM-DDTHH:MM" (24-hour, local time as printed), stamp_temperature_f in °F. Use null if not legible.
- Night infrared photos are grayscale; that is normal.
Keep summary to one short sentence.`;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY secret is not set in Supabase' }, 500);

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Not signed in' }, 401);

  let body: { photo_path?: string; candidates?: Candidate[]; tier?: string; ping?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  // Setup check from the app's Account screen.
  if (body.ping) return json({ ok: true });
  const tier: Tier = body.tier === 'basic' ? 'basic' : 'pro';
  const { model, maxReferencePhotos } = TIERS[tier];
  const photoPath = body.photo_path;
  if (!photoPath || !photoPath.startsWith(`${userData.user.id}/`)) return json({ error: 'Invalid photo' }, 400);
  const candidates = (body.candidates ?? []).slice(0, 40);

  const download = async (path: string) => {
    const { data, error } = await supabase.storage.from('trailcam').download(path);
    if (error || !data) return null;
    return { data: toBase64(await data.arrayBuffer()), media_type: (data.type || 'image/jpeg') as 'image/jpeg' };
  };

  const target = await download(photoPath);
  if (!target) return json({ error: 'Photo not found' }, 404);

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  const known: string[] = [];
  let refs = 0;
  for (const c of candidates) {
    const facts = [c.description, c.points ? `${c.points} points` : '', c.age_class !== 'unknown' ? c.age_class : '']
      .filter(Boolean)
      .join('; ');
    known.push(`- id ${c.id}: "${c.name}"${facts ? ` (${facts})` : ''}`);
    if (c.reference_photo_path && refs < maxReferencePhotos) {
      const ref = await download(c.reference_photo_path);
      if (ref) {
        refs++;
        content.push({ type: 'text', text: `Reference photo of known deer id ${c.id} ("${c.name}"):` });
        content.push({ type: 'image', source: { type: 'base64', ...ref } });
      }
    }
  }
  content.push({
    type: 'text',
    text: `Known deer:\n${known.length ? known.join('\n') : '(none yet)'}\n\nPhoto to analyze:`,
  });
  content.push({ type: 'image', source: { type: 'base64', ...target } });

  const client = new Anthropic({ apiKey });
  try {
    const request = {
      model,
      max_tokens: 16000,
      output_config: { effort: 'low' as const, format: { type: 'json_schema' as const, schema: RESULT_SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user' as const, content }],
    };
    // Pro opts into server-side fallback if a request is declined; Haiku has no server-side fallback.
    const response =
      tier === 'pro'
        ? await client.beta.messages.create({ ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : await client.beta.messages.create(request);

    if (response.stop_reason === 'refusal') return json({ error: 'The photo could not be analyzed' }, 422);
    if (response.stop_reason === 'max_tokens') return json({ error: 'Analysis was cut off; try again' }, 502);
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return json({ error: 'No result returned' }, 502);
    const result = JSON.parse(text.text);
    // Only accept matches to deer the caller actually sent.
    if (result.match_deer_id && !candidates.some((c) => c.id === result.match_deer_id)) {
      result.match_deer_id = null;
      result.match_confidence = 'none';
    }
    return json({ ...result, model: response.model });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'Too many photos at once; try again in a minute' }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'The Anthropic API key is invalid' }, 500);
    if (e instanceof Anthropic.APIError) return json({ error: `AI service error (${e.status})` }, 502);
    return json({ error: 'Unexpected error analyzing photo' }, 500);
  }
});
