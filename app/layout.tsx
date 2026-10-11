import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI 狄仁杰 · 古风问答',
  description: '以狄公之智，解君之惑。· Demo only · EdgeOne Makers',
  keywords: 'EdgeOne Makers, Demo only',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
