import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Providers } from '@/app/providers';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Trading Desk — Real-time market dashboard with AI scanner',
  description: 'Live US equity quotes, interactive charts with technical indicators, price alerts, and explainable AI trade-scanner insights.',
  applicationName: 'Trading Desk',
  appleWebApp: { capable: true, title: 'Trading Desk', statusBarStyle: 'black-translucent' },
  icons: { apple: '/pwa-icon/192' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0a0d12' },
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
      <body className="min-h-screen" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
