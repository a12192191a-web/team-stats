/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_BUILD:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      new Date().toISOString().replace(/[-:TZ:.]/g, '').slice(0, 12),
    NEXT_PUBLIC_BUILD_AT: new Date().toISOString(),
  },

  // ✅ 自訂 buildId（用 commit，沒有就用 timestamp）
  generateBuildId: async () =>
    process.env.VERCEL_GIT_COMMIT_SHA ?? Date.now().toString(36),

  async headers() {
    return [
      {
        source: '/:path*',
        // 只對「拿 HTML 的文件請求」加 no-store（避免影響 /_next/static/*）
        has: [{ type: 'header', key: 'accept', value: '.*text/html.*' }],
        // 避免誤傷 Next 的資料請求（預抓取時常帶 x-nextjs-data: 1）
        missing: [{ type: 'header', key: 'x-nextjs-data', value: '1' }],
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
    ];
  },
};

export default nextConfig;
