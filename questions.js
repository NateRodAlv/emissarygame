// ============================================================
//  QUESTIONS.JS — Supabase question fetching + writing layer
// ============================================================
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_TABLES } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Fetch all distinct categories across both tables.
 * Returns an array of { name, sqCount, lqCount }.
 */
export async function fetchCategories() {
  const [sqRes, lqRes] = await Promise.all([
    supabase.from(SUPABASE_TABLES.shortQuestions).select("category").not("category", "is", null),
    supabase.from(SUPABASE_TABLES.longQuestions).select("category").not("category", "is", null),
  ]);
  const counts = {};
  for (const { category: c } of sqRes.data ?? []) {
    if (!c) continue;
    if (!counts[c]) counts[c] = { sq: 0, lq: 0 };
    counts[c].sq++;
  }
  for (const { category: c } of lqRes.data ?? []) {
    if (!c) continue;
    if (!counts[c]) counts[c] = { sq: 0, lq: 0 };
    counts[c].lq++;
  }
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { sq, lq }]) => ({ name, sqCount: sq, lqCount: lq }));
}

/** Fetch N random short questions, optionally filtered by category. */
export async function fetchSQ(count = 1, category = null) {
  let q = supabase.from(SUPABASE_TABLES.shortQuestions).select("*").limit(Math.max(count * 5, 30));
  if (category) q = q.eq("category", category);
  const { data, error } = await q;
  if (error) throw error;
  return shuffle(data ?? []).slice(0, count);
}

/** Fetch N random long questions, optionally filtered by category. */
export async function fetchLQ(count = 1, category = null) {
  let q = supabase.from(SUPABASE_TABLES.longQuestions).select("*").limit(Math.max(count * 5, 30));
  if (category) q = q.eq("category", category);
  const { data, error } = await q;
  if (error) throw error;
  return shuffle(data ?? []).slice(0, count);
}

/**
 * Fetch a batch for task minigames.
 * @param {"sq"|"lq"|"mixed"} type
 * @param {number} count
 * @param {string|null} category
 */
export async function fetchQuestionsForTask(type, count, category = null) {
  if (type === "sq") return fetchSQ(count, category);
  if (type === "lq") return fetchLQ(count, category);
  const half = Math.ceil(count / 2);
  const [sq, lq] = await Promise.all([fetchSQ(half, category), fetchLQ(count - half, category)]);
  return shuffle([...sq, ...lq]);
}

/**
 * Insert questions. Each row: { question, answer, category, type: "sq"|"lq" }
 */
export async function addQuestions(rows) {
  if (!rows?.length) return;
  const sqRows = rows.filter(r => r.type === "sq").map(({ question, answer, category }) => ({ question, answer, category }));
  const lqRows = rows.filter(r => r.type === "lq").map(({ question, answer, category }) => ({ question, answer, category }));
  const ops = [];
  if (sqRows.length) ops.push(supabase.from(SUPABASE_TABLES.shortQuestions).insert(sqRows));
  if (lqRows.length) ops.push(supabase.from(SUPABASE_TABLES.longQuestions).insert(lqRows));
  const results = await Promise.all(ops);
  const errors  = results.map(r => r.error).filter(Boolean);
  if (errors.length) throw new Error(errors.map(e => e.message).join("; "));
}