// src/app/api/clear/route.ts
export async function GET(req: Request) {
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
      "Clear-Site-Data": '"cache", "storage"',
    },
  });
}
