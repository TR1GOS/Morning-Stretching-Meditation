import React, { useEffect, useMemo, useState } from "react";

// Immersion Tracker – Japanese & Spanish (Streak Edition)
// Single-file React app. TailwindCSS. No external deps.
// Persists to localStorage. Monochrome + subtle accent. Includes self-tests.

const STORAGE_KEY = "immersion-tracker-v2";

// -------------------- Date & Helpers --------------------
function todayISO(d = new Date()) {
  const tzOffset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tzOffset * 60000);
  return local.toISOString().slice(0, 10);
}

function shiftISO(dateStr, deltaDays) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + deltaDays);
  return todayISO(d);
}

function startOfISOWeek(date = new Date()) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Mon=0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
}

// IMPORTANT: use local-date formatting, not toISOString (which is UTC) — avoids off-by-one week IDs in BST/other TZs
function weekId(date = new Date()) {
  const start = startOfISOWeek(date);
  return todayISO(start); // YYYY-MM-DD (local Monday)
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// -------------------- Config & Persistence --------------------
const defaultConfig = {
  goals: {
    ja: { watch: 30, read: 20, mine: 5, anki: true, wanikani: true },
    es: { watch: 30, listen: 20, read: 15, mine: 5, anki: false },
  },
  weekly: { vanessaHomework: true },
  ui: { compact: false, accent: "emerald" },
};

function safeGetLocalStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch (_) {}
  // Fallback no-op shim for non-browser environments
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

const LS = safeGetLocalStorage();

function migrateState(raw) {
  const base = { config: defaultConfig, entries: {}, weekly: {}, meta: { bestStreak: 0 } };
  if (!raw || typeof raw !== "object") return base;
  const cfg = { ...defaultConfig, ...(raw.config || {}) };
  const out = {
    config: cfg,
    entries: typeof raw.entries === "object" && raw.entries ? raw.entries : {},
    weekly: typeof raw.weekly === "object" && raw.weekly ? raw.weekly : {},
    meta: { bestStreak: 0, ...(raw.meta || {}) },
  };
  return out;
}

function loadState() {
  try {
    const raw = LS.getItem(STORAGE_KEY);
    if (!raw) return { config: defaultConfig, entries: {}, weekly: {}, meta: { bestStreak: 0 } };
    const parsed = JSON.parse(raw);
    return migrateState(parsed);
  } catch (e) {
    return { config: defaultConfig, entries: {}, weekly: {}, meta: { bestStreak: 0 } };
  }
}

function saveState(s) {
  try {
    LS.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (_) {}
}

function usePersistentState() {
  const [state, setState] = useState(loadState);
  useEffect(() => saveState(state), [state]);
  return [state, setState];
}

// -------------------- UI Primitives --------------------
function Ring({ label, value, goal }) {
  const pct = goal > 0 ? clamp((value / goal) * 100, 0, 100) : 0;
  const bg = `conic-gradient(currentColor ${pct}%, rgba(255,255,255,0.06) ${pct}%)`;
  return (
    <div className="flex flex-col items-center justify-center">
      <div className="w-28 h-28 rounded-full grid place-items-center text-white" style={{ background: bg }}>
        <div className="w-24 h-24 rounded-full bg-neutral-950/80 backdrop-blur grid place-items-center border border-white/10">
          <div className="text-center">
            <div className="text-xl font-semibold">{Math.round(pct)}%</div>
            <div className="text-xs text-neutral-400">{label}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NumberInput({ value, onChange, min = 0, max = 600, step = 5, suffix }) {
  return (
    <div className="flex items-center gap-2">
      <button aria-label={`decrease by ${step}`} className="px-2 py-1 rounded-lg bg-neutral-900/70 hover:bg-neutral-800/80 border border-white/10" onClick={() => onChange(clamp((value || 0) - step, min, max))}>−{step}</button>
      <input className="w-24 px-3 py-2 rounded-lg bg-neutral-900/70 border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/20" type="number" value={value ?? 0} onChange={(e) => onChange(clamp(parseInt(e.target.value || "0", 10), min, max))} min={min} max={max} step={1} />
      {suffix && <span className="text-neutral-400 text-sm">{suffix}</span>}
      <button aria-label={`increase by ${step}`} className="px-2 py-1 rounded-lg bg-neutral-900/70 hover:bg-neutral-800/80 border border-white/10" onClick={() => onChange(clamp((value || 0) + step, min, max))}>+{step}</button>
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <span className={`w-12 h-7 rounded-full p-1 transition-colors ${checked ? "bg-emerald-500" : "bg-neutral-700/70"}`} onClick={() => onChange(!checked)}>
        <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`}></span>
      </span>
      <span className="text-sm text-neutral-200">{label}</span>
    </label>
  );
}

function SectionCard({ title, children, right }) {
  return (
    <div className="rounded-2xl bg-neutral-900/50 backdrop-blur border border-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.04)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white tracking-wide">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

// -------------------- Logic: Completion & Streaks --------------------
// Streak is based on completing BOTH languages' daily core; weekly homework does not gate the streak.
function isDayComplete(entry, goals) {
  if (!entry) return false;
  const jaTimeGoal = (goals.ja.watch || 0) + (goals.ja.read || 0);
  const jaTimeDone = (entry.ja.watch || 0) + (entry.ja.read || 0);
  const esTimeGoal = (goals.es.watch || 0) + (goals.es.listen || 0) + (goals.es.read || 0);
  const esTimeDone = (entry.es.watch || 0) + (entry.es.listen || 0) + (entry.es.read || 0);
  const ja = (!goals.ja.wanikani || entry.ja.wanikani) && (!goals.ja.anki || entry.ja.anki) && jaTimeDone >= jaTimeGoal && (entry.ja.mine || 0) >= (goals.ja.mine || 0);
  const es = (!goals.es.anki || entry.es.anki) && esTimeDone >= esTimeGoal && (entry.es.mine || 0) >= (goals.es.mine || 0);
  return ja && es;
}

function computeStreak(entries, goals, endDateISO) {
  let streak = 0;
  let cursor = endDateISO;
  while (true) {
    const e = entries[cursor];
    if (!e || !isDayComplete(e, goals)) break;
    streak += 1;
    cursor = shiftISO(cursor, -1);
  }
  return streak;
}

function computeBestStreak(entries, goals) {
  const dates = Object.keys(entries).sort();
  let best = 0;
  if (dates.length === 0) return 0;
  const set = new Set(dates);
  for (const d of dates) {
    const prev = shiftISO(d, -1);
    if (set.has(prev)) continue; // only start at segment heads
    let cur = d;
    let len = 0;
    while (set.has(cur) && isDayComplete(entries[cur], goals)) {
      len += 1;
      cur = shiftISO(cur, -1);
    }
    if (len > best) best = len;
  }
  return best;
}

// -------------------- App --------------------
export default function ImmersionTracker() {
  const [state, setState] = usePersistentState();
  const [date, setDate] = useState(todayISO());
  const wId = useMemo(() => weekId(new Date(date)), [date]);

  // Ensure entry exists for current date & week bucket
  useEffect(() => {
    setState((prev) => {
      const entries = { ...prev.entries };
      if (!entries[date]) {
        entries[date] = { ja: { watch: 0, read: 0, mine: 0, anki: false, wanikani: false }, es: { watch: 0, listen: 0, read: 0, mine: 0, anki: false }, notes: "" };
      }
      const weekly = { ...prev.weekly };
      if (!weekly[wId]) weekly[wId] = { vanessa: false };
      const meta = prev.meta || { bestStreak: 0 };
      return { ...prev, entries, weekly, meta };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const entry = state.entries[date] || { ja: { watch: 0, read: 0, mine: 0, anki: false, wanikani: false }, es: { watch: 0, listen: 0, read: 0, mine: 0, anki: false }, notes: "" };
  const weeklyState = state.weekly[wId] || { vanessa: false };
  const goals = state.config.goals;

  // Progress numbers for rings
  const jaTimeGoal = (goals.ja.watch || 0) + (goals.ja.read || 0);
  const jaTimeDone = (entry.ja.watch || 0) + (entry.ja.read || 0);
  const esTimeGoal = (goals.es.watch || 0) + (goals.es.listen || 0) + (goals.es.read || 0);
  const esTimeDone = (entry.es.watch || 0) + (entry.es.listen || 0) + (entry.es.read || 0);

  const allCoreDoneJA = (!goals.ja.wanikani || entry.ja.wanikani) && (!goals.ja.anki || entry.ja.anki) && jaTimeDone >= jaTimeGoal && entry.ja.mine >= goals.ja.mine;
  const allCoreDoneES = (!goals.es.anki || entry.es.anki) && esTimeDone >= esTimeGoal && entry.es.mine >= goals.es.mine;
  const dailyComplete = isDayComplete(entry, goals);

  // Streaks
  const currentStreak = computeStreak(state.entries, goals, date);
  const bestStreakCalc = computeBestStreak(state.entries, goals);
  useEffect(() => {
    if ((state.meta?.bestStreak || 0) < bestStreakCalc) {
      setState((prev) => ({ ...prev, meta: { ...(prev.meta || {}), bestStreak: bestStreakCalc } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bestStreakCalc]);

  const changeDate = (deltaDays) => setDate((d) => shiftISO(d, deltaDays));

  // Keyboard shortcuts for faster nav
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowLeft") changeDate(-1);
      if (e.key === "ArrowRight") changeDate(1);
      if (e.key.toLowerCase() === "t") setDate(todayISO());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Safe setter for nested paths (creates missing objects)
  const setEntry = (path, value) => {
    setState((prev) => {
      const entries = { ...prev.entries };
      const e = entries[date] ?? { ja: {}, es: {}, notes: "" };
      const newEntry = JSON.parse(JSON.stringify(e));
      const keys = path.split(".");
      let cur = newEntry;
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
        cur = cur[k];
      }
      cur[keys[keys.length - 1]] = value;
      entries[date] = newEntry;
      return { ...prev, entries };
    });
  };

  const setWeekly = (key, value) => {
    setState((prev) => {
      const weekly = { ...prev.weekly };
      const w = weekly[wId] || {};
      w[key] = value;
      weekly[wId] = w;
      return { ...prev, weekly };
    });
  };

  const resetDay = () => {
    setState((prev) => ({
      ...prev,
      entries: {
        ...prev.entries,
        [date]: { ja: { watch: 0, read: 0, mine: 0, anki: false, wanikani: false }, es: { watch: 0, listen: 0, read: 0, mine: 0, anki: false }, notes: "" },
      },
    }));
  };

  const setGoal = (lang, key, val) => {
    setState((prev) => ({
      ...prev,
      config: { ...prev.config, goals: { ...prev.config.goals, [lang]: { ...prev.config.goals[lang], [key]: val } } },
    }));
  };

  const accentClass = "from-neutral-200/10 via-neutral-200/5 to-transparent"; // placeholder for future accent customization

  // -------------------- Dev/Test Panel --------------------
  const tests = useMemo(() => runTests(), []);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_20%_0%,#0f1117_0%,#0b0d12_40%,#0a0b0f_100%)] text-neutral-100 p-6">
      <div className="max-w-6xl mx-auto grid gap-6">
        {/* Header */}
        <div className="rounded-3xl border border-white/10 bg-neutral-900/40 backdrop-blur px-5 py-4 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <div>
            <div className="text-xs uppercase tracking-widest text-neutral-400">Immersion System</div>
            <h1 className="text-2xl font-semibold tracking-tight">Japanese × Spanish</h1>
            <div className="text-[11px] text-neutral-400">Daily input, mining, and SRS — monochrome UI</div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-2xl border border-white/10 bg-neutral-900/40 ${dailyComplete ? "animate-pulse" : ""}`}> 
              <span className="text-lg" aria-hidden>🔥</span>
              <div className="leading-tight">
                <div className="text-sm font-semibold">Streak {currentStreak}d</div>
                <div className="text-[11px] text-neutral-400">Best {Math.max(state.meta?.bestStreak || 0, currentStreak)}d</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="px-3 py-2 rounded-xl bg-neutral-900/60 border border-white/10 hover:bg-neutral-800/70" onClick={() => changeDate(-1)}>◀ Prev</button>
              <div className="px-3 py-2 rounded-xl bg-neutral-900/60 border border-white/10 text-sm" aria-live="polite">{date}</div>
              <button className="px-3 py-2 rounded-xl bg-neutral-900/60 border border-white/10 hover:bg-neutral-800/70" onClick={() => changeDate(1)}>Next ▶</button>
              <button className="px-3 py-2 rounded-xl bg-neutral-900/60 border border-white/10 hover:bg-neutral-800/70" onClick={() => setDate(todayISO())}>Today</button>
            </div>
          </div>
        </div>

        {/* Accent bar */}
        <div className={`h-[2px] w-full bg-gradient-to-r ${accentClass} rounded-full`} />

        {/* Progress Rings */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SectionCard title="Japanese – Time" right={<span className="text-xs text-neutral-400">{jaTimeDone}/{jaTimeGoal} min</span>}>
            <div className="flex items-center justify-center"><Ring label="Time" value={jaTimeDone} goal={jaTimeGoal} /></div>
          </SectionCard>
          <SectionCard title="Japanese – Mining" right={<span className="text-xs text-neutral-400">{entry.ja.mine}/{goals.ja.mine}</span>}>
            <div className="flex items-center justify-center"><Ring label="Mining" value={entry.ja.mine} goal={goals.ja.mine} /></div>
          </SectionCard>
          <SectionCard title="Spanish – Time" right={<span className="text-xs text-neutral-400">{esTimeDone}/{esTimeGoal} min</span>}>
            <div className="flex items-center justify-center"><Ring label="Time" value={esTimeDone} goal={esTimeGoal} /></div>
          </SectionCard>
          <SectionCard title="Spanish – Mining" right={<span className="text-xs text-neutral-400">{entry.es.mine}/{goals.es.mine}</span>}>
            <div className="flex items-center justify-center"><Ring label="Mining" value={entry.es.mine} goal={goals.es.mine} /></div>
          </SectionCard>
        </div>

        {/* Japanese Section */}
        <SectionCard title="Japanese" right={<div className="flex items-center gap-2 text-xs text-neutral-300"><span className={`px-2 py-1 rounded-full border border-white/10 ${allCoreDoneJA ? "bg-emerald-600/15 text-emerald-300" : "bg-neutral-800/60"}`}>{allCoreDoneJA ? "Core done" : "In progress"}</span></div>}>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              {goals.ja.wanikani && (<Toggle checked={entry.ja.wanikani} onChange={(v) => setEntry("ja.wanikani", v)} label="WaniKani reviews" />)}
              {goals.ja.anki && (<Toggle checked={entry.ja.anki} onChange={(v) => setEntry("ja.anki", v)} label="Anki reviews" />)}
              <div><div className="text-sm mb-2">Watch minutes (goal {goals.ja.watch})</div><NumberInput value={entry.ja.watch} onChange={(v) => setEntry("ja.watch", v)} suffix="min" /></div>
              <div><div className="text-sm mb-2">Read minutes (goal {goals.ja.read})</div><NumberInput value={entry.ja.read} onChange={(v) => setEntry("ja.read", v)} suffix="min" /></div>
              <div><div className="text-sm mb-2">Sentence mining (goal {goals.ja.mine})</div><NumberInput value={entry.ja.mine} onChange={(v) => setEntry("ja.mine", v)} step={1} suffix="items" /></div>
            </div>
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-neutral-300">Goals</h3>
              <div className="grid grid-cols-2 gap-4">
                <div><div className="text-xs mb-1">Watch goal</div><NumberInput value={goals.ja.watch} onChange={(v) => setGoal("ja", "watch", v)} suffix="min" /></div>
                <div><div className="text-xs mb-1">Read goal</div><NumberInput value={goals.ja.read} onChange={(v) => setGoal("ja", "read", v)} suffix="min" /></div>
                <div><div className="text-xs mb-1">Mining goal</div><NumberInput value={goals.ja.mine} onChange={(v) => setGoal("ja", "mine", v)} step={1} suffix="items" /></div>
                <div className="space-y-2"><div className="text-xs mb-1">Include tasks</div><Toggle checked={goals.ja.wanikani} onChange={(v) => setGoal("ja", "wanikani", v)} label="WaniKani" /><Toggle checked={goals.ja.anki} onChange={(v) => setGoal("ja", "anki", v)} label="Anki" /></div>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Spanish Section */}
        <SectionCard title="Spanish" right={<div className="flex items-center gap-2 text-xs text-neutral-300"><span className={`px-2 py-1 rounded-full border border-white/10 ${allCoreDoneES ? "bg-emerald-600/15 text-emerald-300" : "bg-neutral-800/60"}`}>{allCoreDoneES ? "Core done" : "In progress"}</span></div>}>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              {goals.es.anki && (<Toggle checked={entry.es.anki} onChange={(v) => setEntry("es.anki", v)} label="Anki reviews" />)}
              <div><div className="text-sm mb-2">Watch minutes (goal {goals.es.watch})</div><NumberInput value={entry.es.watch} onChange={(v) => setEntry("es.watch", v)} suffix="min" /></div>
              <div><div className="text-sm mb-2">Listen minutes (goal {goals.es.listen})</div><NumberInput value={entry.es.listen} onChange={(v) => setEntry("es.listen", v)} suffix="min" /></div>
              <div><div className="text-sm mb-2">Read minutes (goal {goals.es.read})</div><NumberInput value={entry.es.read} onChange={(v) => setEntry("es.read", v)} suffix="min" /></div>
              <div><div className="text-sm mb-2">Mining (goal {goals.es.mine})</div><NumberInput value={entry.es.mine} onChange={(v) => setEntry("es.mine", v)} step={1} suffix="items" /></div>
            </div>
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-neutral-300">Goals</h3>
              <div className="grid grid-cols-2 gap-4">
                <div><div className="text-xs mb-1">Watch goal</div><NumberInput value={goals.es.watch} onChange={(v) => setGoal("es", "watch", v)} suffix="min" /></div>
                <div><div className="text-xs mb-1">Listen goal</div><NumberInput value={goals.es.listen} onChange={(v) => setGoal("es", "listen", v)} suffix="min" /></div>
                <div><div className="text-xs mb-1">Read goal</div><NumberInput value={goals.es.read} onChange={(v) => setGoal("es", "read", v)} suffix="min" /></div>
                <div><div className="text-xs mb-1">Mining goal</div><NumberInput value={goals.es.mine} onChange={(v) => setGoal("es", "mine", v)} step={1} suffix="items" /></div>
                <div className="space-y-2 col-span-2"><div className="text-xs mb-1">Include tasks</div><Toggle checked={goals.es.anki} onChange={(v) => setGoal("es", "anki", v)} label="Anki" /></div>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Weekly Section */}
        <SectionCard title="Weekly">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-6">
              <div className="text-sm text-neutral-400">Week starting {wId}</div>
              {state.config.weekly.vanessaHomework && (<Toggle checked={weeklyState.vanessa} onChange={(v) => setWeekly("vanessa", v)} label="Spanish: Vanessa homework" />)}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <button className="px-3 py-2 rounded-xl bg-neutral-900/60 border border-white/10 hover:bg-neutral-800/70" onClick={() => setWeekly("vanessa", false)}>Reset week</button>
            </div>
          </div>
        </SectionCard>

        {/* Notes */}
        <SectionCard title="Notes / Reflection">
          <textarea className="w-full min-h-[100px] rounded-xl bg-neutral-900/50 backdrop-blur border border-white/10 p-3 focus:outline-none focus:ring-2 focus:ring-white/20" placeholder="Quick notes: what did you watch/read, good mined sentences, obstacles, comprehension level" value={entry.notes} onChange={(e) => setEntry("notes", e.target.value)} />
        </SectionCard>

        {/* System Controls */}
        <SectionCard title="System">
          <div className="flex flex-wrap items-center gap-3">
            <button className="px-4 py-2 rounded-xl bg-neutral-900/60 border border-white/10 hover:bg-neutral-800/70" onClick={() => { const ok = confirm("Reset today's entry?"); if (ok) resetDay(); }}>Reset today</button>
            <button className="px-4 py-2 rounded-xl bg-neutral-900/60 border border-white/10 hover:bg-neutral-800/70" onClick={() => { const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `immersion-tracker-${date}.json`; a.click(); URL.revokeObjectURL(url); }}>Export JSON</button>
            <label className="px-4 py-2 rounded-xl bg-neutral-900/60 border border-white/10 hover:bg-neutral-800/70 cursor-pointer">Import JSON<input type="file" accept="application/json" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const data = JSON.parse(reader.result); const next = migrateState(data); // merge + validate
                  // recompute bestStreak for imported data
                  const best = computeBestStreak(next.entries, next.config.goals);
                  next.meta = { ...(next.meta || {}), bestStreak: best };
                  setState(next);
                } catch (_) {} }; reader.readAsText(file); e.target.value = ""; }} /></label>
            <button className="px-4 py-2 rounded-xl bg-neutral-900/60 border border-white/10 hover:bg-neutral-800/70" onClick={() => setState({ config: defaultConfig, entries: {}, weekly: {}, meta: { bestStreak: 0 } })}>Reset all settings</button>
            <div className={`ml-auto text-xs ${dailyComplete ? "text-emerald-400" : "text-neutral-500"}`}>{dailyComplete ? "Daily core complete" : "Daily core not yet complete"}</div>
          </div>
        </SectionCard>

        {/* Dev / Tests */}
        <SectionCard title="Dev / Tests">
          <details className="text-sm text-neutral-300">
            <summary className="cursor-pointer">Show tests</summary>
            <ul className="mt-3 space-y-1 list-disc list-inside">
              {tests.map((t, i) => (
                <li key={i} className={t.pass ? "text-emerald-400" : "text-red-400"}>
                  {t.name}: {t.pass ? "PASS" : `FAIL (got ${JSON.stringify(t.got)} expected ${JSON.stringify(t.expected)})`}
                </li>
              ))}
            </ul>
          </details>
        </SectionCard>

        <div className="text-[11px] text-neutral-500 text-center pb-6">Keep the flame alive: complete both language cores to extend your streak.</div>
      </div>
    </div>
  );
}

