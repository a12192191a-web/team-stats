"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from "recharts";
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from "@hello-pangea/dnd";

/* =========================================================
   型別 & 初始結構
========================================================= */
const initBatting = () => ({
  "1B": 0,
  "2B": 0,
  "3B": 0,
  HR: 0,
  BB: 0,
  SO: 0,
  HBP: 0,
  SF: 0,
  SH: 0, // 犧牲觸擊
  GO: 0,
  FO: 0,
  R: 0, // 得分
  RBI: 0, // 打點
});

const initPitching = () => ({
  IP: 0,
  H: 0,
  ER: 0,
  BB: 0,
  K: 0,
  HR: 0,
  AB: 0, // 被打數（對手 AB）
  PC: 0, // 投球數
});

const initFielding = () => ({ PO: 0, A: 0, E: 0 });

const initBaserun = () => ({
  SB: 0, // 盜壘
  CS: 0, // 盜壘失敗
});

type Batting = ReturnType<typeof initBatting>;
type Pitching = ReturnType<typeof initPitching>;
type Fielding = ReturnType<typeof initFielding>;
type Baserun = ReturnType<typeof initBaserun>;

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

type Triple = {
  batting: Batting;
  pitching: Pitching;
  fielding: Fielding;
  baserunning: Baserun;
};

type RosterSnapshot = Record<number, { name: string; positions: string[] }>;

type Game = {
  id: number;
  date: string;
  opponent: string;
  lineup: number[];
  innings: number[];
  stats: Record<number, Triple>;
  locked: boolean;
  roster: RosterSnapshot; // 鎖定時的球員姓名/守位快照
};

/* =========================================================
   常數 / Helper
========================================================= */
const MLB_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"];
const HANDS: Array<"R" | "L" | "S"> = ["R", "L", "S"];

// localStorage key（加上版本避免舊資料結構衝突）
const STORAGE = {
  players: "rsbm.players.v2",
  games: "rsbm.games.v2",
  compare: "rsbm.compare.v1",
};
// --- Innings 轉換：支援 6.1 / 6.2 記法 ---
function ipToInnings(ipRaw: any) {
  const ip = Number(ipRaw) || 0;
  const whole = Math.trunc(ip);
  const frac = Number((ip - whole).toFixed(1)); // 只取到十分位避免 0.1000003 類誤差
  let add = 0;
  if (Math.abs(frac - 0.1) < 1e-9) add = 1 / 3;      // 0.1 => 1/3
  else if (Math.abs(frac - 0.2) < 1e-9) add = 2 / 3; // 0.2 => 2/3
  else if (Math.abs(frac) < 1e-9) add = 0;           // 0.0
  else add = frac; // 萬一舊資料真的存了 0.33 這類小數，盡量照字面用
  return whole + add;
}

const emptyTriple = (): Triple => ({
  batting: initBatting(),
  pitching: initPitching(),
  fielding: initFielding(),
  baserunning: initBaserun(),
});

const toNonNegNum = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

function safeParse<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function reviveTriple(anyTriple: any): Triple {
  return {
    batting: { ...initBatting(), ...(anyTriple?.batting || {}) },
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
    throws: ["R", "L", "S"].includes(p?.throws) ? p.throws : "R",
    bats: ["R", "L", "S"].includes(p?.bats) ? p.bats : "R",
    batting: { ...initBatting(), ...(p?.batting || {}) },
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
      Object.keys(g.stats).forEach((k) => {
        const pid = Number(k);
        stats[pid] = reviveTriple(g.stats[k]);
      });
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
      stats,
      locked: !!g?.locked,
      roster,
    };
  });
}

function getNameAndPositions(players: Player[], g: Game, pid: number) {
  const p = players.find((x) => x.id === pid);
  if (p) return { name: p.name, positions: p.positions };
  const snap = g.roster?.[pid];
  if (snap) return { name: snap.name, positions: snap.positions };
  return { name: `#${pid}`, positions: [] };
}

