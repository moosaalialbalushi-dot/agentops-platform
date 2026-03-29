import { createClient } from '@supabase/supabase-js';

// Supabase anon key is a publishable key — safe in client bundles.
// Fallbacks ensure saves work even when VITE_ env vars are not set at build time.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  || "https://cnliqngeufcdsypuimog.supabase.co";

const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  || import.meta.env.VITE_SUPABASE_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubGlxbmdldWZjZHN5cHVpbW9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTk1MTksImV4cCI6MjA4ODgzNTUxOX0.dKnMsDxcwQZATCsVO7EVKluCh9MpRRipuSl1B_JCNO0";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
