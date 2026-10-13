"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getUserId, safeNext } from "@/lib/auth";
import { AREAS } from "@/lib/constants";
import { isValidPromptPayId } from "@/lib/promptpay";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

const profileSchema = z.object({
  display_name: z.string().trim().min(2, "Enter your name (2+ characters)").max(60),
  level: z.coerce.number().int().min(1, "Pick your level").max(9),
  areas: z.array(z.enum(AREAS)).max(AREAS.length),
  bio: z.string().trim().max(500).optional().default(""),
});

function readProfile(formData: FormData) {
  return profileSchema.safeParse({
    display_name: formData.get("display_name"),
    level: formData.get("level"),
    areas: formData.getAll("areas"),
    bio: formData.get("bio") ?? "",
  });
}

export async function completeOnboarding(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await getUserId();
  if (!userId) redirect("/auth/login");
  const parsed = readProfile(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ ...parsed.data, onboarded: true })
    .eq("id", userId);
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect(safeNext(String(formData.get("next") ?? "")));
}

export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await getUserId();
  if (!userId) redirect("/auth/login");
  const parsed = readProfile(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update(parsed.data).eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: "Profile saved." };
}

export async function savePromptPay(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await getUserId();
  if (!userId) redirect("/auth/login");
  const raw = String(formData.get("promptpay_id") ?? "").replace(/[\s-]/g, "");
  if (raw && !isValidPromptPayId(raw)) {
    return { error: "Use a Thai mobile number (10 digits, starting with 0) or a 13-digit ID." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("organizer_settings")
    .upsert({ user_id: userId, promptpay_id: raw || null, updated_at: new Date().toISOString() });
  if (error) return { error: error.message };
  return { ok: raw ? "PromptPay saved. Players will see your QR code after they join." : "PromptPay removed." };
}
