import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { api, AuthContext, Loading } from './lib';
import type { User } from './types';
import { AuthPage, Dashboard, JoinPage, Shell, SettingsPage, WorkspacePage } from './workspace';
import { ProjectPage } from './project';
import './styles.css';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const location = useLocation();
  useEffect(() => {
    api<{ user: User }>('/auth/me').then(data => setUser(data.user))
      .catch(err => { if (err.status !== 401) setError('Accordly could not connect to the server. Refresh to try again.'); })
      .finally(() => setReady(true));
    const expire = () => setUser(null);
    window.addEventListener('goti-session-expired', expire);
    return () => window.removeEventListener('goti-session-expired', expire);
  }, []);
  if (!ready) return <Loading />;
  if (error) return <div className="connection-error"><p role="alert">{error}</p><button className="button" onClick={() => window.location.reload()}>Retry connection</button></div>;
  const redirect = '/login?next=' + encodeURIComponent(location.pathname + location.search);
  return <AuthContext.Provider value={{ user, setUser }}>
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<AuthPage register />} />
      <Route element={user ? <Shell /> : <Navigate to={redirect} replace />}>
        <Route index element={<Dashboard />} />
        <Route path="/workspace" element={<WorkspacePage />} />
        <Route path="/projects/:id" element={<ProjectPage key={location.pathname} />} />
        <Route path="/join/:token" element={<JoinPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<div className="empty"><h1>Page not found</h1><a href="/">Return to your projects</a></div>} />
      </Route>
    </Routes>
  </AuthContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>);
