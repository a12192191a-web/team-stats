/** @type {import('next').NextConfig} */
const nextConfig = {
  // 你原本就有的版本碼（保留）
  env: {
    NEXT_PUBLIC_BUILD:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      new Date().toISOString().replace(/[-:TZ:.]/g, '').slice(0, 12),
  },

  // 新增這段：只對「瀏覽器要 HTML」的請求回 no-store，靜態資產照樣快取
  async headers() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'header', key: 'accept', value: '.*text/html.*' }],
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
