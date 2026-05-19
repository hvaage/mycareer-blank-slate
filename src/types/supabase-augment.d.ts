// Augments @supabase/supabase-js with a permissive generic createClient overload
// so that the scaffolded email queue route (which uses
// `ReturnType<typeof createClient>`) typechecks without modifying that
// auto-generated file.
import '@supabase/supabase-js';

declare module '@supabase/supabase-js' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createClient<T = any>(url: string, key: string, options?: any): any;
}
