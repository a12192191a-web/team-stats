"use client";
import { useEffect, useState } from "react";

/** 父層會傳進來的 props（簡化型別避免你大改） */
type Props = {
  g: any; // 單場比賽物件
  players: any[]; // 全部球員（用來顯示名字、守位）
  setGames: React.Dispatch<React.SetStateAction<any[]>>; // 回寫父層 state
};

export default function HalfStepperPanel({ g, players, setGames }: Props) {
  // ------- 輔助：名字/守位、建立空白 triple、加總器 -------
  const getNameAndPositions = (gg: any, pid: number) => {
    const p = players.find((x) => x.id === pid);
    if (p) return { name: p.name, positions: p.positions || [] };
    const snap = gg.roster?.[pid];
    return { name: snap?.name ?? `#${pid}`, positions: snap?.positions ?? [] };
  };
  const emptyTriple = () => ({
    batting: { "1B":0,"2B":0,"3B":0, HR:0, BB:0, SO:0, HBP:0, SF:0, SH:0, GO:0, FO:0, R:0, RBI:0 },
    pitching:{ IP:0, H:0, ER:0, BB:0, K:0, HR:0, AB:0, PC:0 },
    fielding:{ PO:0, A:0, E:0 },
    baserunning:{ SB:0, CS:0 },
  });
  const inc = (obj: any, k: string, v = 1) => (obj[k] = (Number(obj[k]) || 0) + v);
  const isAB = (r: PAResult) => !["BB", "IBB", "HBP", "SF", "SH"].includes(r);
  const outsOf = (r: PAResult): 0|1|2|3 =>
    r === "DP" ? 2 : r === "TP" ? 3 : (["SO","GO","FO","SF","SH","CS"].includes(r) ? 1 : 0);
  const nameOf = (pid?: number) => (pid ? getNameAndPositions(g, pid).name : "");

  // ------- 型別與事件容器 -------
  type PitchMark = "S" | "B" | "F";
  type PAResult =
    | "1B" | "2B" | "3B" | "HR"
    | "BB" | "IBB" | "HBP"
    | "SO" | "GO" | "FO"
    | "SF" | "SH" | "DP" | "TP"
    | "CS" | "E"  | "FC";
  type PlateAppearance = {
    batterId: number;
    pitcherId: number;
    pitches: PitchMark[];
    result: PAResult | null;
    outsAdded: 0|1|2|3;
    rbi?: number;
    er?: number;
    ts?: number;
  };
  type HalfInningEvent = { outs: 0|1|2|3; pitcherId?: number; pas: PlateAppearance[] };

  // ------- 逐局指標 & 進攻/防守判斷 -------
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

  // 打者順序
  const lineupPids: number[] = (g.lineup || []).filter(Boolean);
  const batterIdxKey = isTop ? "nextBatterIdxTop" : "nextBatterIdxBot";
  const nextIdx = (g as any)[batterIdxKey] ?? 0;
  const curBatterId = offense ? (lineupPids[nextIdx] || 0) : 0;

  // 額外輸入
  const [rbiInput, setRbiInput] = useState(0);
  const [erInput,  setErInput ] = useState(0);

  // ------- 取/建事件容器 -------
  const ensureInningsEvents = (gg: any, upto: number) => {
    gg.inningsEvents = gg.inningsEvents ?? [];
    while (gg.inningsEvents.length <= upto) {
      gg.inningsEvents.push({
        top: { outs: 0, pitcherId: undefined, pas: [] },
        bot: { outs: 0, pitcherId: undefined, pas: [] },
      });
    }
  };
  const getCurHalf = (nx: any): HalfInningEvent =>
    isTop ? nx.inningsEvents[inningIdx].top : nx.inningsEvents[inningIdx].bot;

  // 本半局資料（渲染用）
  const gg: any = g;
  const curHalf: HalfInningEvent =
    gg.inningsEvents && gg.inningsEvents[inningIdx]
      ? (isTop ? gg.inningsEvents[inningIdx].top : gg.inningsEvents[inningIdx].bot)
      : { outs: 0, pitcherId: undefined, pas: [] };

  const curPA = curHalf.pas?.length ? curHalf.pas[curHalf.pas.length - 1] : null;
  const countFromPitches = (arr: PitchMark[]) => {
    let balls = 0, strikes = 0;
    for (const p of arr) {
      if (p === "B") balls++;
      else if (p === "S") strikes++;
      else if (p === "F" && strikes < 2) strikes++;
    }
    return { balls, strikes };
  };
  const { balls: curBalls, strikes: curStrikes } =
    curPA && curPA.result === null ? countFromPitches(curPA.pitches) : { balls: 0, strikes: 0 };

  // 投手選單（先挑打線裡有 P 的）
  const pitcherOptions = (() => {
    const list = (g.lineup || []).filter((pid: number) =>
      (getNameAndPositions(g, pid).positions || []).includes("P")
    );
    return list.length ? list : (g.lineup || []);
  })();

  // ------- 動作：選投手、逐球、寫入結果 -------
  const setPitcher = (pid: number) => {
    setGames(prev => prev.map(gg => {
      if (gg.id !== g.id) return gg;
      const nx: any = { ...gg };
      ensureInningsEvents(nx, inningIdx);
      getCurHalf(nx).pitcherId = pid || undefined;
      return nx;
    }));
  };

  const addPitch = (mark: PitchMark) => {
    let missingPitcher = false;
    let autoRes: PAResult | null = null;

    setGames(prev => prev.map(gg => {
      if (gg.id !== g.id) return gg;
      const nx: any = { ...gg };
      ensureInningsEvents(nx, inningIdx);
      const half = getCurHalf(nx);

      if (!offense && !half.pitcherId) { missingPitcher = true; return nx; }

      // 取/建當前打席
      let pa = half.pas[half.pas.length - 1];
      if (!pa || pa.result !== null) {
        pa = { batterId: curBatterId, pitcherId: half.pitcherId || 0, pitches: [], result: null, outsAdded: 0, ts: Date.now() };
        half.pas.push(pa);
      }
      pa.pitches.push(mark);

      // 守備半局：逐球累 PC
      if (!offense && half.pitcherId) {
        nx.stats = nx.stats || {};
        if (!nx.stats[half.pitcherId]) nx.stats[half.pitcherId] = emptyTriple();
        inc(nx.stats[half.pitcherId].pitching, "PC", 1);
      }

      // 自動判定 4 壞/3 好
      const { balls, strikes } = countFromPitches(pa.pitches);
      if (balls >= 4) autoRes = "BB";
      else if (strikes >= 3) autoRes = "SO";
      return nx;
    }));

    if (missingPitcher) { alert("請先選擇當局投手"); return; }
    if (autoRes) commitResult(autoRes);
  };

  const commitResult = (res: PAResult) => {
    let turnNextHalf = false;

    setGames(prev => prev.map(gg => {
      if (gg.id !== g.id) return gg;
      const nx: any = { ...gg };
      ensureInningsEvents(nx, inningIdx);
      const half = getCurHalf(nx);
      if (!offense && !half.pitcherId) return nx;

      // 取/建當前打席
      let pa = half.pas[half.pas.length - 1];
      if (!pa || pa.result !== null) {
        pa = { batterId: curBatterId, pitcherId: half.pitcherId || 0, pitches: [], result: null, outsAdded: 0, ts: Date.now() };
        half.pas.push(pa);
      }

      // 寫結果
      pa.result = res;
      pa.outsAdded = outsOf(res);
      if (offense && rbiInput) pa.rbi = rbiInput;
      if (!offense && erInput)  pa.er  = erInput;

      // 打者統計（進攻）
      if (offense && curBatterId) {
        nx.stats = nx.stats || {};
        if (!nx.stats[curBatterId]) nx.stats[curBatterId] = emptyTriple();
        const bat = nx.stats[curBatterId].batting;
        switch (res) {
          case "1B": inc(bat, "1B"); break;
          case "2B": inc(bat, "2B"); break;
          case "3B": inc(bat, "3B"); break;
          case "HR": inc(bat, "HR"); break;
          case "BB": case "IBB": inc(bat, "BB"); break;
          case "HBP": inc(bat, "HBP"); break;
          case "SO": inc(bat, "SO"); break;
          case "GO": inc(bat, "GO"); break;
          case "FO": inc(bat, "FO"); break;
          case "SF": inc(bat, "SF"); break;
          case "SH": inc(bat, "SH"); break;
        }
        if (rbiInput) inc(bat, "RBI", rbiInput);
      }

      // 投手統計（防守）
      if (!offense && half.pitcherId) {
        nx.stats = nx.stats || {};
        if (!nx.stats[half.pitcherId]) nx.stats[half.pitcherId] = emptyTriple();
        const pit = nx.stats[half.pitcherId].pitching;
        if (["1B","2B","3B","HR"].includes(res)) inc(pit, "H");
        if (res === "HR") inc(pit, "HR");
        if (res === "BB" || res === "IBB") inc(pit, "BB");
        if (res === "SO") inc(pit, "K");
        if (isAB(res)) inc(pit, "AB");
        if (erInput) inc(pit, "ER", erInput);
        if (pa.outsAdded) inc(pit, "IP", pa.outsAdded / 3);
      }

      // 換棒/換半局
      const newOuts = Math.max(0, Math.min(3, (half.outs ?? 0) + pa.outsAdded)) as 0|1|2|3;
      half.outs = newOuts;
      turnNextHalf = newOuts >= 3;
      if (offense) {
        const len = lineupPids.length || 9;
        (nx as any)[batterIdxKey] = (nextIdx + 1) % len;
      }
      return nx;
    }));

    if (offense) setRbiInput(0); else setErInput(0);
    queueMicrotask(() => { if (turnNextHalf) setStep(s => s + 1); });
  };

  // ------- UI -------
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
  const curPitcherName = curHalf.pitcherId ? nameOf(curHalf.pitcherId) : "";

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

      {/* 投手（僅防守半局） */}
      {!offense && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm">投手：</div>
          <select className="text-sm border rounded px-2 py-1" value={curHalf.pitcherId || 0} onChange={(e) => setPitcher(Number(e.target.value))}>
            <option value={0}>（選擇投手）</option>
            {pitcherOptions.map((pid) => <option key={pid} value={pid}>{nameOf(pid)}</option>)}
          </select>
          {curPitcherName && <span className="text-xs text-slate-600">目前：{curPitcherName}</span>}
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
          {["1B","2B","3B","HR","BB","IBB","HBP","SO","GO","FO","SF","SH","DP","TP","CS","E","FC"].map((k) => (
            <button key={k} className="px-2 py-1 border rounded" onClick={() => commitResult(k as PAResult)}>{k}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
