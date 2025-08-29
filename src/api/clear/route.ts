import type { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") || "/";

  const html = `<!doctype html>
<meta http-equiv="refresh" content="0;url=${next}">
<p>Clearing…</p>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // 這行是關鍵：清掉這個網域的快取與儲存（含 PWA Cache Storage）
      "Clear-Site-Data": '"cache", "storage"',
    },
  });
}
