"use client";
import React, { useEffect, useState } from "react";

/** ===== Types ===== */
type PitchMark = "S" | "B" | "F";
type PAResult =
  | "1B" | "2B" | "3B" | "HR"
  | "BB" | "IBB" | "HBP"
  | "SO" | "GO" | "FO"
  | "SF" | "SH" | "DP" | "TP"
  | "CS" | "E"  | "FC";

type BaseState = [boolean, boolean, boolean]; // [一, 二, 三]

type PlateAppearance = {
  batterId: number;
  pitcherId: number;
  pitches: PitchMark[];
  result: PAResult | null;
  outsAdded: 0|1|2|3;
  rbi?: number;
  er?: number;
  ts?: number;
  baseBefore?: BaseState;
  baseAfter?: BaseState;
  runs?: number;
  earnedRuns?: number;
  hasError?: boolean;
};

type HalfInningEvent = {
  outs: 0|1|2|3;
  pitcherId?: number;
  pas: PlateAppearance[];
  bases?: BaseState;
};

type Props = {
  g: any; // 單場比賽物件
  players: any[]; // 球員清單
  setGames: React.Dispatch<React.SetStateAction<any[]>>; // 回寫父層 state
};

/** ===== Helpers ===== */
const emptyTriple = () => ({
  batting: { "1B":0,"2B":0,"3B":0, HR:0, BB:0, SO:0, HBP:0, SF:0, SH:0, GO:0, FO:0, R:0, RBI:0 },
  pitching:{ IP:0, H:0, ER:0, BB:0, K:0, HR:0, AB:0, PC:0 },
  fielding:{ PO:0, A:0, E:0 },
  baserunning:{ SB:0, CS:0 },
});

function inc(obj: any, k: string, v = 1) {
  obj[k] = (Number(obj[k]) || 0) + v;
}

const isAB = (r: PAResult): boolean => !["BB", "IBB", "HBP", "SF", "SH"].includes(r);
const outsOf = (r: PAResult): 0|1|2|3 =>
  r === "DP" ? 2 : r === "TP" ? 3 : (["SO","GO","FO","SF","SH","CS"].includes(r) ? 1 : 0);

const countFromPitches = (arr: PitchMark[]) => {
  let balls = 0, strikes = 0;
  for (const p of arr) {
    if (p === "B") balls++;
    else if (p === "S") strikes++;
    else if (p === "F" && strikes < 2) strikes++;
  }
  return { balls, strikes };
};

// 根據結果與是否有失誤，計算這個打席應該給的 RBI（若你沒手動填 pa.rbi）
const calcRBI = (res: PAResult, runs: number, flaggedError: boolean) => {
  if (!runs) return 0;
  if (flaggedError) return 0; // 失誤造成的得分不自動給 RBI（你可手動填）
  if (["DP", "TP", "CS", "SO"].includes(res)) return 0;
  // SF / SH / BB / IBB / HBP / 安打 / HR 都給實際得分數
  return runs;
};