/* =========================================================
   MLB 計算
========================================================= */
function calcStats(
  batting: Batting,
  pitching: Pitching,
  fielding: Fielding,
  baserunning: Baserun
) {
  // ---- Batting base counts
  const H =
    toNonNegNum(batting["1B"]) +
    toNonNegNum(batting["2B"]) +
    toNonNegNum(batting["3B"]) +
    toNonNegNum(batting.HR);

  // PA：GO/FO/SH/SF/BB/SO/HBP + H
  const PA =
    H +
    toNonNegNum(batting.GO) +
    toNonNegNum(batting.FO) +
    toNonNegNum(batting.SH) +
    toNonNegNum(batting.SF) +
    toNonNegNum(batting.BB) +
    toNonNegNum(batting.SO) +
    toNonNegNum(batting.HBP);

  // AB = PA - BB - HBP - SF - SH
  const AB = Math.max(
    0,
    PA -
      toNonNegNum(batting.BB) -
      toNonNegNum(batting.HBP) -
      toNonNegNum(batting.SF) -
      toNonNegNum(batting.SH)
  );

  const TB =
    toNonNegNum(batting["1B"]) +
    2 * toNonNegNum(batting["2B"]) +
    3 * toNonNegNum(batting["3B"]) +
    4 * toNonNegNum(batting.HR);

  const TOB = H + toNonNegNum(batting.BB) + toNonNegNum(batting.HBP);

  const safeDiv = (a: number, b: number, d = 3) =>
    b > 0 ? (a / b).toFixed(d) : d === 3 ? "0.000" : "0.00";

  const AVG = safeDiv(H, AB, 3);
  const OBPden = AB + toNonNegNum(batting.BB) + toNonNegNum(batting.HBP) + toNonNegNum(batting.SF);
  const OBP = safeDiv(H + toNonNegNum(batting.BB) + toNonNegNum(batting.HBP), OBPden, 3);
  const SLG = safeDiv(TB, AB, 3);
  const OPS = (parseFloat(OBP) + parseFloat(SLG)).toFixed(3);

  // 衍生打擊
  const BBK = safeDiv(toNonNegNum(batting.BB), toNonNegNum(batting.SO), 2);
  const RC =
    AB + toNonNegNum(batting.BB) > 0
      ? (((H + toNonNegNum(batting.BB)) * TB) / (AB + toNonNegNum(batting.BB))).toFixed(1)
      : "0.0";

    // ---- Pitching
  const ipInnings = ipToInnings(pitching.IP);

  const ERA  = safeDiv(toNonNegNum(pitching.ER) * 9, ipInnings, 2);
  const WHIP = safeDiv(toNonNegNum(pitching.BB) + toNonNegNum(pitching.H), ipInnings, 2);
  const K9   = safeDiv(toNonNegNum(pitching.K) * 9, ipInnings, 2);
  const FIP  = ipInnings > 0
    ? (
        (13 * toNonNegNum(pitching.HR) +
         3  * toNonNegNum(pitching.BB) -
         2  * toNonNegNum(pitching.K)) / ipInnings
        + 3.2
      ).toFixed(2)
    : "0.00";

  // 投手擴充
  const BB9 = safeDiv(toNonNegNum(pitching.BB) * 9, ipInnings, 2);
  const H9  = safeDiv(toNonNegNum(pitching.H)  * 9, ipInnings, 2);
  const KBB = safeDiv(toNonNegNum(pitching.K),     toNonNegNum(pitching.BB), 2);
  const OBA = safeDiv(toNonNegNum(pitching.H),     toNonNegNum(pitching.AB), 3);
  const PC  = toNonNegNum(pitching.PC);


  // ---- Fielding
  const FPCT =
    toNonNegNum(fielding.PO) + toNonNegNum(fielding.A) + toNonNegNum(fielding.E) > 0
      ? (
          (toNonNegNum(fielding.PO) + toNonNegNum(fielding.A)) /
          (toNonNegNum(fielding.PO) + toNonNegNum(fielding.A) + toNonNegNum(fielding.E))
        ).toFixed(3)
      : "1.000";

  // ---- Baserunning
  const SB = toNonNegNum(baserunning.SB);
  const CS = toNonNegNum(baserunning.CS);
  const SBP = SB + CS > 0 ? ((SB / (SB + CS)) * 100).toFixed(1) + "%" : "0%";

  return {
    AB,
    H,
    AVG,
    OBP,
    SLG,
    OPS,
    ERA,
    WHIP,
    K9,
    FIP,
    FPCT,
    PA,
    TB,
    TOB,
    BBK,
    RC,
    R: toNonNegNum(batting.R),
    RBI: toNonNegNum(batting.RBI),
    SH: toNonNegNum(batting.SH),
    SB,
    CS,
    SBP,
    BB9,
    H9,
    KBB,
    OBA,
    PC,
  };
}

