// app/api/clear/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") || "/";

  const html = `<!doctype html><meta charset="utf-8"><title>Clearing…</title>
<body><script>
(async () => {
  // 需要保留的 localStorage key（你的資料）
  const KEEP = ["rsbm.players.v2","rsbm.games.v2","rsbm.lineup.templates.v1"];
  const snap = {};
  try {
    KEEP.forEach(k => snap[k] = localStorage.getItem(k));
  } catch (e) {}

  // 清快取 / SW
  try {
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch (e) {}

  try {
    localStorage.clear();
    sessionStorage.clear();
    Object.keys(snap).forEach(k => {
      if (snap[k] != null) localStorage.setItem(k, snap[k]);
    });
    // 避免回到頁面後又再觸發一次 loop
    sessionStorage.setItem("rsbm.forceReload.once", "1");
  } catch (e) {}

  location.replace(${JSON.stringify(next)});
})();
</script></body>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "pragma": "no-cache",
      "expires": "0"
    }
  });
}
