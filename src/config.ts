// Supabase project settings for user accounts.
//
// Both values are designed to be public (they ship to every browser); your data
// is protected by the row-level security rules in supabase/schema.sql.
// Find them in Supabase: Project Settings → API (or Data API).
// Leave them empty to run without accounts (data is saved on the device only).
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export const accountsEnabled = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
