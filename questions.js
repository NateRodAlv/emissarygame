// ============================================================
//  QUESTIONS.JS — Supabase question fetching layer
// ============================================================
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_TABLES } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Fetch N random short questions (SQ).
 * Each row should have: { id, question, answer, category }
 */
export async function fetchSQ(count = 1) {
  const { data, error } = await supabase
    .from(SUPABASE_TABLES.shortQuestions)
    .select("*")
    .limit(count)
    .order("id", { ascending: false }); // TODO: replace with random() once Supabase supports it cleanly
  if (error) throw error;
  return data;
}

/**
 * Fetch N random long questions (LQ).
 */
export async function fetchLQ(count = 1) {
  const { data, error } = await supabase
    .from(SUPABASE_TABLES.longQuestions)
    .select("*")
    .limit(count)
    .order("id", { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * Fetch a mixed batch — used by task minigames.
 * @param {"sq"|"lq"|"mixed"} type
 * @param {number} count
 */
export async function fetchQuestionsForTask(type, count) {
  if (type === "sq")    return fetchSQ(count);
  if (type === "lq")    return fetchLQ(count);
  // mixed: half and half
  const half = Math.ceil(count / 2);
  const [sq, lq] = await Promise.all([fetchSQ(half), fetchLQ(count - half)]);
  return [...sq, ...lq];
}
