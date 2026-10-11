import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI 狄仁杰 · 古风问答',
  description: '以狄公之智，解君之惑。· Demo only · EdgeOne Makers',
  keywords: 'EdgeOne Makers, Demo only',
};

const CLARITY_PROJECT_ID = 'yvvgoh16il';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 微软 Clarity 用户行为分析，需在 head 中尽早加载 */}
        <Script id="ms-clarity" strategy="beforeInteractive">
          {`(function(c,l,a,r,i,t,y){
    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
  })(window, document, "clarity", "script", "${CLARITY_PROJECT_ID}");`}
        </Script>
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
