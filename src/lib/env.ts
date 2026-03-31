const requiredVars = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"] as const;

type RequiredVar = (typeof requiredVars)[number];

function readEnv(name: RequiredVar): string {
  const value = import.meta.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export const env = {
  supabaseUrl: readEnv("VITE_SUPABASE_URL"),
  supabaseAnonKey: readEnv("VITE_SUPABASE_ANON_KEY"),
};
