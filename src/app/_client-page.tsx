"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,LineChart, Line,
} from "recharts";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
/* =========================================================
   共用 class
========================================================= */
const BTN = "px-3 py-1 md:px-4 md:py-2 rounded";
const IN_NUM = "w-16 md:w-20 h-9 md:h-10 border rounded px-1.5 text-right";
// 在 IN_NUM 底下新增
const IN_NUM_GRID =
  "min-w-[3rem] w-full h-9 md:h-10 border rounded px-1.5 text-right";

/* =========================================================
   型別 & 初始結構
========================================================= */
const initBatting = () => ({
  "1B": 0, "2B": 0, "3B": 0,
  HR: 0, BB: 0, SO: 0, HBP: 0, SF: 0, SH: 0,
  GO: 0, FO: 0, R: 0, RBI: 0,
});
const initPitching = () => ({ IP: 0, H: 0, ER: 0, BB: 0, K: 0, HR: 0, AB: 0, PC: 0 });
const initFielding = () => ({ PO: 0, A: 0, E: 0 });
const initBaserun  = () => ({ SB: 0, CS: 0 });

type Batting  = ReturnType<typeof initBatting>;
type Pitching = ReturnType<typeof initPitching>;
type Fielding = ReturnType<typeof initFielding>;
type Baserun  = ReturnType<typeof initBaserun>;

type Player = {
  id: number;
  name: string;
  positions: string[];
  throws: "R" | "L" | "S";
  bats: "R" | "L" | "S";
  batting: Batting;
  pitching: Pitching;
  fielding: Fielding;
  baserunning: Baserun;
};

type Triple = { batting: Batting; pitching: Pitching; fielding: Fielding; baserunning: Baserun; };
type RosterSnapshot = Record<number, { name: string; positions: string[] }>;

type Game = {
  id: number;
  date: string;
  opponent: string;
  season?: string;   // ← 新增
  tag?: string;      // ← 新增
  lineup: number[];
  innings: number[];
  stats: Record<number, Triple>;
  locked: boolean;
  roster: RosterSnapshot;
  winPid?: number;   // ← 新增
  lossPid?: number;  // ← 新增
  savePid?: number;  // ← 新增
};


/* =========================================================
   常數 / Helper
========================================================= */
const MLB_POSITIONS = ["P","C","1B","2B","3B","SS","LF","CF","RF","DH"];
const HANDS: Array<"R"|"L"|"S"> = ["R","L","S"];

const STORAGE = {
  players: "rsbm.players.v2",
  games:   "rsbm.games.v2",
  compare: "rsbm.compare.v1",
};

const toNonNegNum = (v: any) => {
  const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0;
};

function safeParse<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

function reviveTriple(anyTriple: any): Triple {
  return {
    batting:  { ...initBatting(),  ...(anyTriple?.batting || {}) },
    pitching: { ...initPitching(), ...(anyTriple?.pitching || {}) },
    fielding: { ...initFielding(), ...(anyTriple?.fielding || {}) },
    baserunning: { ...initBaserun(), ...(anyTriple?.baserunning || {}) },
  };
}
function revivePlayers(raw: any): Player[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => ({
    id: Number(p?.id),
    name: String(p?.name ?? ""),
    positions: Array.isArray(p?.positions) ? p.positions : [],
    throws: ["R","L","S"].includes(p?.throws) ? p.throws : "R",
    bats:   ["R","L","S"].includes(p?.bats)   ? p.bats   : "R",
    batting:  { ...initBatting(),  ...(p?.batting  || {}) },
    pitching: { ...initPitching(), ...(p?.pitching || {}) },
    fielding: { ...initFielding(), ...(p?.fielding || {}) },
    baserunning: { ...initBaserun(), ...(p?.baserunning || {}) },
  }));
}
function reviveGames(raw: any): Game[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((g) => {
    const stats: Record<number, Triple> = {};
    if (g?.stats && typeof g.stats === "object") {
      Object.keys(g.stats).forEach((k) => { stats[Number(k)] = reviveTriple(g.stats[k]); });
    }
    const roster: RosterSnapshot = {};
    if (g?.roster && typeof g.roster === "object") {
      Object.keys(g.roster).forEach((k) => {
        roster[Number(k)] = {
          name: String(g.roster[k]?.name ?? `#${k}`),
          positions: Array.isArray(g.roster[k]?.positions) ? g.roster[k].positions : [],
        };
      });
    }
   return {
  id: Number(g?.id),
  date: String(g?.date ?? ""),
  opponent: String(g?.opponent ?? "Unknown"),
  season: g?.season ?? "",          // ← 新增
  tag: g?.tag ?? "",                // ← 新增
  lineup: Array.isArray(g?.lineup) ? g.lineup.map((n: any) => Number(n)) : [],
  innings: Array.isArray(g?.innings) ? g.innings.map(toNonNegNum) : Array(9).fill(0),
  stats,
  locked: !!g?.locked,
  roster,
  winPid: Number(g?.winPid) || undefined,   // ← 新增
  lossPid: Number(g?.lossPid) || undefined, // ← 新增
  savePid: Number(g?.savePid) || undefined, // ← 新增
};

  });
}
function getNameAndPositions(players: Player[], g: Game, pid: number) {
  const p = players.find((x) => x.id === pid);
  if (p) return { name: p.name, positions: p.positions };
  const snap = g.roster?.[pid];
  return snap ? { name: snap.name, positions: snap.positions } : { name: `#${pid}`, positions: [] };
}

/* CSV 文字欄位防注入（=,+,-,@ 開頭）+ 引號逸出 */
function csvText(s: string) {
  let t = String(s);
  if (/^[=+\-@]/.test(t)) t = "'" + t;
  t = t.replace(/"/g, '""');
  return `"${t}"`;
}

/* ⅓局轉換：支援 6.1 / 6.2 記法 */
function ipToInnings(ipRaw: any) {
  const ip = Number(ipRaw) || 0;
  const w = Math.trunc(ip);
  const f = Number((ip - w).toFixed(1));
  if (Math.abs(f) < 1e-9) return w;
  if (Math.abs(f - 0.1) < 1e-9) return w + 1 / 3;
  if (Math.abs(f - 0.2) < 1e-9) return w + 2 / 3;
  return w + f; // 相容舊資料
}
// 將實數局數(含 1/3、2/3)轉回顯示用字串：7, 6.1, 6.2
function formatIpDisplay(ipRaw: any) {
  const n = Number(ipRaw) || 0;
  const w = Math.trunc(n);
  // 以較寬容的誤差判斷 1/3、2/3
  const f = n - w;
  if (Math.abs(f) < 1e-3) return String(w);
  if (Math.abs(f - 1/3) < 1e-3) return `${w}.1`;
  if (Math.abs(f - 2/3) < 1e-3) return `${w}.2`;
  // 其餘情況（例：.3 或資料異常），就顯示整數
  return String(Math.round(n));
}
// ===== MLB IP 進位工具：0.1 → 0.2 → 整數（.3 自動進位） =====
function ipToOutsStrict(ipRaw: any) {
  const n = Number(ipRaw) || 0;
  const w = Math.trunc(n);
  const f = Number((n - w).toFixed(1));
  let t = 0;
  if (Math.abs(f - 0.1) < 1e-9) t = 1;
  else if (Math.abs(f - 0.2) < 1e-9) t = 2;
  else t = 0;
  return w * 3 + t;
}
function outsToIpStrict(outs: number) {
  const o = Math.max(0, Math.round(outs) || 0);
  const w = Math.trunc(o / 3);
  const r = o % 3; // 0/1/2
  return Number((w + r / 10).toFixed(1));
}
function normalizeIpLike(raw: number) {
  const T = Math.round(Math.max(0, Number(raw) || 0) * 10);
  const base = Math.floor(T / 10);
  const r = ((T % 10) + 10) % 10; // 0..9
  if (r <= 2) return outsToIpStrict(base * 3 + r);
  if (r === 3) return outsToIpStrict((base + 1) * 3); // x.3 → (x+1).0
  if (r === 9) return outsToIpStrict(base * 3 + 2);   // x.9 → x.2
  if (r === 8) return outsToIpStrict(base * 3 + 1);   // x.8 → x.1
  if (r === 7) return outsToIpStrict(base * 3 + 0);   // x.7 → x.0
  return outsToIpStrict(base * 3 + 2);                // 其他夾到 .2
}
function stepIpValue(prev: number, rawNext: number) {
  const prevNum = Number(prev) || 0;
  const rawNum = Math.max(0, Number(rawNext) || 0);
  const diffTenth = Math.round((rawNum - prevNum) * 10);
  if (diffTenth === 1)  return outsToIpStrict(ipToOutsStrict(prevNum) + 1);            // ↑
  if (diffTenth === -1) return outsToIpStrict(Math.max(0, ipToOutsStrict(prevNum) - 1)); // ↓
  return normalizeIpLike(rawNum); // 手動輸入容錯
}

function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}


