import { Link, useLocation } from 'react-router-dom';
import { BarChart3, Zap, Settings, Activity, TrendingUp, FileText } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

export function AppSidebar() {
  const location = useLocation();

  const links = [
    { label: 'Overview', href: '/', icon: BarChart3 },
    { label: 'Dashboard', href: '/dashboard', icon: Zap },
    { label: 'Test Config', href: '/test-config', icon: Settings },
    { label: 'Agents', href: '/agents', icon: Activity },
    { label: 'Analytics', href: '/analytics', icon: TrendingUp },
    { label: 'Reports', href: '/reports', icon: FileText },
  ];

  return (
    <aside className="w-64 border-r border-border bg-card">
      <div className="p-6">
        <h1 className="text-xl font-bold text-foreground">TrafficForge</h1>
      </div>
      <nav className="space-y-2 px-4">
        {links.map(({ label, href, icon: Icon }) => (
          <Link
            key={href}
            to={href}
            className={cn(
              'flex items-center gap-3 px-4 py-2 rounded-lg transition-colors',
              location.pathname === href
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <Icon className="w-4 h-4" />
            <span className="text-sm font-medium">{label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
