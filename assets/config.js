/*
 * PEAK VISION — connection to the content database (Supabase).
 * Both values come from: Supabase → Project Settings → API Keys / Data API.
 * The "anon / publishable" key is meant to be public — it only allows reading the site
 * content; editing needs an admin login (enforced by the database rules in supabase/setup.sql).
 * Leave them empty to serve content.json instead.
 */
window.PV_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: ''
};