/* localStorage 寫入（首輪不寫，避免把舊資料覆蓋成空） */
function useDebouncedLocalStorage<T>(key: string, value: T, delay = 400) {
  const first = useRef(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (first.current) { first.current = false; return; }
    const h = setTimeout(() => {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    }, delay);
    return () => clearTimeout(h);
  }, [key, value, delay]);
}


/* ---------------- 數字輸入元件：字串輸入、失焦/Enter 才回寫 ---------------- */
type NumCellProps = { value: number | null | undefined; onCommit: (n: number) => void; maxLen?: number };
function NumCell({ value, onCommit, maxLen = 3 }: NumCellProps) {
  const [text, setText] = useState(
  (value !== null && value !== undefined) ? String(value) : ""
);

useEffect(() => {
  const next = (value !== null && value !== undefined) ? String(value) : "";
  setText(next);
}, [value]);

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      className={IN_NUM_GRID}
      value={text}
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d]/g, "").slice(0, maxLen);
        setText(v);
      }}
      onBlur={() => {
        const n = text === "" ? 0 : parseInt(text, 10);
        onCommit(Number.isFinite(n) ? n : 0);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const n = text === "" ? 0 : parseInt(text, 10);
          onCommit(Number.isFinite(n) ? n : 0);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}


/* ---------------- 資料欄位分離：比賽「中繼/中英文」文字輸入 ---------------- */
type MetaTextProps = { value: string; placeholder?: string; onCommit: (v: string) => void; className?: string };
function MetaText({ value, placeholder, onCommit, className = "border px-2 py-1 rounded" }: MetaTextProps) {
  const [t, setT] = useState(value ?? "");
  useEffect(() => { setT(value ?? ""); }, [value]);
  return (
    <input
      type="text"
      placeholder={placeholder}
      value={t}
      onChange={(e) => setT(e.target.value)}   // 允許中英文、符號；不在 onChange 做限制
      onBlur={() => onCommit(t.trim())}         // 失焦才回寫，避免影響下方數據表 re-render
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          onCommit(t.trim());
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={className}
    />
  );
}

/* =========================================================
   MLB 計算（修正版：正統 MLB 算法）
========================================================= */
function calcStats(batting: Batting, pitching: Pitching, fielding: Fielding, baserunning: Baserun) {
  const H  = toNonNegNum(batting["1B"]) + toNonNegNum(batting["2B"]) + toNonNegNum(batting["3B"]) + toNonNegNum(batting.HR);

  // ➤ 正統 MLB 定義
  const AB = H + toNonNegNum(batting.GO) + toNonNegNum(batting.FO) + toNonNegNum(batting.SO);
  const PA = AB + toNonNegNum(batting.BB) + toNonNegNum(batting.HBP) + toNonNegNum(batting.SF) + toNonNegNum(batting.SH);

  const TB = toNonNegNum(batting["1B"]) + 2*toNonNegNum(batting["2B"]) + 3*toNonNegNum(batting["3B"]) + 4*toNonNegNum(batting.HR);
  const TOB = H + toNonNegNum(batting.BB) + toNonNegNum(batting.HBP);

  const safeDiv = (a: number, b: number, d = 3) => (b > 0 ? (a / b).toFixed(d) : d === 3 ? "0.000" : "0.00");
  const AVG = safeDiv(H, AB, 3);
  const OBPden = AB + toNonNegNum(batting.BB) + toNonNegNum(batting.HBP) + toNonNegNum(batting.SF);
  const OBP = safeDiv(H + toNonNegNum(batting.BB) + toNonNegNum(batting.HBP), OBPden, 3);
  const SLG = safeDiv(TB, AB, 3);
  const OPS = (parseFloat(OBP) + parseFloat(SLG)).toFixed(3);
  const BBK = safeDiv(toNonNegNum(batting.BB), toNonNegNum(batting.SO), 2);

  // Runs Created（簡化版）
  const RC  = AB + toNonNegNum(batting.BB) > 0
    ? (((H + toNonNegNum(batting.BB)) * TB) / (AB + toNonNegNum(batting.BB))).toFixed(1)
    : "0.0";

  const ip = ipToInnings(Number(pitching.IP));
  const ERA  = safeDiv(toNonNegNum(pitching.ER) * 9, ip, 2);
  const WHIP = safeDiv(toNonNegNum(pitching.BB) + toNonNegNum(pitching.H), ip, 2);
  const K9   = safeDiv(toNonNegNum(pitching.K) * 9, ip, 2);
  const FIP  = ip > 0 ? ((13*toNonNegNum(pitching.HR) + 3*toNonNegNum(pitching.BB) - 2*toNonNegNum(pitching.K)) / ip + 3.2).toFixed(2) : "0.00";
  const BB9  = safeDiv(toNonNegNum(pitching.BB) * 9, ip, 2);
  const H9   = safeDiv(toNonNegNum(pitching.H)  * 9, ip, 2);
  const KBB  = safeDiv(toNonNegNum(pitching.K), toNonNegNum(pitching.BB), 2);
  const OBA  = safeDiv(toNonNegNum(pitching.H), toNonNegNum(pitching.AB), 3);
  const PC   = toNonNegNum(pitching.PC);

  const FPCT = toNonNegNum(fielding.PO) + toNonNegNum(fielding.A) + toNonNegNum(fielding.E) > 0
    ? ((toNonNegNum(fielding.PO) + toNonNegNum(fielding.A)) / (toNonNegNum(fielding.PO) + toNonNegNum(fielding.A) + toNonNegNum(fielding.E))).toFixed(3)
    : "1.000";

  const SB = toNonNegNum(baserunning.SB);
  const CS = toNonNegNum(baserunning.CS);
  const SBP = SB + CS > 0 ? ((SB / (SB + CS)) * 100).toFixed(1) + "%" : "0%";

  return { AB, H, AVG, OBP, SLG, OPS, ERA, WHIP, K9, FIP, FPCT, PA, TB, TOB, BBK, RC,
           R: toNonNegNum(batting.R), RBI: toNonNegNum(batting.RBI), SH: toNonNegNum(batting.SH),
           SB, CS, SBP, BB9, H9, KBB, OBA, PC };
}

/* =========================================================
   主頁
========================================================= */
export default function Home() {
  const [topTab, setTopTab] = useState<"players" | "features">("players");
  const [subTab, setSubTab] = useState<"box" | "compare" | "career" | "export"| "trend">("box");
  const [textDraft, setTextDraft] = useState<
  Record<number, { season: string; tag: string; opponent: string }>
>({});

function getTextDraft(g: Game) {
  const d = textDraft[g.id] || {};
  return {
    season: d.season ?? g.season ?? "",
    tag: d.tag ?? g.tag ?? "",
    opponent: d.opponent ?? g.opponent ?? "",
  };
}


const setDraft = (gid: number, patch: Partial<{season:string; tag:string; opponent:string}>) =>
  setTextDraft(d => ({ ...d, [gid]: { ...(d[gid] || {}), ...patch } }));

const commitDraft = (gid: number) => {
  const d = textDraft[gid]; if (!d) return;
  setGames(prev => prev.map(x => x.id === gid ? { ...x, season: d.season, tag: d.tag, opponent: d.opponent } : x));
};

  // SSR/CSR 一致：初值一律空；掛載後再載入
  const [players, setPlayers] = useState<Player[]>([]);
  const [games,   setGames]   = useState<Game[]>([]);
  const [compare, setCompare] = useState<number[]>([]);
  const [mounted, setMounted] = useState(false);
  const [ipDraft, setIpDraft] = useState<Record<string, string>>({});
  // 雲端 updated_at（做覆蓋確認用）
  const [cloudTS, setCloudTS] = useState<string | null>(null);

  // 掛載後載入「本機」資料（你也可以改成預設讀雲端，見下方注解）
  useEffect(() => {
    setMounted(true);
    if (typeof window === "undefined") return;
    setPlayers(revivePlayers(safeParse(localStorage.getItem(STORAGE.players), [])));
    setGames(reviveGames(safeParse(localStorage.getItem(STORAGE.games), [])));
    const cmp = safeParse(localStorage.getItem(STORAGE.compare), []);
    setCompare(Array.isArray(cmp) ? cmp.map((x: any) => Number(x)).filter(Number.isFinite) : []);
  }, []);

  // 本機自動同步（首輪不寫入）
  useDebouncedLocalStorage(STORAGE.players, players, 400);
  useDebouncedLocalStorage(STORAGE.games,   games,   400);
  useDebouncedLocalStorage(STORAGE.compare, compare, 400);

  /* ---------------- 雲端同步 ---------------- */


  async function loadFromCloud() {
    const { data, error } = await supabase
      .from("app_state")
      .select("data, updated_at")
      .eq("id", "default")
      .maybeSingle();

    if (error) {
      alert("雲端載入失敗：" + error.message);
      return;
    }
    const payload = data?.data ?? {};
    setPlayers(revivePlayers(payload.players ?? []));
    setGames(reviveGames(payload.games ?? []));
    setCompare(Array.isArray(payload.compare) ? payload.compare.map((x: any) => Number(x)).filter(Number.isFinite) : []);
    setCloudTS(data?.updated_at ?? null);
    alert("已從雲端載入。");
  }

  async function saveToCloud() {
    // 確認是否覆蓋較新版本
    const { data: cur, error: e1 } = await supabase
      .from("app_state")
      .select("updated_at")
      .eq("id", "default")
      .maybeSingle();
    if (e1) { alert("雲端檢查失敗：" + e1.message); return; }
    const remoteTS = cur?.updated_at || null;
    if (remoteTS && cloudTS && remoteTS !== cloudTS) {
      const ok = confirm("偵測到雲端有較新的版本，確定要覆蓋嗎？");
      if (!ok) return;
    }

    const payload = { players, games, compare, v: 3, savedAt: new Date().toISOString() };
    const { data, error } = await supabase
      .from("app_state")
      .upsert({ id: "default", data: payload, updated_at: new Date().toISOString() })
      .select("updated_at")
      .single();

    if (error) { alert("雲端存檔失敗：" + error.message); return; }
    setCloudTS(data?.updated_at ?? null);
    alert("已存到雲端。");
  }

  /* ---------------- Navbar ---------------- */
  // 放在檔案頂部任意位置（在 component 外也可）
const BUILD = process.env.NEXT_PUBLIC_BUILD ?? "";

async function hardRefresh() {
  try {
    // 清掉 Cache Storage（含舊版 PWA 快取）
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    // 叫 service worker 拉新版本（如果有裝 PWA）
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.update()));
    }
  } finally {
    // 以版本碼做 cache-busting
    const url = new URL(window.location.href);
    url.searchParams.set("v", BUILD || String(Date.now()));
    window.location.replace(url.toString());
  }
}

