import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';

export const metadata = {
  title: 'Vesno | Operating Model Workspace',
  description: 'Living operating-model workspace. Map, run, and improve your processes — every edit is live.',
  icons: {
    icon: [{ url: '/favicon.svg?v=4', type: 'image/svg+xml' }],
  },
};

// Without this, mobile browsers assume a ~980px layout viewport and
// scale the whole app down — every CSS breakpoint below is dead on a
// real phone. device-width makes the media queries actually apply.
// No maximum-scale / user-scalable=no: pinch-zoom must stay (a11y).
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.setAttribute('data-theme','dark');`,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600;700&family=Inter:wght@300;400;500;600;700&family=Work+Sans:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
