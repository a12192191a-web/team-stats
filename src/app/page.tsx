"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from "recharts";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
/* =========================================================
   共用 class
========================================================= */
const BTN = "px-3 py-1 md:px-4 md:py-2 rounded";
const IN_NUM = "w-16 md:w-20 h-9 md:h-10 border rounded px-1.5 text-right";

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
  lineup: number[];
  innings: number[];
  stats: Record<number, Triple>;
  locked: boolean;
  roster: RosterSnapshot;
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
      lineup: Array.isArray(g?.lineup) ? g.lineup.map((n: any) => Number(n)) : [],
      innings: Array.isArray(g?.innings) ? g.innings.map(toNonNegNum) : Array(9).fill(0),
      stats, locked: !!g?.locked, roster,
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

// 正規化：把任何十進位 IP 轉成 MLB 合法小數（.0/.1/.2），多的出局數自動進位
function normalizeIpDecimal(ipRaw: any): number {
  const ip = Math.max(0, Number(ipRaw) || 0);
  const whole = Math.trunc(ip);
  const tenths = Math.round((ip - whole) * 10); // 0..9 對應 outs 數
  const totalOuts = whole * 3 + tenths;
  const innings = Math.floor(totalOuts / 3);
  const remOuts = totalOuts % 3;                // 0,1,2
  const frac = remOuts === 0 ? 0 : remOuts === 1 ? 0.1 : 0.2;
  return +(innings + frac).toFixed(1);
}

