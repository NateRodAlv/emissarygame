// ============================================================
//  QUESTIONS.JS — Supabase question fetching + writing layer
//
//  NOTE: For ownership enforcement to work server-side, add these
//  RLS policies in your Supabase dashboard:
//    short_questions: INSERT → auth.uid() = created_by
//    long_questions:  INSERT → auth.uid() = created_by
//    Both tables: SELECT → true (public read)
//    UPDATE/DELETE → auth.uid() = created_by
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

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
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
 * @param {string|null} ownedBy  — when provided, only return categories where
 *                                  created_by = ownedBy (for the addq screen).
 *                                  When null, return all categories (for host set picker).
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
    .map(([name, { sq, lq, createdBy }]) => ({
      name,
      sqCount: sq,
      lqCount: lq,
      createdBy,
    }));
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

// ── Question writing ──────────────────────────────────────────

/**
 * Insert questions.
 * Each row: { question, answer, category, type: "sq"|"lq" }
 * @param {Object[]} rows
 * @param {string|null} userId  — the Supabase auth UID of the uploader.
 *                               Stored as created_by for ownership checks.
 */
export async function addQuestions(rows, userId = null) {
  if (!rows?.length) return;

  const sqRows = rows
    .filter(r => r.type === "sq")
    .map(({ question, answer, category }) => ({
      question,
      answer,
      category,
      ...(userId ? { created_by: userId } : {}),
    }));

  const lqRows = rows
    .filter(r => r.type === "lq")
    .map(({ question, answer, category }) => ({
      question,
      answer,
      category,
      ...(userId ? { created_by: userId } : {}),
    }));

  const ops = [];
  if (sqRows.length) ops.push(supabase.from(SUPABASE_TABLES.shortQuestions).insert(sqRows));
  if (lqRows.length) ops.push(supabase.from(SUPABASE_TABLES.longQuestions).insert(lqRows));
  const results = await Promise.all(ops);
  const errors  = results.map(r => r.error).filter(Boolean);
  if (errors.length) throw new Error(errors.map(e => e.message).join("; "));
}