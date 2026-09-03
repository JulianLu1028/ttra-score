import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { runtimeConfig } from "./runtime-config";
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const config = runtimeConfig(import.meta.env.MODE, url, key);
// Retained internal name for existing test fixtures; no user-facing demo mode.
export const isDemoMode = config.fixture;
export const backendConfigured = config.configured;
export const supabase: SupabaseClient | null = !backendConfigured
  ? null
  : createClient(url, key, {
      auth: { persistSession: false, detectSessionInUrl: false },
    });