// 顯示用：把任何輸入（小數或實數）照 MLB 記法顯示成 7 / 6.1 / 6.2
function formatIpDisplay(ipRaw: any) {
  const n = normalizeIpDecimal(ipRaw);          // 先規範化
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/* ⅓局轉換：以 outs 為準，支援 .3 以上自動進位（計算端用） */
function ipToInnings(ipRaw: any) {
  const ip = Math.max(0, Number(ipRaw) || 0);
  const whole = Math.trunc(ip);
  const tenths = Math.round((ip - whole) * 10); // 0..9
  const totalOuts = whole * 3 + tenths;
  return totalOuts / 3;                          // 回傳實數局數（含 1/3、2/3）
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
  const [subTab, setSubTab] = useState<"box" | "compare" | "career" | "export">("box");

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
const Navbar = () => (
  <div className="w-full sticky top-0 z-10 bg-[#08213A] text-white flex items-center gap-4 px-4 py-2">
    <img src="/37758.jpg" alt="RS" className="h-8 w-auto rounded-sm border border-white/20 bg-white object-contain" />
    <div className="font-bold tracking-wide">RS Baseball Manager</div>
    <div className="ml-auto flex gap-2">
      <button onClick={() => setTopTab("players")}  className={`${BTN} ${topTab === "players"  ? "bg-white text-[#08213A]" : "bg-white/10"}`}>球員清單</button>
      <button onClick={() => setTopTab("features")} className={`${BTN} ${topTab === "features" ? "bg-white text-[#08213A]" : "bg-white/10"}`}>其他功能</button>
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
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD，避免 hydration
  setGames((prev) => [...prev, {
    id: Date.now(),
    date,
    opponent,
    lineup: [],
    innings: Array(9).fill(0),
    stats: {},
    locked: false,
    roster: {}
  }]);
};

  const lockGame = (gid: number) => {
    if (!confirm("存檔後將無法再編輯此場比賽，確定存檔？")) return;
    setGames((prev) => prev.map((g) => {
      if (g.id !== gid) return g;
      const snap: RosterSnapshot = {};
      g.lineup.forEach((pid) => {
        const info = getNameAndPositions(players, g, pid);
        snap[pid] = { name: info.name, positions: info.positions };
      });
      return { ...g, locked: true, roster: snap };
    }));
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

      return (
        <div key={g.id} className="border rounded p-3 bg-white space-y-4">
          {/* 標題列 + 匯出按鈕 */}
          <div className="flex items-center gap-3">
            <h3 className="font-semibold">{g.date} vs {g.opponent}</h3>
            <div className="ml-auto flex gap-2">
              {!g.locked && (
                <button onClick={() => lockGame(g.id)} className="bg-emerald-600 text-white px-3 py-1 rounded">存檔鎖定</button>
              )}
              {g.locked && (
                <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">已鎖定</span>
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
                        {Object.keys(initPitching()).map((stat) => {
  const isIP = stat === "IP";
  const key = `${g.id}:${pid}`;
  const rawValue = (cur.pitching as any)[stat];

  return (
    <td key={stat} className="border px-2 py-1 text-center">
      {readOnly ? (
        // ⭐ 唯讀顯示：IP 用 MLB 記法顯示（7 / 6.1 / 6.2）
        isIP ? formatIpDisplay(rawValue) : toNonNegNum(rawValue)
      ) : isIP ? (
        // ⭐ IP 欄位：step 0.1，輸入當下就規範（.3 立刻進位），仍保留草稿避免「1.」跳值
        <input
          type="number"
          min={0}
          step={0.1}
          className="w-16 border rounded px-1 py-0.5 text-right"
          value={ipDraft[key] ?? String(rawValue ?? "")}
          onChange={(e) => {
            const next = e.target.value;
            setIpDraft((d) => {
              const num = Number(next);
              if (!Number.isNaN(num)) {
                const normalized = normalizeIpDecimal(num);
                if (normalized !== num) {
                  // 當下就把 .3 / .4 / .7 等非法十進位規範為 MLB 記法並回寫
                  updateGameStat(g.id, pid, "pitching", "IP", normalized);
                  return { ...d, [key]: String(normalized) };
                }
              }
              return { ...d, [key]: next };
            });
          }}
          onBlur={() => {
            const v = ipDraft[key];
            const normalized = normalizeIpDecimal(v === "" || v === "." ? 0 : Number(v));
            updateGameStat(g.id, pid, "pitching", "IP", normalized);
            setIpDraft((d) => {
              const { [key]: _, ...rest } = d;
              return rest;
            });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          }}
        />
      ) : (
        // 其它投手欄位維持原本邏輯
        <input
          type="number"
          min={0}
          className="w-16 border rounded px-1 py-0.5 text-right"
          value={toNonNegNum(rawValue)}
          onChange={(e) =>
            updateGameStat(g.id, pid, "pitching", stat, toNonNegNum(e.target.value))
          }
        />
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
                              <input type="number" min={0} className="w-16 border rounded px-1 py-0.5 text-right"
                                value={toNonNegNum((cur.baserunning as any)[stat])}
                                onChange={(e) => updateGameStat(g.id, pid, "baserunning", stat, toNonNegNum(e.target.value))} />
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
                              <input type="number" min={0} className="w-16 border rounded px-1 py-0.5 text-right"
                                value={toNonNegNum((cur.fielding as any)[stat])}
                                onChange={(e) => updateGameStat(g.id, pid, "fielding", stat, toNonNegNum(e.target.value))} />
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
                        <input type="number" min={0} className="w-14 border rounded px-1 py-0.5 text-right"
                               value={toNonNegNum(v)} onChange={(e) => updateInning(g.id, i, toNonNegNum(e.target.value))} />
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

  const CareerPanel = () => (
    <div className="space-y-3">
      <button onClick={syncCareer} className="bg-purple-600 text-white px-3 py-1 rounded">生涯同步（累加所有比賽）</button>
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
              const s = calcStats(p.batting, p.pitching, p.fielding, p.baserunning);
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
                  <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.ERA : "-"}</td>
                  <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.WHIP : "-"}</td>
                  <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.K9  : "-"}</td>
                  <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.BB9 : "-"}</td>
                  <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.H9  : "-"}</td>
                  <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.KBB : "-"}</td>
                  <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.FIP : "-"}</td>
                  <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.OBA : "-"}</td>
                  <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.PC  : "-"}</td>
                  <td className="border px-2 py-1 text-right">{s.FPCT}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

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
            <div className="flex gap-2">
              <button onClick={() => setSubTab("box")}    className={`px-3 py-1 rounded ${subTab === "box"    ? "bg-blue-600 text-white" : "bg-white"}`}>比賽紀錄（Box Score）</button>
              <button onClick={() => setSubTab("career")} className={`px-3 py-1 rounded ${subTab === "career" ? "bg-blue-600 text-white" : "bg-white"}`}>生涯數據</button>
              <button onClick={() => setSubTab("compare")}className={`px-3 py-1 rounded ${subTab === "compare"? "bg-blue-600 text-white" : "bg-white"}`}>球員對比</button>
              <button onClick={() => setSubTab("export")} className={`px-3 py-1 rounded ${subTab === "export" ? "bg-blue-600 text-white" : "bg-white"}`}>匯出</button>
            </div>
            {subTab === "box" && <BoxScore />}
            {subTab === "compare" && <Compare />}
            {subTab === "export" && <ExportPanel />}
                {/* 讓 Career 也放到 features 裡面一樣使用 */}
            {subTab === "career" && <CareerPanel />}
          </div>
        )}
      </div>
    </div>
  );
}
