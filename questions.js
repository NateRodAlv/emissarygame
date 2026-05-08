// ============================================================
//  QUESTIONS.JS — Supabase question fetching + writing layer
//
//  RLS policies needed in Supabase dashboard:
//    short_questions & long_questions:
//      SELECT  → true  (public read)
//      INSERT  → auth.uid() = created_by
//      UPDATE  → auth.uid() = created_by
//      DELETE  → auth.uid() = created_by
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

/**
 * Sign in with Google via Supabase OAuth popup.
 * Supabase redirects back to the same page; the session is
 * automatically picked up by onAuthChange.
 */
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.href.split("?")[0], // strip ?join= params
    },
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

/** Returns the currently signed-in user or null. */
export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

/**
 * Subscribe to auth state changes.
 * cb receives the user object or null.
 * Returns an unsubscribe function.
 */
export function onAuthChange(cb) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    (_event, session) => cb(session?.user ?? null)
  );
  return () => subscription.unsubscribe();
}

// ── Categories ────────────────────────────────────────────────

/**
 * Fetch all distinct categories across both question tables.
 * @param {string|null} ownedBy  — when set, only return categories owned by this uid.
 * Returns array of { name, sqCount, lqCount, createdBy }.
 */
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

// ── Question fetching ─────────────────────────────────────────

/** Fetch N random short questions, optionally filtered by category. */
export async function fetchSQ(count = 1, category = null) {
  let q = supabase
    .from(SUPABASE_TABLES.shortQuestions)
    .select("*")
    .limit(Math.max(count * 5, 30));
  if (category) q = q.eq("category", category);
  const { data, error } = await q;
  if (error) throw error;
  return shuffle(data ?? []).slice(0, count);
}

/** Fetch N random long questions, optionally filtered by category. */
export async function fetchLQ(count = 1, category = null) {
  let q = supabase
    .from(SUPABASE_TABLES.longQuestions)
    .select("*")
    .limit(Math.max(count * 5, 30));
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
 * Fetch ALL questions for a category, from both tables.
 * Each row includes a synthetic `_table` field: "sq" or "lq".
 * Optionally filtered to a specific owner uid.
 */
export async function fetchQuestionsForCategory(category, ownedBy = null) {
  let sqQ = supabase
    .from(SUPABASE_TABLES.shortQuestions)
    .select("id, question, answer, category, created_by")
    .eq("category", category)
    .order("id");
  let lqQ = supabase
    .from(SUPABASE_TABLES.longQuestions)
    .select("id, question, answer, category, created_by")
    .eq("category", category)
    .order("id");
  if (ownedBy) {
    sqQ = sqQ.eq("created_by", ownedBy);
    lqQ = lqQ.eq("created_by", ownedBy);
  }
  const [sqRes, lqRes] = await Promise.all([sqQ, lqQ]);
  const sqRows = (sqRes.data ?? []).map(r => ({ ...r, _table: "sq" }));
  const lqRows = (lqRes.data ?? []).map(r => ({ ...r, _table: "lq" }));
  return [...sqRows, ...lqRows];
}

// ── Question writing ──────────────────────────────────────────

/**
 * Insert questions.
 * Each row: { question, answer, category, type: "sq"|"lq" }
 */
export async function addQuestions(rows, userId = null) {
  if (!rows?.length) return;
  const sqRows = rows
    .filter(r => r.type === "sq")
    .map(({ question, answer, category }) => ({
      question, answer, category,
      ...(userId ? { created_by: userId } : {}),
    }));
  const lqRows = rows
    .filter(r => r.type === "lq")
    .map(({ question, answer, category }) => ({
      question, answer, category,
      ...(userId ? { created_by: userId } : {}),
    }));
  const ops = [];
  if (sqRows.length) ops.push(supabase.from(SUPABASE_TABLES.shortQuestions).insert(sqRows));
  if (lqRows.length) ops.push(supabase.from(SUPABASE_TABLES.longQuestions).insert(lqRows));
  const results = await Promise.all(ops);
  const errors  = results.map(r => r.error).filter(Boolean);
  if (errors.length) throw new Error(errors.map(e => e.message).join("; "));
}

/**
 * Update a single question's text and/or answer.
 * @param {"sq"|"lq"} table
 * @param {number} id
 * @param {{ question?: string, answer?: string }} fields
 */
export async function updateQuestion(table, id, fields) {
  const tbl = table === "sq" ? SUPABASE_TABLES.shortQuestions : SUPABASE_TABLES.longQuestions;
  const { error } = await supabase.from(tbl).update(fields).eq("id", id);
  if (error) throw error;
}

/**
 * Delete a single question by id and table.
 * FIX: Verifies the current user is the original creator before deleting.
 * @param {"sq"|"lq"} table
 * @param {number} id
 */
export async function deleteQuestion(table, id) {
  const tbl = table === "sq" ? SUPABASE_TABLES.shortQuestions : SUPABASE_TABLES.longQuestions;

  // Verify ownership: fetch the question's created_by and compare to the current user
  const { data: existing, error: fetchErr } = await supabase
    .from(tbl)
    .select("created_by")
    .eq("id", id)
    .single();
  if (fetchErr) throw fetchErr;

  const { data: { user } } = await supabase.auth.getUser();
  if (!existing || existing.created_by !== user?.id) {
    throw new Error("Permission denied: you are not the creator of this question.");
  }

  const { error } = await supabase.from(tbl).delete().eq("id", id);
  if (error) throw error;
}