import { supabase } from "./supabase";

export async function isOnboarded(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("user_settings")
    .select("onboarded")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.onboarded === true;
}

export async function markOnboarded(userId: string): Promise<void> {
  await supabase
    .from("user_settings")
    .upsert({ user_id: userId, onboarded: true, updated_at: new Date().toISOString() });
}
