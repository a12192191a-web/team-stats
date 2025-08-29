// Server Component wrapper（不要加 "use client"）
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import ClientPage from './_client-page';

export default function Page() {
  return <ClientPage />;
}