/* =========================================================
   主頁
========================================================= */
export default function Home() {
  const [topTab, setTopTab] = useState<"players" | "features">("players");
  const [subTab, setSubTab] = useState<"box" | "compare" | "career" | "export">("box");

  // ✅ 從 localStorage 初始化
  const [players, setPlayers] = useState<Player[]>(() => {
    if (typeof window === "undefined") return [];
    const raw = safeParse(localStorage.getItem(STORAGE.players), []);
    return revivePlayers(raw);
  });

  const [games, setGames] = useState<Game[]>(() => {
    if (typeof window === "undefined") return [];
    const raw = safeParse(localStorage.getItem(STORAGE.games), []);
    return reviveGames(raw);
  });

  const [compare, setCompare] = useState<number[]>(() => {
    if (typeof window === "undefined") return [];
    const raw = safeParse(localStorage.getItem(STORAGE.compare), []);
    return Array.isArray(raw) ? raw.map((n: any) => Number(n)).filter((n) => Number.isFinite(n)) : [];
  });

  // ✅ 任何變更自動存回 localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE.players, JSON.stringify(players));
    } catch {}
  }, [players]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE.games, JSON.stringify(games));
    } catch {}
  }, [games]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE.compare, JSON.stringify(compare));
    } catch {}
  }, [compare]);

  /* ---------------- Navbar ---------------- */
  const Navbar = () => (
    <div className="w-full sticky top-0 z-10 bg-[#08213A] text-white flex items-center gap-4 px-4 py-2">
      <img
        src="/37758.jpg"
        alt="RS"
        className="h-8 w-auto rounded-sm border border-white/20 bg-white object-contain"
      />
      <div className="font-bold tracking-wide">RS Baseball Manager</div>
      <div className="ml-auto flex gap-2">
        <button
          onClick={() => setTopTab("players")}
          className={`px-3 py-1 rounded ${topTab === "players" ? "bg-white text-[#08213A]" : "bg-white/10"}`}
        >
          球員清單
        </button>
        <button
          onClick={() => setTopTab("features")}
          className={`px-3 py-1 rounded ${topTab === "features" ? "bg-white text-[#08213A]" : "bg-white/10"}`}
        >
          其他功能
        </button>
      </div>
    </div>
  );

  /* ---------------- 新增 / 刪除（含保護） ---------------- */
  const addPlayer = (p: Omit<Player, "id" | "batting" | "pitching" | "fielding" | "baserunning">) => {
    setPlayers((prev) => [
      ...prev,
      {
        id: Date.now(),
        name: p.name.trim(),
        positions: p.positions,
        throws: p.throws,
        bats: p.bats,
        batting: initBatting(),
        pitching: initPitching(),
        fielding: initFielding(),
        baserunning: initBaserun(),
      },
    ]);
  };

  const deletePlayer = (id: number) => {
    // 未鎖定比賽中仍在打線 → 禁止刪除
    const usedInUnlocked = games.some((g) => !g.locked && g.lineup.includes(id));
    if (usedInUnlocked) {
      alert("此球員仍在『未鎖定』比賽的打線中，請先從該打線移除或鎖定比賽再刪除。");
      return;
    }
    // 允許刪除（鎖定比賽以 roster + stats 保存不受影響）
    setPlayers((prev) => prev.filter((x) => x.id !== id));
    setCompare((prev) => prev.filter((x) => x !== id));
    // 也從未鎖定比賽的 lineup 移除（鎖定比賽不動）
    setGames((prev) =>
      prev.map((g) => (g.locked ? g : { ...g, lineup: g.lineup.filter((pid) => pid !== id) }))
    );
  };

  const clearPlayers = () => {
    if (!confirm("確定清空所有球員？")) return;
    setPlayers([]);
    setCompare([]);
  };

  /* ---------------- 比賽：新增 / 編輯 / 鎖定 ---------------- */
  const addGame = () => {
    const opponent = prompt("對手名稱") || "Unknown";
    const date = new Date().toLocaleDateString();
    setGames((prev) => [
      ...prev,
      {
        id: Date.now(),
        date,
        opponent,
        lineup: [],
        innings: Array(9).fill(0),
        stats: {},
        locked: false,
        roster: {},
      },
    ]);
  };

  const lockGame = (gid: number) => {
    if (!confirm("存檔後將無法再編輯此場比賽，確定存檔？")) return;
    // 鎖定時做 roster 快照，確保之後刪除球員也不會影響顯示
    setGames((prev) =>
      prev.map((g) => {
        if (g.id !== gid) return g;
        const snap: RosterSnapshot = {};
        g.lineup.forEach((pid) => {
          const info = getNameAndPositions(players, g, pid);
          snap[pid] = { name: info.name, positions: info.positions };
        });
        return { ...g, locked: true, roster: snap };
      })
    );
  };

  const updateGameStat = (
    gid: number,
    pid: number,
    section: keyof Triple,
    key: string,
    val: number
  ) => {
    const safeVal = Math.max(0, Number(val) || 0);
    setGames((prev) =>
      prev.map((g) => {
        if (g.id !== gid || g.locked) return g; // 鎖定後不可寫入
        const prevTriple = g.stats[pid] ?? emptyTriple();
        return {
          ...g,
          stats: {
            ...g.stats,
            [pid]: {
              ...prevTriple,
              [section]: { ...(prevTriple as any)[section], [key]: safeVal },
            },
          },
        };
      })
    );
  };

  const updateInning = (gid: number, idx: number, val: number) => {
    const safeVal = Math.max(0, Number(val) || 0);
    setGames((prev) =>
      prev.map((g) => {
        if (g.id !== gid || g.locked) return g;
        const innings = [...g.innings];
        innings[idx] = safeVal;
        return { ...g, innings };
      })
    );
  };

  const addToLineup = (g: Game, pid: number) => {
    if (g.locked) return;
    if (g.lineup.includes(pid)) return;
    if (g.lineup.length >= 9) return;
    setGames((prev) =>
      prev.map((x) => {
        if (x.id !== g.id) return x;
        const has = !!x.stats[pid];
        return {
          ...x,
          lineup: [...x.lineup, pid],
          stats: has ? x.stats : { ...x.stats, [pid]: emptyTriple() },
        };
      })
    );
  };

  const removeFromLineup = (g: Game, pid: number) => {
    if (g.locked) return;
    setGames((prev) =>
      prev.map((x) => (x.id === g.id ? { ...x, lineup: x.lineup.filter((id) => id !== pid) } : x))
    );
  };

  const onDragEnd = (g: Game) => (result: DropResult) => {
    if (!result.destination || g.locked) return;
    setGames((prev) =>
      prev.map((x) => {
        if (x.id !== g.id) return x;
        const arr = [...x.lineup];
        const [removed] = arr.splice(result.source.index, 1);
        arr.splice(result.destination!.index, 0, removed);
        return { ...x, lineup: arr.slice(0, 9) };
      })
    );
  };

  /* ---------------- 生涯同步 ---------------- */
  const syncCareer = () => {
    setPlayers((prev) =>
      prev.map((p) => {
        const b = initBatting();
        const pi = initPitching();
        const f = initFielding();
        const br = initBaserun();
        games.forEach((g) => {
          const cur = g.stats[p.id];
          if (!cur) return;
          (Object.keys(b) as (keyof Batting)[]).forEach(
            (k) => ((b as any)[k] += toNonNegNum((cur.batting as any)[k]))
          );
          (Object.keys(pi) as (keyof Pitching)[]).forEach(
            (k) => ((pi as any)[k] += toNonNegNum((cur.pitching as any)[k]))
          );
          (Object.keys(f) as (keyof Fielding)[]).forEach(
            (k) => ((f as any)[k] += toNonNegNum((cur.fielding as any)[k]))
          );
          (Object.keys(br) as (keyof Baserun)[]).forEach(
            (k) => ((br as any)[k] += toNonNegNum((cur.baserunning as any)[k]))
          );
        });
        return { ...p, batting: b, pitching: pi, fielding: f, baserunning: br };
      })
    );
    alert("生涯數據已同步（累加所有比賽）。");
  };