const Navbar = () => (
  <div className="w-full sticky top-0 z-10 bg-[#08213A] text-white flex items-center gap-4 px-4 py-2">
    <img src="/37758.jpg" alt="RS" className="h-8 w-auto rounded-sm border border-white/20 bg-white object-contain" />
    <div className="font-bold tracking-wide">RS Baseball Manager</div>
    <div className="ml-auto flex flex-wrap gap-2">
      <button
        onClick={() => setTopTab("players")}
        className={`${BTN} ${topTab === "players" ? "bg-white text-[#08213A]" : "bg-white/10 hover:bg-white/20"}`}
      >球員清單</button>

      <button
        onClick={() => { setTopTab("features"); setSubTab("box"); }}
        className={`${BTN} ${topTab === "features" && subTab === "box" ? "bg-white text-[#08213A]" : "bg-white/10 hover:bg-white/20"}`}
      >比賽紀錄</button>

      <button
        onClick={() => { setTopTab("features"); setSubTab("career"); }}
        className={`${BTN} ${topTab === "features" && subTab === "career" ? "bg-white text-[#08213A]" : "bg-white/10 hover:bg-white/20"}`}
      >生涯數據</button>

      <button
        onClick={() => { setTopTab("features"); setSubTab("compare"); }}
        className={`${BTN} ${topTab === "features" && subTab === "compare" ? "bg-white text-[#08213A]" : "bg-white/10 hover:bg-white/20"}`}
      >球員對比</button>

      <button
  onClick={() => { setTopTab("features"); setSubTab("trend"); }}
  className={`${BTN} ${topTab === "features" && subTab === "trend" ? "bg-white text-[#08213A]" : "bg-white/10 hover:bg-white/20"}`}
>趨勢圖</button>

<button
  onClick={hardRefresh}
  className="px-3 py-1 rounded border text-xs md:text-sm bg-white text-slate-900"
  title={BUILD ? `版本 ${BUILD}` : "檢查更新"}
>
  檢查更新{BUILD ? ` · ${BUILD.slice(0, 7)}` : ""}
</button>


      <button
        onClick={() => { setTopTab("features"); setSubTab("export"); }}
        className={`${BTN} ${topTab === "features" && subTab === "export" ? "bg-white text-[#08213A]" : "bg-white/10 hover:bg-white/20"}`}
      >匯出</button>
    </div>
  </div>
);




  /* ---------------- 新增 / 刪除（含保護） ---------------- */
  const emptyTriple = (): Triple => ({ batting: initBatting(), pitching: initPitching(), fielding: initFielding(), baserunning: initBaserun() });

  const addPlayer = (p: Omit<Player, "id" | "batting" | "pitching" | "fielding" | "baserunning">) => {
    setPlayers((prev) => [...prev, {
      id: Date.now(), name: p.name.trim(), positions: p.positions, throws: p.throws, bats: p.bats,
      batting: initBatting(), pitching: initPitching(), fielding: initFielding(), baserunning: initBaserun(),
    }]);
  };

  const deletePlayer = (id: number) => {
    const usedInUnlocked = games.some((g) => !g.locked && g.lineup.includes(id));
    if (usedInUnlocked) return alert("此球員仍在未鎖定打線中，請先移除或鎖定比賽再刪除。");
    setPlayers((prev) => prev.filter((x) => x.id !== id));
    setCompare((prev) => prev.filter((x) => x !== id));
    setGames((prev) => prev.map((g) => (g.locked ? g : { ...g, lineup: g.lineup.filter((pid) => pid !== id) })));
  };

  const clearPlayers = () => { if (confirm("確定清空所有球員？")) { setPlayers([]); setCompare([]); } };

  /* ---------------- 比賽：新增 / 編輯 / 鎖定 ---------------- */
