// Workaround for supabase-js generic typing that doesn't match
// ReturnType<typeof createClient> in scaffolded email queue route.
declare module '@supabase/supabase-js' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createClient(url: string, key: string, options?: any): any;
}
