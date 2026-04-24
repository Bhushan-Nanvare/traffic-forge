import { Routes, Route } from 'react-router-dom';
import { AppLayout } from './shared/components/layout/AppLayout';
import Overview from './features/overview/Overview';
import Dashboard from './features/dashboard/Dashboard';
import TestConfig from './features/test-config/TestConfig';
import AgentMonitor from './features/agent-monitor/AgentMonitor';
import AgentActivityViewer from './features/agent-monitor/AgentActivityViewer';
import Analytics from './features/analytics/Analytics';
import Reports from './features/reports/Reports';
import NotFound from './pages/NotFound';

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Overview />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/test-config" element={<TestConfig />} />
        <Route path="/agents" element={<AgentMonitor />} />
        <Route path="/agent-activity" element={<AgentActivityViewer />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default App;