const addGame = () => {
  const opponent = prompt("對手名稱") || "Unknown";
  const date = localDateStr();
  setGames((prev) => [...prev, {
  id: Date.now(),
  date,
  opponent,
  season: "",            // ← 新增
  tag: "",               // ← 新增
  lineup: [],
  innings: Array(9).fill(0),
  stats: {},
  locked: false,
  roster: {},
  winPid: undefined,     // ← 新增
  lossPid: undefined,    // ← 新增
  savePid: undefined,    // ← 新增
}]);

};

  const lockGame = (gid: number) => {
    commitDraft(gid); // ← 加這行
  if (!confirm("存檔後將無法再編輯此場比賽，確定存檔？")) return;

  setGames((prev) => prev.map((g) => {
    if (g.id !== gid) return g;

    // 1) 先把目前輸入框的 IP 草稿寫回 stats
    const stats: Record<number, Triple> = { ...g.stats };
    g.lineup.forEach((pid) => {
      const key = `${g.id}:${pid}`;
      const draft = ipDraft[key];
      if (draft !== undefined && draft !== "") {
        const prevTriple = stats[pid] ?? emptyTriple();
        const rawValue = (prevTriple.pitching as any).IP ?? 0;
        const next = stepIpValue(Number(rawValue || 0), Number(draft || "0"));
        stats[pid] = {
          ...prevTriple,
          pitching: { ...prevTriple.pitching, IP: toNonNegNum(next) },
        };
      }
    });

    // 2) 建立名單快照，鎖定
    const snap: RosterSnapshot = {};
    g.lineup.forEach((pid) => {
      const info = getNameAndPositions(players, g, pid);
      snap[pid] = { name: info.name, positions: info.positions };
    });

    return { ...g, stats, locked: true, roster: snap };
  }));

  // 3) 清掉這場比賽的 ipDraft
  setIpDraft((d) => {
    const nd = { ...d };
    Object.keys(nd).forEach((k) => { if (k.startsWith(`${gid}:`)) delete nd[k]; });
    return nd;
  });
};

  // ⭐ 新增：刪除比賽
  const deleteGame = (gid: number) => {
    const g = games.find(x => x.id === gid);
    if (!g) return;
    if (!g.locked) {
      alert("請先存檔鎖定比賽，再刪除。");
      return;
    }
    if (!confirm(`確定刪除比賽？\n\n日期：${g.date}\n對手：${g.opponent}`)) return;
    setGames(prev => prev.filter(x => x.id !== gid));
  };

  const updateGameStat = (gid: number, pid: number, section: keyof Triple, key: string, val: number) => {
    const safeVal = Math.max(0, Number(val) || 0);
    setGames((prev) => prev.map((g) => {
      if (g.id !== gid || g.locked) return g;
      const prevTriple = g.stats[pid] ?? emptyTriple();
      return { ...g, stats: { ...g.stats, [pid]: { ...prevTriple, [section]: { ...(prevTriple as any)[section], [key]: safeVal } } } };
    }));
  };

  const updateInning = (gid: number, idx: number, val: number) => {
    const safeVal = Math.max(0, Number(val) || 0);
    setGames((prev) => prev.map((g) => {
      if (g.id !== gid || g.locked) return g;
      const innings = [...g.innings]; innings[idx] = safeVal; return { ...g, innings };
    }));
  };

  const addToLineup = (g: Game, pid: number) => {
    if (g.locked || g.lineup.includes(pid) || g.lineup.length >= 9) return;
    setGames((prev) => prev.map((x) => x.id === g.id ? {
      ...x, lineup: [...x.lineup, pid], stats: x.stats[pid] ? x.stats : { ...x.stats, [pid]: emptyTriple() },
    } : x));
  };

  const removeFromLineup = (g: Game, pid: number) => {
    if (g.locked) return;
    setGames((prev) => prev.map((x) => x.id === g.id ? { ...x, lineup: x.lineup.filter((id) => id !== pid) } : x));
  };

  const onDragEnd = (g: Game) => (result: DropResult) => {
    if (!result.destination || g.locked) return;
    setGames((prev) => prev.map((x) => {
      if (x.id !== g.id) return x;
      const arr = [...x.lineup]; const [removed] = arr.splice(result.source.index, 1);
      arr.splice(result.destination!.index, 0, removed);
      return { ...x, lineup: arr.slice(0, 9) };
    }));
  };

  /* ---------------- 生涯同步 ---------------- */
  const syncCareer = () => {
    setPlayers((prev) => prev.map((p) => {
      const b = initBatting(), pi = initPitching(), f = initFielding(), br = initBaserun();
      games.forEach((g) => {
        const cur = g.stats[p.id]; if (!cur) return;
        (Object.keys(b)  as (keyof Batting)[]).forEach((k) => ((b  as any)[k] += toNonNegNum((cur.batting      as any)[k])));
        (Object.keys(pi) as (keyof Pitching)[]).forEach((k) => ((pi as any)[k] += toNonNegNum((cur.pitching     as any)[k])));
        (Object.keys(f)  as (keyof Fielding)[]).forEach((k) => ((f  as any)[k] += toNonNegNum((cur.fielding     as any)[k])));
        (Object.keys(br) as (keyof Baserun)[] ).forEach((k) => ((br as any)[k] += toNonNegNum((cur.baserunning  as any)[k])));
      });
      return { ...p, batting: b, pitching: pi, fielding: f, baserunning: br };
    }));
    alert("生涯數據已同步（累加所有比賽）。");
  };

  /* ---------------- 匯入/匯出 ---------------- */
  const importJSON = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result) || "{}");
        const ps  = revivePlayers(raw?.players ?? []);
        const gs  = reviveGames(raw?.games ?? []);
        setPlayers(ps); setGames(gs); setCompare([]);
        alert("匯入完成！");
      } catch { alert("JSON 解析失敗，請確認檔案格式。"); }
    };
    reader.readAsText(file);
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify({ players, games, compare }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = "rs-baseball.json"; a.click(); URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    const headers = ["Name","Pos","AB","H","AVG","OBP","SLG","OPS","ERA","WHIP","K9","FIP","FPCT"];
    let csv = headers.join(",") + "\n";
    players.forEach((p) => {
      const s = calcStats(p.batting, p.pitching, p.fielding, p.baserunning);
      csv += [
        csvText(p.name),
        csvText(p.positions.join("/")),
        s.AB, s.H, s.AVG, s.OBP, s.SLG, s.OPS, s.ERA, s.WHIP, s.K9, s.FIP, s.FPCT
      ].join(",") + "\n";
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = "rs-baseball.csv"; a.click(); URL.revokeObjectURL(url);
  };

  const exportGameCSV = (g: Game) => {
    const headers = ["Player","Pos","AB","H","AVG","OBP","SLG","OPS","ERA","WHIP","K9","FIP","FPCT","R","RBI","TB","TOB","BBK","SB","CS","SBP","PC"];
    let csv = headers.join(",") + "\n";
    g.lineup.forEach((pid) => {
      const { name, positions } = getNameAndPositions(players, g, pid);
      const cur = g.stats[pid] ?? emptyTriple();
      const s = calcStats(cur.batting, cur.pitching, cur.fielding, cur.baserunning);
      const isP = positions.includes("P");
      csv += [
        csvText(name),
        csvText(positions.join("/")),
        s.AB, s.H, s.AVG, s.OBP, s.SLG, s.OPS,
        isP ? s.ERA : "-", isP ? s.WHIP : "-", isP ? s.K9 : "-", isP ? s.FIP : "-", s.FPCT,
        s.R, s.RBI, s.TB, s.TOB, s.BBK, s.SB, s.CS, s.SBP, isP ? s.PC : "-"
      ].join(",") + "\n";
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `game-${g.date.replace(/\//g, "-")}-vs-${g.opponent}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  /* ---------------- UI：新增球員 ---------------- */
  const PlayersForm = () => {
    const [name, setName] = useState("");
    const [posSel, setPosSel] = useState<string[]>([]);
    const [throws, setThrows] = useState<"R" | "L" | "S">("R");
    const [bats, setBats]     = useState<"R" | "L" | "S">("R");

    const togglePos = (p: string) => setPosSel((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
    const submit = () => {
      if (!name.trim()) return alert("請輸入姓名");
      if (posSel.length === 0) return alert("至少選一個守備位置");
      addPlayer({ name, positions: posSel, throws, bats });
      setName(""); setPosSel([]); setThrows("R"); setBats("R");
    };

    return (
      <div className="border rounded p-3 space-y-3 bg-white">
        <h3 className="font-semibold">新增球員</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="姓名" className="border rounded px-2 py-1" />
          <div className="flex flex-wrap gap-2">
            {MLB_POSITIONS.map((p) => (
              <label key={p} className="text-sm flex items-center gap-1">
                <input type="checkbox" checked={posSel.includes(p)} onChange={() => togglePos(p)} />{p}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">投：
            {HANDS.map((h) => (
              <label key={h} className="text-sm flex items-center gap-1">
                <input type="radio" name="throws" checked={throws === h} onChange={() => setThrows(h)} />{h}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">打：
            {HANDS.map((h) => (
              <label key={h} className="text-sm flex items-center gap-1">
                <input type="radio" name="bats" checked={bats === h} onChange={() => setBats(h)} />{h}
              </label>
            ))}
          </div>
          <button onClick={submit} className="bg-blue-600 text-white px-3 py-1 rounded">新增</button>
          <button onClick={clearPlayers} className="bg-red-500 text-white px-3 py-1 rounded">清空球員</button>
        </div>
      </div>
    );
  };

  const PlayersList = () => (
    <div className="space-y-3">
      {players.map((p) => {
        const s = calcStats(p.batting, p.pitching, p.fielding, p.baserunning);
        return (
          <div key={p.id} className="border rounded p-3 bg-white">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{p.name}（{p.positions.join("/")}） 投:{p.throws} 打:{p.bats}</div>
              <button onClick={() => deletePlayer(p.id)} className="text-sm bg-black text-white px-2 py-1 rounded">刪除</button>
            </div>
            <div className="text-sm mt-2 space-y-1">
              <div>打擊：AB {s.AB}、H {s.H}、AVG {s.AVG}、OBP {s.OBP}、SLG {s.SLG}、OPS {s.OPS}</div>
              {p.positions.includes("P") && <div>投手：ERA {s.ERA}、WHIP {s.WHIP}、K/9 {s.K9}、FIP {s.FIP}</div>}
              <div>守備：FPCT {s.FPCT}</div>
            </div>
          </div>
        );
      })}
      {players.length === 0 && <div className="text-gray-500 text-sm">尚無球員，請先新增。</div>}
    </div>
  );

  /* ---------------- UI：比賽紀錄  BoxScore---------------- */
  
const BoxScore = () => (
  <div className="space-y-4">
    <div className="flex items-center gap-2">
      <button onClick={addGame} className="bg-blue-600 text-white px-3 py-1 rounded">新增比賽</button>
    </div>

    {games.map((g) => {
      let teamH = 0, teamE = 0;
      g.lineup.forEach((pid) => {
        const cur = g.stats[pid] ?? emptyTriple();
        teamH += toNonNegNum(cur.batting["1B"]) + toNonNegNum(cur.batting["2B"]) + toNonNegNum(cur.batting["3B"]) + toNonNegNum(cur.batting.HR);
        teamE += toNonNegNum(cur.fielding.E);
      });
      const teamR = g.innings.reduce((a, b) => a + toNonNegNum(b), 0);
      

  const d = getTextDraft(g);

      return (
        <div key={g.id} className="border rounded p-3 bg-white space-y-4">
          {/* 標題列 + 匯出按鈕 */}
          <div className="flex items-center gap-3">
            {!g.locked ? (
  <div className="flex items-center gap-2">
    <input
      type="date"
      value={g.date}
      onChange={(e) => setGames(prev => prev.map(x => x.id === g.id ? { ...x, date: e.target.value } : x))}
      className="border px-2 py-1 rounded"
    />



{/* Season */}
<MetaText
  placeholder="Season"
  value={d.season}
  onCommit={(v) => setGames(prev => prev.map(x => x.id === g.id ? { ...x, season: v } : x))}
  className="border px-2 py-1 rounded"
/>

{/* Tag */}
<MetaText
  placeholder="Tag"
  value={d.tag}
  onCommit={(v) => setGames(prev => prev.map(x => x.id === g.id ? { ...x, tag: v } : x))}
  className="border px-2 py-1 rounded"
/>

{/* 對手 */}
<MetaText
  placeholder="對手"
  value={g.opponent}
  onCommit={(v) =>
    setGames(prev =>
      prev.map(x => x.id === g.id ? { ...x, opponent: v } : x)
    )
  }
  className="border px-2 py-1 rounded"
/>





  </div>
) : (
  <h3 className="font-semibold">{g.date} vs {g.opponent}</h3>
)}

            <div className="ml-auto flex gap-2">
              {!g.locked && (
                <button onClick={() => lockGame(g.id)} className="bg-emerald-600 text-white px-3 py-1 rounded">存檔鎖定</button>
              )}
              {g.locked && (
                <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">已鎖定</span>
              )}
              {g.locked && (
  <div className="flex items-center gap-2 flex-wrap">
    {/* 勝投 */}
    <select
      value={g.winPid ?? ""}
      onChange={(e) =>
        setGames(prev =>
          prev.map(x =>
            x.id === g.id
              ? {
                  ...x,
                  winPid: e.target.value ? Number(e.target.value) : undefined,
                  // 避免同人同時拿 W/S 或 W/L
                  ...(e.target.value && Number(e.target.value) === x.savePid ? { savePid: undefined } : {}),
                  ...(e.target.value && Number(e.target.value) === x.lossPid ? { lossPid: undefined } : {}),
                }
              : x
          )
        )
      }
      className="border px-2 py-1 rounded"
      title="勝投"
    >
      <option value="">W: 未指派</option>
      {Object.keys(g.roster).map((k) => {
        const pid = Number(k);
        const name = g.roster[pid]?.name ?? `#${pid}`;
        return (
          <option key={pid} value={pid}>{name}</option>
        );
      })}
    </select>

    {/* 敗投 */}
    <select
      value={g.lossPid ?? ""}
      onChange={(e) =>
        setGames(prev =>
          prev.map(x =>
            x.id === g.id
              ? {
                  ...x,
                  lossPid: e.target.value ? Number(e.target.value) : undefined,
                  // 避免同人同時拿 W/L
                  ...(e.target.value && Number(e.target.value) === x.winPid ? { winPid: undefined } : {}),
                }
              : x
          )
        )
      }
      className="border px-2 py-1 rounded"
      title="敗投"
    >
      <option value="">L: 未指派</option>
      {Object.keys(g.roster).map((k) => {
        const pid = Number(k);
        const name = g.roster[pid]?.name ?? `#${pid}`;
        return (
          <option key={pid} value={pid}>{name}</option>
        );
      })}
    </select>

    {/* 救援成功 */}
    <select
      value={g.savePid ?? ""}
      onChange={(e) =>
        setGames(prev =>
          prev.map(x =>
            x.id === g.id
              ? {
                  ...x,
                  savePid: e.target.value ? Number(e.target.value) : undefined,
                  // 避免同人同時拿 W/S
                  ...(e.target.value && Number(e.target.value) === x.winPid ? { winPid: undefined } : {}),
                }
              : x
          )
        )
      }
      className="border px-2 py-1 rounded"
      title="救援"
    >
      <option value="">S: 未指派</option>
      {Object.keys(g.roster).map((k) => {
        const pid = Number(k);
        const name = g.roster[pid]?.name ?? `#${pid}`;
        return (
          <option key={pid} value={pid}>{name}</option>
        );
      })}
    </select>
  </div>
)}
              <button onClick={() => exportGameCSV(g)} className="bg-gray-700 text-white px-3 py-1 rounded">匯出 CSV</button>
             <button
  onClick={() => deleteGame(g.id)}
  disabled={!g.locked}
  className={`px-3 py-1 rounded text-white ${
    g.locked ? "bg-red-600 hover:bg-red-700" : "bg-red-600/40 cursor-not-allowed"
  }`}
