import { Outlet } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';

export function AppLayout() {
  return (
    <div className="flex h-screen bg-background">
      {/* Skip link — visible only when keyboard-focused, lets screen-reader
          users bypass the sidebar and jump straight to the page content. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:rounded-lg focus:shadow-lg"
      >
        Skip to main content
      </a>
      <AppSidebar />
      <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
