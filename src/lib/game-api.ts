"use client";

import { supabase } from "@/lib/supabase";

/** 一筆球員在單場比賽的原始計數（打投守跑都放 json） */
export type GameStatRow = {
  playerId: string;              // players.id (uuid)
  batting?: any;                 // 例：{ AB:4, H:2, BB:1, R:1, RBI:2, ... }
  pitching?: any;                // 例：{ ip_outs:8, ER:1, SO:3, BB:1, H:2, PC:42, ... }
  fielding?: any;                // 例：{ PO:1, A:2, E:0 }
  baserunning?: any;             // 例：{ SB:1, CS:0 }
};

/* -------------------------------------------------------
   A) 寫入／更新單場資料（按「儲存」時呼叫）
   ------------------------------------------------------- */
export async function saveGameStats(gameId: string, rows: GameStatRow[]) {
  // ✅ 如果你的 game_stats 欄位叫「game_id / player_id」（推薦）
  const payload = rows.map((r) => ({
    game_id: gameId,
    player_id: r.playerId,
    batting: r.batting ?? {},
    pitching: r.pitching ?? {},
    fielding: r.fielding ?? {},
    baserunning: r.baserunning ?? {},
  }));

  // ⛔ 如果你的表是「game_local_id / player_local_id (bigint)」，把上面的 key 換掉：
  // const payload = rows.map((r, i) => ({
  //   game_local_id: Number(gameId),         // 你的 gameId 若是數字
  //   player_local_id: Number(r.playerId),   // 若 players 也是數字主鍵
  //   batting: r.batting ?? {},
  //   pitching: r.pitching ?? {},
  //   fielding: r.fielding ?? {},
  //   baserunning: r.baserunning ?? {},
  // }));

  const { error } = await supabase
    .from("game_stats")
    // 若是 local_id 組合鍵，改成 onConflict: "game_local_id,player_local_id"
    .upsert(payload, { onConflict: "game_id,player_id" });

  if (error) throw error;
}

/* -------------------------------------------------------
   B) 讀取單場資料（頁面載入時用）
   ------------------------------------------------------- */
export async function fetchGameStats(gameId: string) {
  // 若是 local_id 欄位，請把下面 eq/選取的欄位名稱換掉
  const { data, error } = await supabase
    .from("game_stats")
    .select("player_id, batting, pitching, fielding, baserunning")
    .eq("game_id", gameId);

  if (error) throw error;
  return data ?? [];
}

/* -------------------------------------------------------
   C) Realtime 即時同步（其他裝置有改動就會更新）
   ------------------------------------------------------- */
export function subscribeGameStats(
  gameId: string,
  onChange: (event: "INSERT" | "UPDATE" | "DELETE", newRow: any, oldRow: any) => void
) {
  // 若是 local_id 欄位，請把 filter 改成 `game_local_id=eq.${gameId}`
  const channel = supabase
    .channel(`gs-${gameId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "game_stats", filter: `game_id=eq.${gameId}` },
      (payload) => onChange(payload.eventType as any, payload.new, payload.old)
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

/* -------------------------------------------------------
   D) 最省事的 Hook：載入 + 即時同步
   在你的頁面直接用 useCloudGame(gameId)
   ------------------------------------------------------- */
import { useEffect, useState } from "react";

export function useCloudGame(gameId: string) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // 初次載入
  useEffect(() => {
    if (!gameId) return;
    (async () => {
      setLoading(true);
      try {
        const initial = await fetchGameStats(gameId);
        setRows(initial);
      } finally {
        setLoading(false);
      }
    })();
  }, [gameId]);

  // Realtime
  useEffect(() => {
    if (!gameId) return;
    const off = subscribeGameStats(gameId, (evt, newRow, oldRow) => {
      setRows((prev) => {
        if (evt === "DELETE") {
          const pId = (oldRow.player_id ?? oldRow.player_local_id) as string | number;
          return prev.filter((r: any) => (r.player_id ?? r.player_local_id) !== pId);
        }
        // INSERT / UPDATE -> 用 player 主鍵去覆蓋
        const key = (newRow.player_id ?? newRow.player_local_id) as string | number;
        const others = prev.filter((r: any) => (r.player_id ?? r.player_local_id) !== key);
        return [...others, newRow];
      });
    });
    return off;
  }, [gameId]);

  return { rows, loading };
}