>
  刪除
</button>

            </div>
          </div>

          {/* 可加入名單 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="border rounded p-2">
              <div className="font-semibold mb-2">可加入名單（點擊加入，最多 9 人）</div>
              <div className="flex flex-wrap gap-2">
                {players.filter((p) => !g.lineup.includes(p.id)).map((p) => (
                  <button key={p.id}
                    className={`px-2 py-1 rounded border ${g.lineup.length >= 9 || g.locked ? "opacity-40 cursor-not-allowed" : ""}`}
                    onClick={() => addToLineup(g, p.id)} disabled={g.lineup.length >= 9 || g.locked}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            {/* 打線拖曳 */}
            <div className="border rounded p-2">
              <div className="font-semibold mb-2">打線（拖曳排序，可移除）</div>
              <DragDropContext onDragEnd={onDragEnd(g)}>
                <Droppable droppableId={`lineup-${g.id}`}>
                  {(prov) => (
                    <ul ref={prov.innerRef} {...prov.droppableProps} className="space-y-1">
                      {g.lineup.map((pid, idx) => {
                        const info = getNameAndPositions(players, g, pid);
                        return (
                          <Draggable key={pid} draggableId={`${pid}`} index={idx} isDragDisabled={g.locked}>
                            {(p2) => (
                              <li
  ref={p2.innerRef}
  {...p2.draggableProps}
  {...p2.dragHandleProps}
  className="flex items-center justify-between bg-gray-50 border rounded px-2 py-2 md:py-2.5 touch-none select-none"
>
  <span className="flex-1 pr-2">{idx + 1}棒 — {info.name}（{info.positions.join("/") || "—"}）</span>
  {!g.locked && (
    <button onClick={() => removeFromLineup(g, pid)} className="text-xs md:text-sm bg-red-500 text-white px-2.5 md:px-3 py-0.5 md:py-1 rounded">✖</button>
  )}
</li>
                            )}
                          </Draggable>
                        );
                      })}
                      {prov.placeholder}
                    </ul>
                  )}
                </Droppable>
              </DragDropContext>
            </div>
          </div>

          {/* 每位球員本場輸入 */}
          <div className="space-y-3">
            {g.lineup.map((pid) => {
              const info = getNameAndPositions(players, g, pid);
              const cur = g.stats[pid] ?? emptyTriple();
              const readOnly = g.locked;

              return (
                <div key={pid} className="border rounded p-2">
  <div className="font-semibold mb-1">{info.name}</div>

                  {/* 打擊 */}
                  <table className="border text-sm mb-2 w-full">
                    <thead>
                      <tr>{Object.keys(initBatting()).map((k) => <th key={k} className="border px-2 py-1">{k}</th>)}</tr>
                    </thead>
                    <tbody>
                      <tr>
                        {Object.keys(initBatting()).map((stat) => (
                          <td key={stat} className="border px-2 py-1 text-center">
                            {readOnly ? toNonNegNum((cur.batting as any)[stat]) : (
                              <NumCell value={toNonNegNum((cur.batting as any)[stat])} onCommit={(n) => updateGameStat(g.id, pid, "batting", stat, n)} />
                            )}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>

                {/* 投手（僅 P 顯示） */}
{info.positions.includes("P") && (
  <table className="border text-sm mb-2 w-full">
    <thead>
      <tr>
        {Object.keys(initPitching()).map((k) => (
          <th key={k} className="border px-2 py-1">{k}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      <tr>
        {Object.keys(initPitching()).map((stat) => {
  const isIP = stat === "IP";
  const key = `${g.id}:${pid}`;                 // 每場比賽 × 球員 的唯一 key
  const rawValue = (cur.pitching as any)[stat]; // 現存的數值

  return (
    <td key={stat} className="border px-2 py-1 text-center">
     {readOnly ? (
 isIP ? formatIpDisplay(ipToInnings(rawValue)) : toNonNegNum(rawValue)
) : isIP ? (

<input
  type="number"
  min={0}
  step={0.1}
  className={IN_NUM_GRID}
  value={ipDraft[key] ?? String(rawValue ?? "")}
  onChange={(e) => {
    const prev = Number(ipDraft[key] ?? rawValue ?? 0) || 0;
    const raw  = parseFloat(e.target.value || "0");
    const next = stepIpValue(prev, raw);

    // 先把顯示值變成合法的 0 / 0.1 / 0.2 / 整數
    setIpDraft((d) => ({ ...d, [key]: String(next) }));

    // 如果是按上下箭頭（±0.1），立即寫回資料
    const diffTenth = Math.round((raw - prev) * 10);
    if (diffTenth === 1 || diffTenth === -1) {
      updateGameStat(g.id, pid, "pitching", "IP", toNonNegNum(next));
    }
  }}
  onBlur={() => {
    const v = ipDraft[key];
    const next = stepIpValue(Number(rawValue || 0), Number(v || "0"));
    updateGameStat(g.id, pid, "pitching", "IP", toNonNegNum(next));
    setIpDraft((d) => { const { [key]: _, ...rest } = d; return rest; });
  }}
/>

      ) : (
                <NumCell value={toNonNegNum(rawValue)} onCommit={(n) => updateGameStat(g.id, pid, "pitching", stat, n)} />
              )}
            </td>
          );
        })}
      </tr>
    </tbody>
  </table>
)}
                 {/* 跑壘 */}
                  <table className="border text-sm mb-2 w-full">
                    <thead>
                      <tr>{Object.keys(initBaserun()).map((k) => <th key={k} className="border px-2 py-1">{k}</th>)}</tr>
                    </thead>
                    <tbody>
                      <tr>
                        {Object.keys(initBaserun()).map((stat) => (
                          <td key={stat} className="border px-2 py-1 text-center">
                            {readOnly ? toNonNegNum((cur.baserunning as any)[stat]) : (
                              <NumCell value={toNonNegNum((cur.baserunning as any)[stat])} onCommit={(n) => updateGameStat(g.id, pid, "baserunning", stat, n)} />
                            )}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>

                  {/* 守備 */}
                  <table className="border text-sm w-full">
                    <thead>
                      <tr>{Object.keys(initFielding()).map((k) => <th key={k} className="border px-2 py-1">{k}</th>)}</tr>
                    </thead>
                    <tbody>
                      <tr>
                        {Object.keys(initFielding()).map((stat) => (
                          <td key={stat} className="border px-2 py-1 text-center">
                            {readOnly ? toNonNegNum((cur.fielding as any)[stat]) : (
                              <NumCell value={toNonNegNum((cur.fielding as any)[stat])} onCommit={(n) => updateGameStat(g.id, pid, "fielding", stat, n)} />
                            )}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>

          {/* 逐局比分 */}
          <div className="overflow-x-auto md:overflow-x-visible">
  <table className="border text-sm w-full">
    <thead className="sticky top-0 bg-white z-10">

                <tr>{[1,2,3,4,5,6,7,8,9].map((n) => <th key={n} className="border px-2 py-1 text-center">{n}</th>)}
                  <th className="border px-2 py-1 text-center">R</th>
                  <th className="border px-2 py-1 text-center">H</th>
                  <th className="border px-2 py-1 text-center">E</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  {g.innings.map((v, i) => (
                    <td key={i} className="border px-2 py-1 text-center">
                      {g.locked ? toNonNegNum(v) : (
                        <NumCell value={toNonNegNum(v)} onCommit={(n) => updateInning(g.id, i, n)} />
                      )}
                    </td>
                  ))}
                  <td className="border px-2 py-1 text-center">{teamR}</td>
                  <td className="border px-2 py-1 text-center">{teamH}</td>
                  <td className="border px-2 py-1 text-center">{teamE}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 當場總結 */}
          <div className="overflow-x-auto">
            <table className="border text-sm w-full mt-2">
              <thead>
                <tr>
                  <th className="border px-2 py-1">球員</th>
                  <th className="border px-2 py-1">AB</th>
                  <th className="border px-2 py-1">H</th>
                  <th className="border px-2 py-1">AVG</th>
                  <th className="border px-2 py-1">OBP</th>
                  <th className="border px-2 py-1">SLG</th>
                  <th className="border px-2 py-1">OPS</th>
                  <th className="border px-2 py-1">ERA</th>
                  <th className="border px-2 py-1">WHIP</th>
                  <th className="border px-2 py-1">K/9</th>
                  <th className="border px-2 py-1">FIP</th>
                  <th className="border px-2 py-1">FPCT</th>
                </tr>
              </thead>
              <tbody>
                {g.lineup.map((pid) => {
                  const info = getNameAndPositions(players, g, pid);
                  const cur  = g.stats[pid] ?? emptyTriple();
                  const s = calcStats(cur.batting, cur.pitching, cur.fielding, cur.baserunning);
                  return (
                    <tr key={pid}>
                      <td className="border px-2 py-1 whitespace-nowrap sticky left-0 bg-white z-10">{info.name}</td>
                      <td className="border px-2 py-1 text-right">{s.AB}</td>
                      <td className="border px-2 py-1 text-right">{s.H}</td>
                      <td className="border px-2 py-1 text-right">{s.AVG}</td>
                      <td className="border px-2 py-1 text-right">{s.OBP}</td>
                      <td className="border px-2 py-1 text-right">{s.SLG}</td>
                      <td className="border px-2 py-1 text-right">{s.OPS}</td>
                      <td className="border px-2 py-1 text-right">{info.positions.includes("P") ? s.ERA : "-"}</td>
                      <td className="border px-2 py-1 text-right">{info.positions.includes("P") ? s.WHIP : "-"}</td>
                      <td className="border px-2 py-1 text-right">{info.positions.includes("P") ? s.K9  : "-"}</td>
                      <td className="border px-2 py-1 text-right">{info.positions.includes("P") ? s.FIP : "-"}</td>
                      <td className="border px-2 py-1 text-right">{s.FPCT}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      );
    })}
  </div>
);

  /* ---------------- UI：Compare ---------------- */
  const Compare = () => {
    const compareLive = compare.filter((id) => players.some((p) => p.id === id));
    const METRICS = ["AB","H","AVG","OBP","SLG","OPS","ERA","WHIP","K9","FIP","FPCT"];
    const CHART_METRICS = ["AVG","OBP","SLG","OPS","ERA","WHIP","K9","FPCT"];
    const colors = ["#8884d8","#82ca9d","#ffc658","#ff8a65","#90caf9"];
const makeRow = (stat: string) => {
      const row: Record<string, number | string> = { stat };
      compareLive.forEach((id) => {
        const p = players.find((x) => x.id === id); if (!p) return;
        const s = calcStats(p.batting ?? initBatting(), p.pitching ?? initPitching(), p.fielding ?? initFielding(), p.baserunning ?? initBaserun());
        const v = parseFloat((s as any)[stat]) || 0; row[p.name] = Number.isFinite(v) ? v : 0;
      });
      return row;
    };

    const tableBody = METRICS.map(makeRow);
    const chartData = CHART_METRICS.map(makeRow);

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {players.map((p) => (
            <label key={p.id} className="border px-2 py-1 rounded text-sm">
              <input type="checkbox" className="mr-1"
                checked={compare.includes(p.id)}
                onChange={(e) => setCompare((prev) => (e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)))} />
              {p.name}
            </label>
          ))}
        </div>

        {compareLive.length >= 2 ? (
          <>
            <div className="overflow-x-auto">
              <table className="border text-sm w-full bg-white">
                <thead>
                  <tr>
                    <th className="border px-2 py-1">指標</th>
                    {compareLive.map((id) => <th key={id} className="border px-2 py-1">{players.find((p) => p.id === id)?.name ?? `#${id}`}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {tableBody.map((row) => (
                    <tr key={row.stat as string}>
                      <td className="border px-2 py-1">{row.stat as string}</td>
                      {compareLive.map((id) => {
                        const name = players.find((p) => p.id === id)?.name;
                        return <td key={id} className="border px-2 py-1 text-right">{name ? (row as any)[name] : "-"}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartData}>
                <XAxis dataKey="stat" /><YAxis /><Tooltip /><Legend />
                {compareLive.map((id, i) => {
                  const name = players.find((p) => p.id === id)?.name;
                  return name ? <Bar key={id} dataKey={name} fill={colors[i % colors.length]} /> : null;
                })}
              </BarChart>
            </ResponsiveContainer>

            <ResponsiveContainer width="100%" height={360}>
              <RadarChart data={chartData}>
                <PolarGrid /><PolarAngleAxis dataKey="stat" /><PolarRadiusAxis />
                {compareLive.map((id, i) => {
                  const name = players.find((p) => p.id === id)?.name;
                  return name ? <Radar key={id} name={name} dataKey={name} stroke={colors[i % colors.length]} fill={colors[i % colors.length]} fillOpacity={0.3} /> : null;
                })}
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </>
        ) : <div className="text-sm text-gray-500">請至少勾選兩位球員進行對比。</div>}
      </div>
    );
  };
// --- 趨勢圖分頁（放在 Compare 後、ExportPanel 前） ---
type TrendTabProps = { games: Game[] };

const TrendTab = ({ games }: TrendTabProps) => {
  const data = useMemo(() => {
    return games.map((g) => {
      // 全隊合計：一場的 OPS / ERA
      let _1B=0,_2B=0,_3B=0,HR=0,BB=0,HBP=0,SF=0,SH=0,GO=0,FO=0,SO=0;
      let ER=0, OUTS=0;

      Object.values(g.stats).forEach((t) => {
        const b = t.batting, p = t.pitching;
        if (b) {
          _1B += b["1B"]||0; _2B += b["2B"]||0; _3B += b["3B"]||0; HR += b.HR||0;
          BB += b.BB||0; HBP += b.HBP||0; SF += b.SF||0; SH += b.SH||0;
          GO += b.GO||0; FO += b.FO||0; SO += b.SO||0;
        }
        if (p) {
          ER += p.ER||0;
          OUTS += Math.floor((p.IP||0))*3 + Math.round(((p.IP||0)%1)*10);
        }
      });

      const H  = _1B + _2B + _3B + HR;
      const TB = _1B + 2*_2B + 3*_3B + 4*HR;
      const AB = H + GO + FO + SO;
      const PA = AB + BB + HBP + SF + SH;
      const OBP = PA>0 ? (H+BB+HBP)/(PA-SH) : 0;
      const SLG = AB>0 ? TB/AB : 0;
      const OPS = Number((OBP + SLG).toFixed(3));
      const IP  = OUTS/3;
      const ERA = IP>0 ? Number(((ER*9)/IP).toFixed(2)) : 0;

      const d = new Date(g.date);
      const mm = d.getMonth()+1, dd = d.getDate();
      return { game: `${mm}/${dd} vs ${g.opponent||"-"}`, OPS, ERA };
    });
  }, [games]);

  return (
    <div className="w-full h-80 md:h-96">
      <ResponsiveContainer>
        <LineChart data={data}>
          <XAxis dataKey="game" tick={false} />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="OPS" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="ERA" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

  /* ---------------- Export / Career / Cloud ---------------- */
  const ExportPanel = () => (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={exportJSON} className="bg-gray-600 text-white px-3 py-1 rounded">匯出 JSON</button>
      <button onClick={exportCSV}  className="bg-gray-800 text-white px-3 py-1 rounded">匯出 CSV</button>

      <label className="inline-flex items-center gap-2 bg-white border px-3 py-1 rounded cursor-pointer">
        <span>匯入 JSON</span>
        <input type="file" accept=".json,application/json" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importJSON(f); e.currentTarget.value = ""; }} />
      </label>

      {/* ⭐ 雲端同步 */}
      <button onClick={loadFromCloud} className="bg-teal-600 text-white px-3 py-1 rounded">雲端載入</button>
      <button onClick={saveToCloud} className="bg-teal-800 text-white px-3 py-1 rounded">雲端存檔</button>
    </div>
  );

  const CareerPanel = () => {
  const [seasonFilter, setSeasonFilter] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");

  // 收集可選清單
  const seasons = useMemo(() => Array.from(new Set(games.map(g => g.season || "").filter(Boolean))), [games]);
  const tags    = useMemo(() => Array.from(new Set(games.map(g => g.tag || "").filter(Boolean))), [games]);

  // 過濾比賽
  const filteredGames = useMemo(() => {
    return games.filter(g =>
      (seasonFilter ? g.season === seasonFilter : true) &&
      (tagFilter ? g.tag === tagFilter : true)
    );
  }, [games, seasonFilter, tagFilter]);

  // 依 filteredGames 累加成每位球員的生涯合計
  const careerByPlayer = useMemo(() => {
    const acc = new Map<number, Triple>();
    players.forEach(p => acc.set(p.id, emptyTriple()));
    filteredGames.forEach(g => {
      players.forEach(p => {
        const cur = g.stats[p.id]; if (!cur) return;
        const agg = acc.get(p.id)!;
        (Object.keys(agg.batting)  as (keyof Batting)[] ).forEach(k => (agg.batting[k]  += toNonNegNum((cur.batting  as any)[k])));
        (Object.keys(agg.pitching) as (keyof Pitching)[]).forEach(k => (agg.pitching[k] += toNonNegNum((cur.pitching as any)[k])));
        (Object.keys(agg.fielding) as (keyof Fielding)[]).forEach(k => (agg.fielding[k] += toNonNegNum((cur.fielding as any)[k])));
        (Object.keys(agg.baserunning) as (keyof Baserun)[]).forEach(k => (agg.baserunning[k] += toNonNegNum((cur.baserunning as any)[k])));
      });
    });
    return acc;
  }, [players, filteredGames]);

  return (
    <div className="space-y-3">
      {/* 篩選器 */}
      <div className="flex flex-wrap gap-2">
        <select className="border px-2 py-1 rounded" value={seasonFilter} onChange={e => setSeasonFilter(e.target.value)}>
          <option value="">全部季別</option>
          {seasons.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="border px-2 py-1 rounded" value={tagFilter} onChange={e => setTagFilter(e.target.value)}>
          <option value="">全部分類</option>
          {tags.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* 表格（用 careerByPlayer 計算 calcStats） */}
      <div className="overflow-x-auto">
        {/* 表格（用 careerByPlayer 計算 calcStats） */}
<div className="overflow-x-auto">
  <table className="border text-xs w-full bg-white">
    <thead>
      <tr>
        <th className="border px-2 py-1">球員</th>
        <th className="border px-2 py-1">AB</th><th className="border px-2 py-1">H</th>
        <th className="border px-2 py-1">AVG</th><th className="border px-2 py-1">OBP</th><th className="border px-2 py-1">SLG</th><th className="border px-2 py-1">OPS</th>
        <th className="border px-2 py-1">R</th><th className="border px-2 py-1">RBI</th><th className="border px-2 py-1">SH</th>
        <th className="border px-2 py-1">TB</th><th className="border px-2 py-1">TOB</th><th className="border px-2 py-1">RC</th><th className="border px-2 py-1">BB/K</th>
        <th className="border px-2 py-1">SB</th><th className="border px-2 py-1">CS</th><th className="border px-2 py-1">SB%</th>
        <th className="border px-2 py-1">ERA</th><th className="border px-2 py-1">WHIP</th><th className="border px-2 py-1">K/9</th><th className="border px-2 py-1">BB/9</th>
        <th className="border px-2 py-1">H/9</th><th className="border px-2 py-1">K/BB</th><th className="border px-2 py-1">FIP</th><th className="border px-2 py-1">OBA</th><th className="border px-2 py-1">PC</th>
        <th className="border px-2 py-1">FPCT</th>
      </tr>
    </thead>
    <tbody>
      {players.map((p) => {
        // 從篩選後的比賽累加
        const fromGames = careerByPlayer.get(p.id) ?? emptyTriple();

        // 沒有任何場次數據 → 回退用 players 舊生涯（避免整列全 0）
        const sumTriple = (t: Triple) =>
          Object.values(t.batting).reduce((a,b)=>a+Number(b||0),0) +
          Object.values(t.pitching).reduce((a,b)=>a+Number(b||0),0) +
          Object.values(t.fielding).reduce((a,b)=>a+Number(b||0),0) +
          Object.values(t.baserunning).reduce((a,b)=>a+Number(b||0),0);
        const triple = sumTriple(fromGames) === 0
          ? { batting: p.batting, pitching: p.pitching, fielding: p.fielding, baserunning: p.baserunning }
          : fromGames;

        const s = calcStats(triple.batting, triple.pitching, triple.fielding, triple.baserunning);

        return (
          <tr key={p.id}>
            <td className="border px-2 py-1 whitespace-nowrap">{p.name}</td>
            <td className="border px-2 py-1 text-right">{s.AB}</td>
            <td className="border px-2 py-1 text-right">{s.H}</td>
            <td className="border px-2 py-1 text-right">{s.AVG}</td>
            <td className="border px-2 py-1 text-right">{s.OBP}</td>
            <td className="border px-2 py-1 text-right">{s.SLG}</td>
            <td className="border px-2 py-1 text-right">{s.OPS}</td>
            <td className="border px-2 py-1 text-right">{s.R}</td>
            <td className="border px-2 py-1 text-right">{s.RBI}</td>
            <td className="border px-2 py-1 text-right">{s.SH}</td>
            <td className="border px-2 py-1 text-right">{s.TB}</td>
            <td className="border px-2 py-1 text-right">{s.TOB}</td>
            <td className="border px-2 py-1 text-right">{s.RC}</td>
            <td className="border px-2 py-1 text-right">{s.BBK}</td>
            <td className="border px-2 py-1 text-right">{s.SB}</td>
            <td className="border px-2 py-1 text-right">{s.CS}</td>
            <td className="border px-2 py-1 text-right">{s.SBP}</td>
            <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.ERA  : "-"}</td>
            <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.WHIP : "-"}</td>
            <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.K9   : "-"}</td>
            <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.BB9  : "-"}</td>
            <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.H9   : "-"}</td>
            <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.KBB  : "-"}</td>
            <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.FIP  : "-"}</td>
            <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.OBA  : "-"}</td>
            <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.PC   : "-"}</td>
            <td className="border px-2 py-1 text-right">{s.FPCT}</td>
          </tr>
        );
      })}
    </tbody>
  </table>
</div>
      </div>
    </div>
  );
};


  /* ---------------- Render ---------------- */
  if (!mounted) {
    // 首輪渲染固定骨架，避免 SSR/CSR diff
    return <div suppressHydrationWarning className="text-gray-500 text-sm p-3">載入中…</div>;
  }

  return (
    <div className="min-h-screen bg-[#f6f7fb]">
      <Navbar />
      <div className="max-w-6xl mx-auto p-4 space-y-4">
        {topTab === "players" && (<><PlayersForm /><PlayersList /></>)}
        {topTab === "features" && (
          <div className="space-y-4">
           {subTab === "box" && <BoxScore />}
{subTab === "compare" && <Compare />}
{subTab === "trend" && <TrendTab games={games} />}
{subTab === "export" && <ExportPanel />}
{ /* Career 已在這裡 */ }

{subTab === "career" && <CareerPanel />}

          </div>
        )}
      </div>
    </div>
  );
}