export default function HalfStepperPanel({ g, players, setGames }: Props) {
  /** ===== step / inning / offense 判斷 ===== */
  const [step, setStep] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const v = window.sessionStorage.getItem(`halfstep_step_g_${g.id}`);
    return v ? Number(v) || 0 : 0;
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(`halfstep_step_g_${g.id}`, String(step));
    }
  }, [step, g.id]);

  const inningIdx = Math.floor(step / 2);
  const isTop = (step % 2) === 0;
  const offense = g.startDefense ? !isTop : isTop; // 先守：上守下攻；先攻相反

  const lineupPids: number[] = (g.lineup || []).filter((pid: number) => !!pid);
  const batterIdxKey: "nextBatterIdxTop" | "nextBatterIdxBot" = isTop ? "nextBatterIdxTop" : "nextBatterIdxBot";
  const nextIdx: number = (g as any)[batterIdxKey] ?? 0;
  const curBatterId: number = offense ? (lineupPids[nextIdx] || 0) : 0;

  const [rbiInput, setRbiInput] = useState<number>(0);
  const [erInput,  setErInput ] = useState<number>(0);

  /** ===== 工具：名單/守位 ===== */
  const getNameAndPositions = (gg: any, pid: number) => {
    const p = (players || []).find((x: any) => x.id === pid);
    if (p) return { name: p.name, positions: p.positions || [] };
    const snap = gg.roster?.[pid];
    return { name: snap?.name ?? `#${pid}`, positions: snap?.positions ?? [] };
  };
  const nameOf = (pid?: number): string => (pid ? getNameAndPositions(g, pid).name : "");

  /** ===== 事件容器確保 / 取得 ===== */
  function ensureInningsEvents(gg: any, upto: number) {
    gg.inningsEvents = gg.inningsEvents ?? [];
    while (gg.inningsEvents.length <= upto) {
      gg.inningsEvents.push({
        top: { outs: 0, pitcherId: undefined, pas: [], bases: [false,false,false] as BaseState },
        bot: { outs: 0, pitcherId: undefined, pas: [], bases: [false,false,false] as BaseState },
      });
    }
  }
  const getCurHalf = (nx: any): HalfInningEvent =>
    isTop ? nx.inningsEvents[inningIdx].top : nx.inningsEvents[inningIdx].bot;

  /** ===== 本半局快取 ===== */
  const gg: any = g;
  const curHalf: HalfInningEvent =
    gg.inningsEvents && gg.inningsEvents[inningIdx]
      ? (isTop ? gg.inningsEvents[inningIdx].top : gg.inningsEvents[inningIdx].bot)
      : { outs: 0, pitcherId: undefined, pas: [], bases: [false,false,false] };

  const curPA: PlateAppearance | null = curHalf.pas?.length ? curHalf.pas[curHalf.pas.length - 1] : null;
  const { balls: curBalls, strikes: curStrikes } =
    curPA && curPA.result === null ? countFromPitches(curPA.pitches) : { balls: 0, strikes: 0 };

  /** ===== 投手選項 ===== */
  const pitcherOptions: number[] = (() => {
    const list = (g.lineup || []).filter((pid: number) =>
      (getNameAndPositions(g, pid).positions || []).includes("P")
    );
    return list.length ? list : (g.lineup || []);
  })();

  /** ===== 壘包/推進：型別與工具 ===== */
  type AdvancePlan = { on1?: 0|1|2|3|4; on2?: 0|1|2|3|4; on3?: 0|1|2|3|4; batter?: 0|1|2|3|4 };
  const cloneBases = (b?: BaseState): BaseState => [!!b?.[0], !!b?.[1], !!b?.[2]];
  const countOnBase = (b: BaseState) => (b[0]?1:0)+(b[1]?1:0)+(b[2]?1:0);
  function shiftAll(b: BaseState, n: 0|1|2|3): { bases: BaseState; runs: number } {
    let runs = 0;
    let [r1,r2,r3] = b;
    for (let i=0;i<n;i++){
      if (r3) runs++; r3 = r2;
      r2 = r1;
      r1 = false;
    }
    return { bases: [r1, r2, r3], runs };
  }
  function applyPlan(b: BaseState, plan?: AdvancePlan): { bases: BaseState; runs: number } {
    let runs = 0; const bases = cloneBases(b);
    const step = (from: 1|2|3, adv: number) => {
      if (!adv) return;
      if (!bases[from-1]) return;
      const target = from + adv;
      bases[from-1] = false;
      if (target >= 4) runs++;
      else bases[(target-1) as 0|1|2] = true;
    };
    if (plan?.on3) step(3, plan.on3);
    if (plan?.on2) step(2, plan.on2);
    if (plan?.on1) step(1, plan.on1);
    if (plan?.batter) {
      const t = plan.batter;
      if (t >= 4) runs++;
      else bases[(t-1) as 0|1|2] = true;
    }
    return { bases, runs };
  }
  function applyPlayToBases(
    basesIn: BaseState,
    res: PAResult,
    plan?: AdvancePlan
  ): { bases: BaseState; runs: number; earnedRuns: number; flaggedError: boolean } {
    let bases = cloneBases(basesIn);
    let runs = 0;
    let earnedRuns = 0;
    let flaggedError = false;

    switch (res) {
      case "1B": {
        const rr = shiftAll(bases, 1); bases = rr.bases; runs += rr.runs; earnedRuns += rr.runs; bases[0] = true;
        break;
      }
      case "2B": {
        const rr = shiftAll(bases, 2); bases = rr.bases; runs += rr.runs; earnedRuns += rr.runs; bases[1] = true;
        break;
      }
      case "3B": {
        const rr = shiftAll(bases, 3); bases = rr.bases; runs += rr.runs; earnedRuns += rr.runs; bases[2] = true;
        break;
      }
      case "HR": {
        runs += countOnBase(bases) + 1;
        earnedRuns += countOnBase(bases) + 1;
        bases = [false,false,false];
        break;
      }
      case "BB":
      case "IBB":
      case "HBP": {
        const rr = shiftAll(bases, 1); bases = rr.bases; runs += rr.runs; earnedRuns += rr.runs; bases[0] = true;
        break;
      }
      case "SF": {
        if (bases[2]) { bases[2] = false; runs++; earnedRuns++; }
        break;
      }
      case "SH": {
        const rr = shiftAll(bases, 1); bases = rr.bases; runs += rr.runs; earnedRuns += rr.runs;
        break;
      }
      case "E": {
        flaggedError = true;
        const rr = shiftAll(bases, 1); bases = rr.bases; runs += rr.runs; /* earned 不加 */ bases[0] = true;
        break;
      }
      case "FC": {
        const rr = shiftAll(bases, 1); bases = rr.bases; runs += rr.runs; earnedRuns += rr.runs; bases[0] = true;
        break;
      }
      default: { // 出局類：SO/GO/FO/DP/TP/CS
        if (plan) {
          const rr = applyPlan(bases, plan);
          bases = rr.bases; runs += rr.runs; earnedRuns += rr.runs;
        }
        break;
      }
    }
    if (flaggedError) earnedRuns = 0;
    return { bases, runs, earnedRuns, flaggedError };
  }

  /** ===== advPlan / bases 顯示 / 用球數 chip ===== */
  const [advPlan, setAdvPlan] = useState<AdvancePlan>({});
  const setAdv = (k: keyof AdvancePlan, v: 0|1|2|3|4) => setAdvPlan(p => ({ ...p, [k]: v }));
  const bases: BaseState = cloneBases(curHalf.bases || [false,false,false]);
  const curPitcherName = curHalf.pitcherId ? nameOf(curHalf.pitcherId) : "";
  const curPC: number = (!offense && curHalf.pitcherId && g.stats?.[curHalf.pitcherId]?.pitching?.PC) || 0;
  const warnPC = curPC >= 60;

  /** ===== 動作：選投手 / 逐球 / 寫結果 ===== */
  const setPitcher = (pid: number) => {
    setGames(prev => prev.map((ggx: any) => {
      if (ggx.id !== g.id) return ggx;
      const nx: any = structuredClone(ggx);
      ensureInningsEvents(nx, inningIdx);
      const half = getCurHalf(nx);
      half.pitcherId = pid || undefined;
      return nx;
    }));
  };

  const addPitch = (mark: PitchMark) => {
    let missingPitcher = false;
    let shouldNextHalf = false;

    setGames(prev => prev.map((ggx: any) => {
      if (ggx.id !== g.id) return ggx;
      const nx: any = structuredClone(ggx);
      ensureInningsEvents(nx, inningIdx);
      const half = getCurHalf(nx);

      // 防守半局需先選投手
      if (!offense && !half.pitcherId) { missingPitcher = true; return nx; }

      // 取/建當前打席
      let pa = half.pas[half.pas.length - 1] as PlateAppearance | undefined;
      if (!pa || pa.result !== null) {
        pa = { batterId: curBatterId, pitcherId: half.pitcherId || 0, pitches: [], result: null, outsAdded: 0, ts: Date.now() };
        half.pas.push(pa);
      }
      // 若此打席已結束，直接不再紀錄球數（保險）
      if (pa.result !== null) return nx;

      // 記錄當球
      pa.pitches.push(mark);

      // 防守半局：逐球加 PC（即時 UI 用；重算會覆蓋）
      if (!offense && half.pitcherId) {
        nx.stats = nx.stats || {};
        if (!nx.stats[half.pitcherId]) nx.stats[half.pitcherId] = emptyTriple();
        inc(nx.stats[half.pitcherId].pitching, "PC", 1);
      }

      // 檢查是否達成 4B or 3S
      const { balls, strikes } = countFromPitches(pa.pitches);
      const autoRes: PAResult | null = balls >= 4 ? "BB" : (strikes >= 3 ? "SO" : null);

      if (autoRes) {
        // === 在同一次更新內「直接結束打席」===
        pa.result = autoRes;
        pa.outsAdded = outsOf(autoRes);

        // 壘包與得分
        nx.inningsEvents = nx.inningsEvents || [];
        const container = getCurHalf(nx);
        container.bases = container.bases || [false,false,false];

        const preBases: BaseState = cloneBases(container.bases);
        const { bases: postBases, runs, earnedRuns, flaggedError } =
          applyPlayToBases(preBases, autoRes /* BB/SO 不吃 advPlan */);

        (pa as any).baseBefore = preBases;
        (pa as any).baseAfter  = postBases;
        (pa as any).runs       = runs;
        (pa as any).earnedRuns = earnedRuns;
        (pa as any).hasError   = flaggedError;

        container.bases = postBases;

        // 出局與輪到下一棒 / 下一半局
        const newOuts = Math.max(0, Math.min(3, (half.outs ?? 0) + pa.outsAdded)) as 0|1|2|3;
        half.outs = newOuts;
        shouldNextHalf = newOuts >= 3;
        if (offense) {
          const len = lineupPids.length || 9;
          (nx as any)[batterIdxKey] = (nextIdx + 1) % len;
        }

        // 回傳「重算後」的 nx，確保統計一致
        return recomputeAllStatsFromEvents(nx);
      }

      // 只是加一顆球：回傳 nx（PC 已即時累加，之後 commitResult 時仍會重算）
      return nx;
    }));

    if (missingPitcher) { alert("請先選擇當局投手"); return; }

    // 重置本次可選輸入與推進設定（自動結束後）
    setAdvPlan({});
    if (offense) setRbiInput(0); else setErInput(0);
    if (shouldNextHalf) setStep(s => s + 1);
  };

  const commitResult = (res: PAResult) => {
    let turnNextHalf = false;

    setGames(prev => prev.map((ggx: any) => {
      if (ggx.id !== g.id) return ggx;
      const nx: any = structuredClone(ggx);
      ensureInningsEvents(nx, inningIdx);
      const half = getCurHalf(nx);
      if (!offense && !half.pitcherId) return nx;

      // 取/建當前打席
      let pa = half.pas[half.pas.length - 1] as PlateAppearance | undefined;
      if (!pa || pa.result !== null) {
        pa = { batterId: curBatterId, pitcherId: half.pitcherId || 0, pitches: [], result: null, outsAdded: 0, ts: Date.now() };
        half.pas.push(pa);
      }

      // 寫結果與出局數
      pa.result = res;
      pa.outsAdded = outsOf(res);
      if (offense && rbiInput) pa.rbi = rbiInput;
      if (!offense && erInput)  pa.er  = erInput;

      // === 套用壘包與得分 ===
      nx.inningsEvents = nx.inningsEvents || [];
      const container = getCurHalf(nx);
      container.bases = container.bases || [false,false,false];

      const preBases: BaseState = cloneBases(container.bases);
      const { bases: postBases, runs, earnedRuns, flaggedError } =
        applyPlayToBases(preBases, res, advPlan);

      (pa as any).baseBefore = preBases;
      (pa as any).baseAfter  = postBases;
      (pa as any).runs       = runs;
      (pa as any).earnedRuns = earnedRuns;
      (pa as any).hasError   = flaggedError;

      container.bases = postBases;

      // 換棒 / 換半局
      const newOuts = Math.max(0, Math.min(3, (half.outs ?? 0) + pa.outsAdded)) as 0|1|2|3;
      half.outs = newOuts;
      turnNextHalf = newOuts >= 3;
      if (offense) {
        const len = lineupPids.length || 9;
        (nx as any)[batterIdxKey] = (nextIdx + 1) % len;
      }

      // 回傳「重算後」的 nx，所有統計由事件推導
      return recomputeAllStatsFromEvents(nx);
    }));

    if (offense) setRbiInput(0); else setErInput(0);
    setAdvPlan({});
    if (turnNextHalf) setStep(s => s + 1);
  };

  /** ===== 事件重算：由 events 重新推導 g.stats ===== */
  function recomputeAllStatsFromEvents(ggx: any) {
    const stats: Record<number, ReturnType<typeof emptyTriple>> = {};
    const addBatter = (pid: number, k: keyof ReturnType<typeof emptyTriple>["batting"], v=1) => {
      stats[pid] ||= emptyTriple(); (stats[pid].batting as any)[k] = (Number((stats[pid].batting as any)[k])||0)+v;
    };
    const addPitcher = (pid: number, k: keyof ReturnType<typeof emptyTriple>["pitching"], v=1) => {
      stats[pid] ||= emptyTriple(); (stats[pid].pitching as any)[k] = (Number((stats[pid].pitching as any)[k])||0)+v;
    };

    for (const inning of (ggx.inningsEvents || [])) {
      for (const halfKey of ["top","bot"] as const) {
        const half: HalfInningEvent = (inning as any)[halfKey]; if (!half) continue;
        const ppid = half.pitcherId;

        // 逐球 → PC
        for (const pa of (half.pas || [])) {
          for (const m of (pa.pitches||[])) {
            if (ppid && (m==="B"||m==="S"||m==="F")) addPitcher(ppid, "PC", 1);
          }
        }

        for (const pa of (half.pas || [])) {
          if (!pa.result) continue;
          const r = pa.result as PAResult;
          const batter = pa.batterId;

          if (batter) {
            if (["1B","2B","3B","HR"].includes(r)) addBatter(batter, r as any);
            if (r==="BB" || r==="IBB") addBatter(batter, "BB");
            if (r==="HBP") addBatter(batter, "HBP");
            if (r==="SO") addBatter(batter, "SO");
            if (r==="GO") addBatter(batter, "GO");
            if (r==="FO") addBatter(batter, "FO");
            if (r==="SF") addBatter(batter, "SF");
            if (r==="SH") addBatter(batter, "SH");

            // RBI：先用手動 pa.rbi；沒有就由規則推
            const rbiToAdd =
              typeof pa.rbi === "number"
                ? pa.rbi
                : calcRBI(r, pa.runs || 0, !!pa.hasError);
            if (rbiToAdd) addBatter(batter, "RBI", rbiToAdd);
          }

          if (ppid) {
            if (["1B","2B","3B","HR"].includes(r)) addPitcher(ppid, "H");
            if (r === "HR") addPitcher(ppid, "HR");
            if (r === "BB" || r === "IBB") addPitcher(ppid, "BB");
            if (r === "SO") addPitcher(ppid, "K");
            if (isAB(r)) addPitcher(ppid, "AB");
            if (pa.outsAdded) addPitcher(ppid, "IP", pa.outsAdded/3);

            // ER：先用手動 pa.er；沒有就用 pa.earnedRuns（applyPlayToBases 算出來）
            const erToAdd =
              typeof pa.er === "number" ? pa.er : (pa.earnedRuns || 0);
            if (erToAdd) addPitcher(ppid, "ER", erToAdd);
          }
        }
      }
    }

    return { ...ggx, stats };
  }

  /** ===== UI 子元件 ===== */
  const DotRow = ({ label, n, total, colorClass }:
    { label: string; n: number; total: number; colorClass: string }) => (
    <div className="flex items-center gap-2">
      <span className="text-xs w-8">{label}</span>
      <div className="flex items-center gap-1">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={`inline-block w-3 h-3 rounded-full border ${i < n ? colorClass : "border-slate-300"}`} style={i < n ? {} : { background: "transparent" }} />
        ))}
      </div>
    </div>
  );

  const outsDisp = "●".repeat(curHalf.outs || 0) + "○".repeat(3 - (curHalf.outs || 0));

  return (
    <div className="border rounded p-3 space-y-3">
      {/* 標題與導航 */}
      <div className="flex items-center justify-between">
        <div className="font-semibold">
          第 {inningIdx + 1} 局 {isTop ? "上" : "下"}（{offense ? "進攻" : "防守"}）&nbsp;
          <span className="text-sm text-slate-600">出局：{outsDisp}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="text-xs px-2 py-1 border rounded" onClick={() => setStep(s => Math.max(0, s - 1))}>上一半局</button>
          <button type="button" className="text-xs px-2 py-1 border rounded" onClick={() => setStep(s => s + 1)}>下一半局</button>
        </div>
      </div>

      {/* 半局跳轉 */}
      <div className="flex flex-wrap items-center gap-2">
        {Array.from({ length: 18 }).map((_, i) => {
          const inn = Math.floor(i/2) + 1;
          const top = (i % 2) === 0;
          const active = step === i;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setStep(i)}
              className={`text-xs px-2 py-1 rounded border ${active ? "bg-black text-white" : ""}`}
              title={`${inn}局${top ? "上" : "下"}`}
            >
              {inn}{top ? "▲" : "▼"}
            </button>
          );
        })}
      </div>

      {/* 投手（僅防守半局） */}
      {!offense && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm">投手：</div>
          <select className="text-sm border rounded px-2 py-1" value={curHalf.pitcherId || 0} onChange={(e) => setPitcher(Number(e.target.value))}>
            <option value={0}>（選擇投手）</option>
            {pitcherOptions.map((pid: number) => <option key={pid} value={pid}>{nameOf(pid)}</option>)}
          </select>
          {curPitcherName && <span className="text-xs text-slate-600">目前：{curPitcherName}</span>}

          <span className={`text-xs px-2 py-0.5 rounded ${warnPC ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"}`}>
            用球數：{curPC}
          </span>
        </div>
      )}

      {/* 當局打者（進攻半局） */}
      {offense && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm">打者：</div>
          <div className="text-sm font-medium">{nextIdx + 1}. {nameOf(curBatterId) || "（未設定）"}</div>
          {lineupPids.length > 0 && <div className="text-xs text-slate-500">下一棒將自動輪到 {(nextIdx + 2) > lineupPids.length ? 1 : (nextIdx + 2)} 棒</div>}
        </div>
      )}

      {/* 逐球：B / S / F */}
      <div className="flex items-center gap-2">
        <div className="text-sm w-16">逐球：</div>
        <button type="button" className="px-3 py-1 border rounded" onClick={() => addPitch("B")}>B</button>
        <button type="button" className="px-3 py-1 border rounded" onClick={() => addPitch("S")}>S</button>
        <button type="button" className="px-3 py-1 border rounded" onClick={() => addPitch("F")}>F</button>
        <div className="text-xs text-slate-500">（4 壞自動保送、3 好自動三振）</div>
      </div>

      {/* 好/壞/出局 顯示列 */}
      <div className="flex flex-wrap items-center gap-6">
        <DotRow label="B" n={Math.min(4, curBalls)} total={4} colorClass="bg-green-500 border-green-500" />
        <DotRow label="S" n={Math.min(3, curStrikes)} total={3} colorClass="bg-yellow-400 border-yellow-400" />
        <DotRow label="Out" n={Math.min(3, curHalf.outs || 0)} total={3} colorClass="bg-red-500 border-red-500" />
      </div>

      {/* 壘包狀態與推進設定 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
        {/* 左：三壘包示意 */}
        <div className="flex items-center gap-4">
          <div className="grid grid-cols-3 grid-rows-3 w-24 h-24">
            <div></div>
            <div className={`self-center justify-self-center w-4 h-4 rounded-full ${bases[1]?"bg-green-500":"border border-slate-300"}`} title="二壘"></div>
            <div></div>

            <div className={`self-center justify-self-center w-4 h-4 rounded-full ${bases[2]?"bg-green-500":"border border-slate-300"}`} title="三壘"></div>
            <div className="self-center justify-self-center w-3 h-3 rotate-45 border border-slate-300"></div>
            <div className={`self-center justify-self-center w-4 h-4 rounded-full ${bases[0]?"bg-green-500":"border border-slate-300"}`} title="一壘"></div>

            <div></div><div></div><div></div>
          </div>
          <div className="text-xs text-slate-500">
            當前壘包：{bases[2]?"三":""}{bases[1]?"二":""}{bases[0]?"一":""}{(!bases[0]&&!bases[1]&&!bases[2])?"空":""}
          </div>
        </div>

        {/* 右：推進設定（出局類才會套用；SF/SH/BB/HBP/H/HR 已內建） */}
        <div className="text-xs space-y-1">
          <div className="font-medium">（可選）本打席推進設定：</div>
          <div className="flex flex-wrap gap-2">
            {[
              {k:"on3", label:"三壘跑者"}, {k:"on2", label:"二壘跑者"}, {k:"on1", label:"一壘跑者"}, {k:"batter", label:"打者"}
            ].map(({k,label}) => (
              <label key={k} className="inline-flex items-center gap-1">
                {label}
                <select
                  className="border rounded px-1 py-0.5"
                  onChange={e => setAdv(k as keyof AdvancePlan, Number(e.target.value) as 0|1|2|3|4)}
                  defaultValue={0}
                >
                  <option value={0}>不動</option>
                  <option value={1}>+1壘</option>
                  <option value={2}>+2壘</option>
                  <option value={3}>+3壘</option>
                  <option value={4}>回本壘</option>
                </select>
              </label>
            ))}
            <button type="button" className="ml-2 px-2 py-0.5 border rounded" onClick={() => setAdvPlan({})}>清除推進</button>
          </div>
          <div className="text-[11px] text-slate-400">＊GO/FO/SO/CS/DP/TP 等出局類才會套用；SF/SH、安打/四死球已內建強迫或規則推進。</div>
        </div>
      </div>

      {/* 附加輸入（RBI/ER） */}
      <div className="flex items-center gap-4">
        {offense ? (
          <label className="text-sm flex items-center gap-2">
            RBI：
            <input type="number" min={0} className="w-20 border rounded px-2 py-1" value={rbiInput} onChange={e => setRbiInput(Number(e.target.value) || 0)} />
          </label>
        ) : (
          <label className="text-sm flex items-center gap-2">
            ER（自責）：
            <input type="number" min={0} className="w-20 border rounded px-2 py-1" value={erInput} onChange={e => setErInput(Number(e.target.value) || 0)} />
          </label>
        )}
      </div>

      {/* 打席結果按鈕 */}
      <div className="space-y-2">
        <div className="text-sm">打席結果：</div>
        <div className="grid grid-cols-8 gap-2">
          {["1B","2B","3B","HR","BB","IBB","HBP","SO","GO","FO","SF","SH","DP","TP","CS","E","FC"].map((k: string) => (
            <button key={k} className="px-2 py-1 border rounded" onClick={() => commitResult(k as PAResult)}>{k}</button>
          ))}
        </div>
      </div>

      {/* 打席事件清單 */}
      <div className="mt-3 border-t pt-2">
        <div className="text-sm font-medium mb-1">本半局事件</div>
        <div className="space-y-1">
          {(curHalf.pas || []).map((ev: PlateAppearance, idx: number) => (
            <div key={ev.ts ?? idx} className="text-xs flex flex-wrap items-center gap-2 justify-between border rounded px-2 py-1">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold">#{idx+1}</span>
                <span>打者：{nameOf(ev.batterId)}</span>
                <span>投手：{nameOf(ev.pitcherId)}</span>
                <span>結果：{ev.result ?? "進行中"}</span>
                <span>球數：{(ev.pitches||[]).join("") || "-"}</span>
                <span>出局+{ev.outsAdded ?? 0}</span>
                <span>壘：{(ev.baseBefore||[false,false,false]).map(b=>b?"●":"○").join("")} → {(ev.baseAfter||[false,false,false]).map(b=>b?"●":"○").join("")}</span>
                <span>R：{ev.runs ?? 0}</span>
                <span>ER：{ev.earnedRuns ?? 0}</span>
                {ev.hasError && <span className="text-red-600">E</span>}
              </div>
              <div className="flex items-center gap-1">
                <select
                  className="border rounded px-1 py-0.5"
                  defaultValue={ev.result ?? ""}
                  onChange={(e) => {
                    const newRes = e.target.value as PAResult;
                    setGames(prev => prev.map((ggx2: any) => {
                      if (ggx2.id !== g.id) return ggx2;
                      const nx: any = structuredClone(ggx2);
                      ensureInningsEvents(nx, inningIdx);
                      const half = getCurHalf(nx);
                      const pa = half.pas[idx] as PlateAppearance;

                      pa.result = newRes;
                      // 以該打席「開始前」壘包為準重算
                      const pre = (pa.baseBefore && cloneBases(pa.baseBefore)) || [false,false,false];
                      const { bases, runs, earnedRuns, flaggedError } = applyPlayToBases(pre, newRes);
                      pa.baseAfter = bases; pa.runs = runs; pa.earnedRuns = earnedRuns; pa.hasError = flaggedError;

                      return recomputeAllStatsFromEvents(nx);
                    }));
                  }}
                >
                  <option value="">（選結果）</option>
                  {["1B","2B","3B","HR","BB","IBB","HBP","SO","GO","FO","SF","SH","DP","TP","CS","E","FC"].map((k: string) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>

                <button
                  type="button"
                  className="px-2 py-0.5 border rounded hover:bg-red-50"
                  onClick={() => {
                    const ok = window.confirm(`刪除第 ${idx+1} 個事件？`);
                    if (!ok) return;
                    setGames(prev => prev.map((ggx2: any) => {
                      if (ggx2.id !== g.id) return ggx2;
                      const nx: any = structuredClone(ggx2);
                      ensureInningsEvents(nx, inningIdx);
                      const half = getCurHalf(nx);
                      (half.pas as PlateAppearance[]).splice(idx, 1);
                      return recomputeAllStatsFromEvents(nx);
                    }));
                  }}
                >刪除</button>
              </div>
            </div>
          ))}
          {(!curHalf.pas || curHalf.pas.length===0) && <div className="text-xs text-slate-500">（尚無事件）</div>}
        </div>
      </div>
    </div>
  );
}
