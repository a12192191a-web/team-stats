import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function build() {
  return process.env.NEXT_PUBLIC_BUILD || "";
}

export async function GET() {
  return new NextResponse("ok", {
    headers: {
      "x-build": build(),
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}

export const HEAD = GET;
