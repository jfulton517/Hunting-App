// Supabase project settings for user accounts.
//
// Both values are designed to be public (they ship to every browser); your data
// is protected by the row-level security rules in supabase/schema.sql.
// Find them in Supabase: Project Settings → API (or Data API).
// Leave them empty to run without accounts (data is saved on the device only).
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? 'https://fdydesqrkswmimfyssom.supabase.co';
// Publishable (public) key. Never put a secret or service_role key in this file.
export const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_EFPoBMaf7Nox4Fnc5lwDIQ_A840jrY0';

export const accountsEnabled = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
