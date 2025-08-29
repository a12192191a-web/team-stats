import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  const v = process.env.NEXT_PUBLIC_BUILD ?? "";
  return {
    name: "RS Baseball Manager",
    short_name: "RSBM",
    start_url: "/?v=" + v,
    display: "standalone",
    scope: "/",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