const importJSON = (file: File) => {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const raw = JSON.parse(String(reader.result) || "{}");
      const ps = revivePlayers(raw?.players ?? []);
      const gs = reviveGames(raw?.games ?? []);
      setPlayers(ps);
      setGames(gs);
      setCompare([]);
      alert("匯入完成！");
    } catch (e) {
      alert("JSON 解析失敗，請確認檔案格式。");
    }
  };
  reader.readAsText(file);
};
// ======= 雲端同步：把整個 players/games/compare 存成一筆 JSON =======
const CLOUD_ROW_ID = "default";

async function loadFromCloud() {
  const { data, error } = await supabase
    .from("app_state")
    .select("data")
    .eq("id", CLOUD_ROW_ID)
    .single();

  if (error) {
    console.error(error);
    alert("雲端載入失敗：" + error.message);
    return;
  }
  const payload = data?.data || {};
  setPlayers(revivePlayers(payload.players ?? []));
  setGames(reviveGames(payload.games ?? []));
  setCompare(Array.isArray(payload.compare) ? payload.compare.map((n:any)=>Number(n)) : []);
  alert("已從雲端載入。");
}

async function saveToCloud() {
  const payload = { players, games, compare, v: 2, savedAt: new Date().toISOString() };
  const { error } = await supabase
    .from("app_state")
    .upsert({ id: CLOUD_ROW_ID, data: payload, updated_at: new Date().toISOString() });
  if (error) {
    console.error(error);
    alert("雲端存檔失敗：" + error.message);
    return;
  }
  alert("已存到雲端。");
}

  /* ---------------- 匯出 ---------------- */
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify({ players, games }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rs-baseball.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    let csv = "Name,Pos,AB,H,AVG,OBP,SLG,OPS,ERA,WHIP,K9,FIP,FPCT\n";
    players.forEach((p) => {
      const s = calcStats(p.batting, p.pitching, p.fielding, p.baserunning);
      csv += `${p.name},"${p.positions.join("/")}",${s.AB},${s.H},${s.AVG},${s.OBP},${s.SLG},${s.OPS},${s.ERA},${s.WHIP},${s.K9},${s.FIP},${s.FPCT}\n`;
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rs-baseball.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportGameCSV = (g: Game) => {
  const headers = [
    "Player","Pos","AB","H","AVG","OBP","SLG","OPS","ERA","WHIP","K9","FIP","FPCT",
    "R","RBI","TB","TOB","BBK","SB","CS","SBP","PC"
  ];
  let csv = headers.join(",") + "\n";

  g.lineup.forEach((pid) => {
    const { name, positions } = getNameAndPositions(players, g, pid);
    const cur = g.stats[pid] ?? emptyTriple();
    const s = calcStats(cur.batting, cur.pitching, cur.fielding, cur.baserunning);
    const isP = positions.includes("P");
    csv += [
      name,
      `"${positions.join("/")}"`,
      s.AB, s.H, s.AVG, s.OBP, s.SLG, s.OPS,
      isP ? s.ERA : "-", isP ? s.WHIP : "-", isP ? s.K9 : "-", isP ? s.FIP : "-", s.FPCT,
      s.R, s.RBI, s.TB, s.TOB, s.BBK, s.SB, s.CS, s.SBP, isP ? s.PC : "-"
    ].join(",") + "\n";
  });

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `game-${g.date.replace(/\//g, "-")}-vs-${g.opponent}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};


  /* ---------------- UI：新增球員 ---------------- */
  const PlayersForm = () => {
    const [name, setName] = useState("");
    const [posSel, setPosSel] = useState<string[]>([]);
    const [throws, setThrows] = useState<"R" | "L" | "S">("R");
    const [bats, setBats] = useState<"R" | "L" | "S">("R");

    const togglePos = (p: string) =>
      setPosSel((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

    const submit = () => {
      if (!name.trim()) return alert("請輸入姓名");
      if (posSel.length === 0) return alert("至少選一個守備位置");
      addPlayer({ name, positions: posSel, throws, bats });
      setName("");
      setPosSel([]);
      setThrows("R");
      setBats("R");
    };

    return (
      <div className="border rounded p-3 space-y-3 bg-white">
        <h3 className="font-semibold">新增球員</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="姓名"
            className="border rounded px-2 py-1"
          />
          <div className="flex flex-wrap gap-2">
            {MLB_POSITIONS.map((p) => (
              <label key={p} className="text-sm flex items-center gap-1">
                <input type="checkbox" checked={posSel.includes(p)} onChange={() => togglePos(p)} />
                {p}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            投：
            {HANDS.map((h) => (
              <label key={h} className="text-sm flex items-center gap-1">
                <input type="radio" name="throws" checked={throws === h} onChange={() => setThrows(h)} />
                {h}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            打：
            {HANDS.map((h) => (
              <label key={h} className="text-sm flex items-center gap-1">
                <input type="radio" name="bats" checked={bats === h} onChange={() => setBats(h)} />
                {h}
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
              <div className="font-semibold">
                {p.name}（{p.positions.join("/")}） 投:{p.throws} 打:{p.bats}
              </div>
              <button onClick={() => deletePlayer(p.id)} className="text-sm bg-black text-white px-2 py-1 rounded">
                刪除
              </button>
            </div>
            <div className="text-sm mt-2 space-y-1">
              <div>
                打擊：AB {s.AB}、H {s.H}、AVG {s.AVG}、OBP {s.OBP}、SLG {s.SLG}、OPS {s.OPS}
              </div>
              {p.positions.includes("P") && (
                <div>投手：ERA {s.ERA}、WHIP {s.WHIP}、K/9 {s.K9}、FIP {s.FIP}</div>
              )}
              <div>守備：FPCT {s.FPCT}</div>
            </div>
          </div>
        );
      })}
      {players.length === 0 && <div className="text-gray-500 text-sm">尚無球員，請先新增。</div>}
    </div>
  );

  /* ---------------- UI：比賽紀錄（輸入區也加跑壘；投手表新增 AB、PC） ---------------- */
  const BoxScore = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={addGame} className="bg-blue-600 text-white px-3 py-1 rounded">新增比賽</button>
      </div>

      {games.map((g) => {
        let teamH = 0;
        let teamE = 0;
        g.lineup.forEach((pid) => {
          const cur = g.stats[pid] ?? emptyTriple();
          const bat = cur.batting;
          const fld = cur.fielding;
          teamH += toNonNegNum(bat["1B"]) + toNonNegNum(bat["2B"]) + toNonNegNum(bat["3B"]) + toNonNegNum(bat.HR);
          teamE += toNonNegNum(fld.E);
        });
        const teamR = g.innings.reduce((a, b) => a + toNonNegNum(b), 0);

        return (
          <div key={g.id} className="border rounded p-3 bg-white space-y-4">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold">{g.date} vs {g.opponent}</h3>
              {!g.locked && (
                <button onClick={() => lockGame(g.id)} className="ml-auto bg-emerald-600 text-white px-3 py-1 rounded">
                  存檔鎖定
                </button>
              )}
              {g.locked && <span className="ml-auto text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">已鎖定</span>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* 左：可加入名單 */}
              <div className="border rounded p-2">
                <div className="font-semibold mb-2">可加入名單（點擊加入，最多 9 人）</div>
                <div className="flex flex-wrap gap-2">
                  {players
                    .filter((p) => !g.lineup.includes(p.id))
                    .map((p) => (
                      <button
                        key={p.id}
                        className={`px-2 py-1 rounded border ${g.lineup.length >= 9 || g.locked ? "opacity-40 cursor-not-allowed" : ""}`}
                        onClick={() => addToLineup(g, p.id)}
                        disabled={g.lineup.length >= 9 || g.locked}
                      >
                        {p.name}
                      </button>
                    ))}
                </div>
              </div>

              {/* 右：打線拖曳（鎖定後仍顯示快照） */}
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
                                  className="flex items-center justify-between bg-gray-50 border rounded px-2 py-1"
                                >
                                  <span>{idx + 1}棒 — {info.name}（{info.positions.join("/") || "—"}）</span>
                                  {!g.locked && (
                                    <button onClick={() => removeFromLineup(g, pid)} className="text-xs bg-red-500 text-white px-2 py-0.5 rounded">
                                      ✖
                                    </button>
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

                    {/* 打擊（含 R、RBI、SH） */}
                    <table className="border text-sm mb-2 w-full">
                      <thead>
                        <tr>
                          {Object.keys(initBatting()).map((k) => (
                            <th key={k} className="border px-2 py-1">{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {Object.keys(initBatting()).map((stat) => (
                            <td key={stat} className="border px-2 py-1 text-center">
                              {readOnly ? (
                                toNonNegNum((cur.batting as any)[stat])
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  className="w-16 border rounded px-1 py-0.5 text-right"
                                  value={toNonNegNum((cur.batting as any)[stat])}
                                  onChange={(e) =>
                                    updateGameStat(g.id, pid, "batting", stat, toNonNegNum(e.target.value))
                                  }
                                />
                              )}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>

                    {/* 投手（新增 AB、PC；僅 P 顯示） */}
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
                            {Object.keys(initPitching()).map((stat) => (
                              <td key={stat} className="border px-2 py-1 text-center">
                                {readOnly ? (
                                  toNonNegNum((cur.pitching as any)[stat])
                                ) : (
                                  <input
                                    type="number"
                                    min={0}
                                    className="w-16 border rounded px-1 py-0.5 text-right"
                                    value={toNonNegNum((cur.pitching as any)[stat])}
                                    onChange={(e) =>
                                      updateGameStat(g.id, pid, "pitching", stat, toNonNegNum(e.target.value))
                                    }
                                  />
                                )}
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    )}

                    {/* 跑壘（SB、CS） */}
                    <table className="border text-sm mb-2 w-full">
                      <thead>
                        <tr>
                          {Object.keys(initBaserun()).map((k) => (
                            <th key={k} className="border px-2 py-1">{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {Object.keys(initBaserun()).map((stat) => (
                            <td key={stat} className="border px-2 py-1 text-center">
                              {readOnly ? (
                                toNonNegNum((cur.baserunning as any)[stat])
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  className="w-16 border rounded px-1 py-0.5 text-right"
                                  value={toNonNegNum((cur.baserunning as any)[stat])}
                                  onChange={(e) =>
                                    updateGameStat(g.id, pid, "baserunning", stat, toNonNegNum(e.target.value))
                                  }
                                />
                              )}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>

                    {/* 守備 */}
                    <table className="border text-sm w-full">
                      <thead>
                        <tr>
                          {Object.keys(initFielding()).map((k) => (
                            <th key={k} className="border px-2 py-1">{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {Object.keys(initFielding()).map((stat) => (
                            <td key={stat} className="border px-2 py-1 text-center">
                              {readOnly ? (
                                toNonNegNum((cur.fielding as any)[stat])
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  className="w-16 border rounded px-1 py-0.5 text-right"
                                  value={toNonNegNum((cur.fielding as any)[stat])}
                                  onChange={(e) =>
                                    updateGameStat(g.id, pid, "fielding", stat, toNonNegNum(e.target.value))
                                  }
                                />
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
            <div className="overflow-x-auto">
              <table className="border text-sm w-full">
                <thead>
                  <tr>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                      <th key={n} className="border px-2 py-1 text-center">{n}</th>
                    ))}
                    <th className="border px-2 py-1 text-center">R</th>
                    <th className="border px-2 py-1 text-center">H</th>
                    <th className="border px-2 py-1 text-center">E</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {g.innings.map((v, i) => (
                      <td key={i} className="border px-2 py-1 text-center">
                        {g.locked ? (
                          toNonNegNum(v)
                        ) : (
                          <input
                            type="number"
                            min={0}
                            className="w-14 border rounded px-1 py-0.5 text-right"
                            value={toNonNegNum(v)}
                            onChange={(e) => updateInning(g.id, i, toNonNegNum(e.target.value))}
                          />
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

            {/* 當場總結（維持原有關鍵指標） */}
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
                    const cur = g.stats[pid] ?? emptyTriple();
                    const s = calcStats(cur.batting, cur.pitching, cur.fielding, cur.baserunning);
                    return (
                      <tr key={pid}>
                        <td className="border px-2 py-1">{info.name}</td>
                        <td className="border px-2 py-1 text-right">{s.AB}</td>
                        <td className="border px-2 py-1 text-right">{s.H}</td>
                        <td className="border px-2 py-1 text-right">{s.AVG}</td>
                        <td className="border px-2 py-1 text-right">{s.OBP}</td>
                        <td className="border px-2 py-1 text-right">{s.SLG}</td>
                        <td className="border px-2 py-1 text-right">{s.OPS}</td>
                        <td className="border px-2 py-1 text-right">{info.positions.includes("P") ? s.ERA : "-"}</td>
                        <td className="border px-2 py-1 text-right">{info.positions.includes("P") ? s.WHIP : "-"}</td>
                        <td className="border px-2 py-1 text-right">{info.positions.includes("P") ? s.K9 : "-"}</td>
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
    const METRICS = ["AB", "H", "AVG", "OBP", "SLG", "OPS", "ERA", "WHIP", "K9", "FIP", "FPCT"];
    const CHART_METRICS = ["AVG", "OBP", "SLG", "OPS", "ERA", "WHIP", "K9", "FPCT"];
    const colors = ["#8884d8", "#82ca9d", "#ffc658", "#ff8a65", "#90caf9"];

    const makeRow = (stat: string) => {
      const row: Record<string, number | string> = { stat };
      compareLive.forEach((id) => {
        const p = players.find((x) => x.id === id);
        if (!p) return;
        const s = calcStats(
          p.batting ?? initBatting(),
          p.pitching ?? initPitching(),
          p.fielding ?? initFielding(),
          p.baserunning ?? initBaserun()
        );
        const v = parseFloat((s as any)[stat]) || 0;
        row[p.name] = Number.isFinite(v) ? v : 0;
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
              <input
                type="checkbox"
                className="mr-1"
                checked={compare.includes(p.id)}
                onChange={(e) =>
                  setCompare((prev) => (e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)))
                }
              />
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
                    {compareLive.map((id) => (
                      <th key={id} className="border px-2 py-1">
                        {players.find((p) => p.id === id)?.name ?? `#${id}`}
                      </th>
                    ))}
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

            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData}>
                <XAxis dataKey="stat" />
                <YAxis />
                <Tooltip />
                <Legend />
                {compareLive.map((id, i) => {
                  const name = players.find((p) => p.id === id)?.name;
                  return name ? <Bar key={id} dataKey={name} fill={colors[i % colors.length]} /> : null;
                })}
              </BarChart>
            </ResponsiveContainer>

            <ResponsiveContainer width="100%" height={320}>
              <RadarChart data={chartData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="stat" />
                <PolarRadiusAxis />
                {compareLive.map((id, i) => {
                  const name = players.find((p) => p.id === id)?.name;
                  return name ? (
                    <Radar
                      key={id}
                      name={name}
                      dataKey={name}
                      stroke={colors[i % colors.length]}
                      fill={colors[i % colors.length]}
                      fillOpacity={0.3}
                    />
                  ) : null;
                })}
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </>
        ) : (
          <div className="text-sm text-gray-500">請至少勾選兩位球員進行對比。</div>
        )}
      </div>
    );
  };

  /* ---------------- UI：Export / Career ---------------- */
  const ExportPanel = () => (
  <div className="flex flex-wrap items-center gap-2">
    <button onClick={exportJSON} className="bg-gray-600 text-white px-3 py-1 rounded">匯出 JSON</button>
    <button onClick={exportCSV}  className="bg-gray-800 text-white px-3 py-1 rounded">匯出 CSV</button>

    <label className="inline-flex items-center gap-2 bg-white border px-3 py-1 rounded cursor-pointer">
      <span>匯入 JSON</span>
      <input
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importJSON(f);
          e.currentTarget.value = "";
        }}
      />
    </label>

    {/* ⭐ 新增：雲端同步 */}
    <button onClick={loadFromCloud} className="bg-teal-600 text-white px-3 py-1 rounded">
      雲端載入
    </button>
    <button onClick={saveToCloud} className="bg-teal-800 text-white px-3 py-1 rounded">
      雲端存檔
    </button>
  </div>
);



  // 生涯數據：呈現所有新增 MLB 指標
  const CareerPanel = () => (
    <div className="space-y-3">
      <button onClick={syncCareer} className="bg-purple-600 text-white px-3 py-1 rounded">
        生涯同步（累加所有比賽）
      </button>

      <div className="overflow-x-auto">
        <table className="border text-xs w-full bg-white">
          <thead>
            <tr>
              <th className="border px-2 py-1">球員</th>

              {/* Batting */}
              <th className="border px-2 py-1">AB</th>
              <th className="border px-2 py-1">H</th>
              <th className="border px-2 py-1">AVG</th>
              <th className="border px-2 py-1">OBP</th>
              <th className="border px-2 py-1">SLG</th>
              <th className="border px-2 py-1">OPS</th>
              <th className="border px-2 py-1">R</th>
              <th className="border px-2 py-1">RBI</th>
              <th className="border px-2 py-1">SH</th>
              <th className="border px-2 py-1">TB</th>
              <th className="border px-2 py-1">TOB</th>
              <th className="border px-2 py-1">RC</th>
              <th className="border px-2 py-1">BB/K</th>

              {/* Baserunning */}
              <th className="border px-2 py-1">SB</th>
              <th className="border px-2 py-1">CS</th>
              <th className="border px-2 py-1">SB%</th>

              {/* Pitching */}
              <th className="border px-2 py-1">ERA</th>
              <th className="border px-2 py-1">WHIP</th>
              <th className="border px-2 py-1">K/9</th>
              <th className="border px-2 py-1">BB/9</th>
              <th className="border px-2 py-1">H/9</th>
              <th className="border px-2 py-1">K/BB</th>
              <th className="border px-2 py-1">FIP</th>
              <th className="border px-2 py-1">OBA</th>
              <th className="border px-2 py-1">PC</th>

              {/* Fielding */}
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
                  <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.K9 : "-"}</td>
                  <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.BB9 : "-"}</td>
                  <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.H9 : "-"}</td>
                  <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.KBB : "-"}</td>
                  <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.FIP : "-"}</td>
                  <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.OBA : "-"}</td>
                  <td className="border px-2 py-1 text-right">{p.positions.includes("P") ? s.PC : "-"}</td>

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
  return (
    <div className="min-h-screen bg-[#f6f7fb]">
      <Navbar />
      <div className="max-w-6xl mx-auto p-4 space-y-4">
        {topTab === "players" && (
          <>
            <PlayersForm />
            <PlayersList />
          </>
        )}

        {topTab === "features" && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <button
                onClick={() => setSubTab("box")}
                className={`px-3 py-1 rounded ${subTab === "box" ? "bg-blue-600 text-white" : "bg-white"}`}
              >
                比賽紀錄（Box Score）
              </button>
              <button
                onClick={() => setSubTab("career")}
                className={`px-3 py-1 rounded ${subTab === "career" ? "bg-blue-600 text-white" : "bg-white"}`}
              >
                生涯數據
              </button>
              <button
                onClick={() => setSubTab("compare")}
                className={`px-3 py-1 rounded ${subTab === "compare" ? "bg-blue-600 text-white" : "bg-white"}`}
              >
                球員對比
              </button>
              <button
                onClick={() => setSubTab("export")}
                className={`px-3 py-1 rounded ${subTab === "export" ? "bg-blue-600 text-white" : "bg-white"}`}
              >
                匯出
              </button>
            </div>

            {subTab === "box" && <BoxScore />}
            {subTab === "compare" && <Compare />}
            {subTab === "export" && <ExportPanel />}
            {subTab === "career" && <CareerPanel />}
          </div>
        )}
      </div>
    </div>
  );
}
