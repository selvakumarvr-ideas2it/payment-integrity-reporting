import type { Metadata } from 'next';
import { Suspense } from 'react';
import Providers from './providers';

export const metadata: Metadata = {
  title: 'Payment Integrity Reporting',
  description: 'Savings Invoice for Centene',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Suspense>
          <Providers>{children}</Providers>
        </Suspense>
      </body>
    </html>
  );
}
