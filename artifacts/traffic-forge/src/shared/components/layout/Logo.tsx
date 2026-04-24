import { Zap } from 'lucide-react';

export function Logo() {
  return (
    <div className="flex items-center gap-2 px-3 py-4">
      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 border border-primary/20">
        <Zap className="w-5 h-5 text-primary" fill="currentColor" />
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-bold text-foreground tracking-tight leading-none">TrafficForge</span>
        <span className="text-[10px] font-mono text-primary tracking-widest">AI</span>
      </div>
    </div>
  );
}
