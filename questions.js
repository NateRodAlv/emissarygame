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

// ── Auth ──────────────────────────────────────────────────────
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.href.split("?")[0] },
  });
  if (error) throw error;
}
export async function signOut() { await supabase.auth.signOut(); }
export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}
export function onAuthChange(cb) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    (_event, session) => cb(session?.user ?? null)
  );
  return () => subscription.unsubscribe();
}

// ── Categories ────────────────────────────────────────────────
export async function fetchCategories(ownedBy = null) {
  let sqQuery = supabase
    .from(SUPABASE_TABLES.shortQuestions)
    .select("category, created_by")
    .not("category", "is", null);
  let lqQuery = supabase
    .from(SUPABASE_TABLES.longQuestions)
    .select("category, created_by")
    .not("category", "is", null);
  if (ownedBy) {
    sqQuery = sqQuery.eq("created_by", ownedBy);
    lqQuery = lqQuery.eq("created_by", ownedBy);
  }
  const [sqRes, lqRes] = await Promise.all([sqQuery, lqQuery]);
  const counts = {};
  for (const { category: c, created_by: owner } of sqRes.data ?? []) {
    if (!c) continue;
    if (!counts[c]) counts[c] = { sq: 0, lq: 0, createdBy: owner };
    counts[c].sq++;
  }
  for (const { category: c, created_by: owner } of lqRes.data ?? []) {
    if (!c) continue;
    if (!counts[c]) counts[c] = { sq: 0, lq: 0, createdBy: owner };
    counts[c].lq++;
  }
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { sq, lq, createdBy }]) => ({ name, sqCount: sq, lqCount: lq, createdBy }));
}

// ── Fetching ──────────────────────────────────────────────────
export async function fetchSQ(count = 1, category = null) {
  let q = supabase.from(SUPABASE_TABLES.shortQuestions).select("*").limit(Math.max(count * 5, 30));
  if (category) q = q.eq("category", category);
  const { data, error } = await q;
  if (error) throw error;
  return shuffle(data ?? []).slice(0, count);
}
export async function fetchLQ(count = 1, category = null) {
  let q = supabase.from(SUPABASE_TABLES.longQuestions).select("*").limit(Math.max(count * 5, 30));
  if (category) q = q.eq("category", category);
  const { data, error } = await q;
  if (error) throw error;
  return shuffle(data ?? []).slice(0, count);
}
export async function fetchQuestionsForTask(type, count, category = null) {
  if (type === "sq") return fetchSQ(count, category);
  if (type === "lq") return fetchLQ(count, category);
  const half = Math.ceil(count / 2);
  const [sq, lq] = await Promise.all([fetchSQ(half, category), fetchLQ(count - half, category)]);
  return shuffle([...sq, ...lq]);
}
export async function fetchQuestionsForCategory(category, ownedBy = null) {
  let sqQ = supabase.from(SUPABASE_TABLES.shortQuestions)
    .select("id, question, answer, category, created_by").eq("category", category).order("id");
  let lqQ = supabase.from(SUPABASE_TABLES.longQuestions)
    .select("id, question, answer, category, created_by").eq("category", category).order("id");
  if (ownedBy) { sqQ = sqQ.eq("created_by", ownedBy); lqQ = lqQ.eq("created_by", ownedBy); }
  const [sqRes, lqRes] = await Promise.all([sqQ, lqQ]);
  return [
    ...(sqRes.data ?? []).map(r => ({ ...r, _table: "sq" })),
    ...(lqRes.data ?? []).map(r => ({ ...r, _table: "lq" })),
  ];
}

// ── Writing ───────────────────────────────────────────────────
export async function addQuestions(rows, userId = null) {
  if (!rows?.length) return;
  const sqRows = rows.filter(r => r.type === "sq")
    .map(({ question, answer, category }) => ({ question, answer, category, ...(userId ? { created_by: userId } : {}) }));
  const lqRows = rows.filter(r => r.type === "lq")
    .map(({ question, answer, category }) => ({ question, answer, category, ...(userId ? { created_by: userId } : {}) }));
  const ops = [];
  if (sqRows.length) ops.push(supabase.from(SUPABASE_TABLES.shortQuestions).insert(sqRows));
  if (lqRows.length) ops.push(supabase.from(SUPABASE_TABLES.longQuestions).insert(lqRows));
  const results = await Promise.all(ops);
  const errors = results.map(r => r.error).filter(Boolean);
  if (errors.length) throw new Error(errors.map(e => e.message).join("; "));
}

export async function updateQuestion(table, id, fields) {
  const tbl = table === "sq" ? SUPABASE_TABLES.shortQuestions : SUPABASE_TABLES.longQuestions;
  const { error } = await supabase.from(tbl).update(fields).eq("id", id);
  if (error) throw error;
}

export async function deleteQuestion(table, id) {
  const tbl = table === "sq" ? SUPABASE_TABLES.shortQuestions : SUPABASE_TABLES.longQuestions;
  const { data: existing, error: fetchErr } = await supabase.from(tbl).select("created_by").eq("id", id).single();
  if (fetchErr) throw fetchErr;
  const { data: { user } } = await supabase.auth.getUser();
  if (!existing || existing.created_by !== user?.id)
    throw new Error("Permission denied: you are not the creator of this question.");
  const { error } = await supabase.from(tbl).delete().eq("id", id);
  if (error) throw error;
}

/**
 * Delete ALL questions in a category owned by this user (both tables).
 * Returns { sqDeleted, lqDeleted }.
 */
export async function deleteQuestionSet(category, userId) {
  if (!category || !userId) throw new Error("Category and userId are required.");
  const [sqRes, lqRes] = await Promise.all([
    supabase.from(SUPABASE_TABLES.shortQuestions)
      .delete().eq("category", category).eq("created_by", userId).select("id"),
    supabase.from(SUPABASE_TABLES.longQuestions)
      .delete().eq("category", category).eq("created_by", userId).select("id"),
  ]);
  if (sqRes.error) throw sqRes.error;
  if (lqRes.error) throw lqRes.error;
  return { sqDeleted: sqRes.data?.length ?? 0, lqDeleted: lqRes.data?.length ?? 0 };
}