// -------------------- Test Cases --------------------
function runTests() {
  const results = [];

  // todayISO format
  const d = new Date("2025-08-20T12:34:56Z");
  results.push({ name: "todayISO format", got: todayISO(d).length, expected: 10, pass: todayISO(d).length === 10 });

  // shiftISO basic
  results.push({ name: "shiftISO -1 day", got: shiftISO("2025-08-20", -1), expected: "2025-08-19", pass: shiftISO("2025-08-20", -1) === "2025-08-19" });

  // weekId Monday check (2025-08-18 is Monday)
  const w = weekId(new Date("2025-08-20T00:00:00Z"));
  results.push({ name: "weekId Monday start", got: w, expected: "2025-08-18", pass: w === "2025-08-18" });

  // isDayComplete true case
  const goals = { ja: { watch: 30, read: 20, mine: 5, anki: true, wanikani: true }, es: { watch: 30, listen: 20, read: 0, mine: 5, anki: false } };
  const entryOK = { ja: { watch: 30, read: 20, mine: 5, anki: true, wanikani: true }, es: { watch: 30, listen: 20, read: 0, mine: 5, anki: false } };
  results.push({ name: "isDayComplete true", got: isDayComplete(entryOK, goals), expected: true, pass: isDayComplete(entryOK, goals) === true });

  // isDayComplete false case (missing mining)
  const entryBad = { ja: { watch: 30, read: 20, mine: 4, anki: true, wanikani: true }, es: { watch: 30, listen: 20, read: 0, mine: 5, anki: false } };
  results.push({ name: "isDayComplete false (mining)", got: isDayComplete(entryBad, goals), expected: false, pass: isDayComplete(entryBad, goals) === false });

  // computeStreak
  const entries = {
    "2025-08-18": { ja: entryOK.ja, es: entryOK.es },
    "2025-08-19": { ja: entryOK.ja, es: entryOK.es },
    "2025-08-20": { ja: { ...entryOK.ja, mine: 4 }, es: entryOK.es }, // not complete today
  };
  results.push({ name: "computeStreak ends 2025-08-19", got: computeStreak(entries, goals, "2025-08-19"), expected: 2, pass: computeStreak(entries, goals, "2025-08-19") === 2 });
  results.push({ name: "computeStreak ends 2025-08-20", got: computeStreak(entries, goals, "2025-08-20"), expected: 0, pass: computeStreak(entries, goals, "2025-08-20") === 0 });

  // computeBestStreak with a gap
  results.push({ name: "computeBestStreak with gap", got: computeBestStreak(entries, goals), expected: 2, pass: computeBestStreak(entries, goals) === 2 });

  return results;
}
