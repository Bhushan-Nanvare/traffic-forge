import { Link, useLocation } from 'react-router-dom';
import {
  BarChart3,
  Zap,
  Settings,
  Activity,
  TrendingUp,
  FileText,
  Bug,
  GitBranch,
  Gauge,
  LineChart,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';

export function AppSidebar() {
  const location = useLocation();

  const groups = [
    {
      label: 'Testing',
      links: [
        { label: 'Overview', href: '/', icon: BarChart3 },
        { label: 'Test Config', href: '/test-config', icon: Settings },
        { label: 'Dashboard', href: '/dashboard', icon: Zap },
        { label: 'Agents', href: '/agents', icon: Activity },
      ],
    },
    {
      label: 'Analysis',
      links: [
        { label: 'Reports', href: '/reports', icon: FileText },
        { label: 'Bug Results', href: '/results', icon: Bug },
        { label: 'Root Cause', href: '/rca', icon: GitBranch },
        { label: 'Bottlenecks', href: '/bottleneck', icon: Gauge },
        { label: 'Predictions', href: '/prediction', icon: LineChart },
        { label: 'Analytics', href: '/analytics', icon: TrendingUp },
      ],
    },
  ];

  return (
    <aside aria-label="Primary navigation" className="w-60 border-r border-border bg-card flex flex-col">
      <div className="p-5 border-b border-border">
        <h1 className="text-lg font-bold text-foreground">TrafficForge</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Intelligent Load Testing</p>
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto py-4">
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="px-5 mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              {group.label}
            </p>
            <div className="space-y-0.5 px-3">
              {group.links.map(({ label, href, icon: Icon }) => {
                const isActive = location.pathname === href;
                return (
                  <Link
                    key={href}
                    to={href}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="text-sm font-medium">{label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
