import React, { useState, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext.jsx';
import { PageLoader, useDelayedLoading } from './components/Spinner.jsx';
import Icon, { Avatar } from './components/Icon.jsx';
import { roleLabel } from './lib/format.js';

import Login from './pages/Login.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Projects from './pages/Projects.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import UserManagement from './pages/UserManagement.jsx';
import AuditTrail from './pages/AuditTrail.jsx';
import Profile from './pages/Profile.jsx';

/* ───────────── Route Guards ───────────── */
function RequireAuth({ children }) {
  const { person, loading } = useAuth();
  const location = useLocation();
  const showLoader = useDelayedLoading(loading);
  if (loading) return showLoader ? <PageLoader fullscreen /> : null;
  if (!person) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function RequireAdmin({ children }) {
  const { person, loading } = useAuth();
  const showLoader = useDelayedLoading(loading);
  if (loading) return showLoader ? <PageLoader fullscreen /> : null;
  if (!person) return <Navigate to="/login" replace />;
  if (person.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
}

function RedirectIfAuthed({ children }) {
  const { person, loading } = useAuth();
  const showLoader = useDelayedLoading(loading);
  if (loading) return showLoader ? <PageLoader fullscreen /> : null;
  if (person) return <Navigate to="/dashboard" replace />;
  return children;
}

/* ───────────── Navigation ───────────── */
function NavItem({ to, icon, children, onNavigate, collapsed }) {
  return (
    <NavLink
      to={to}
      end={to === '/dashboard'}
      onClick={onNavigate}
      title={collapsed ? children : undefined}
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
    >
      <Icon name={icon} />
      <span>{children}</span>
    </NavLink>
  );
}

function UserMenu({ person, signOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const keyHandler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="user-button" onClick={() => setOpen(v => !v)} aria-label="Account menu" aria-expanded={open} title={person.name || person.email}>
        <Avatar name={person.name || person.email} />
        <div className="user-meta">
          <div className="user-name">{person.name || 'User'}</div>
          <div className="user-role">{roleLabel(person.role)}</div>
        </div>
        <Icon name="chevronsUpDown" size={16} style={{ color: 'var(--text-3)' }} />
      </button>
      {open && (
        <div className="dropdown" style={{ left: 0, right: 0, bottom: 'calc(100% + 6px)' }}>
          <div className="dropdown-header">
            <div className="fw-600 truncate">{person.name || 'User'}</div>
            <div className="text-xs muted truncate">{person.email}</div>
          </div>
          <button className="dropdown-item" onClick={() => { setOpen(false); navigate('/profile'); }}>
            <Icon name="user" /> My Profile
          </button>
          <button className="dropdown-item danger" onClick={() => { setOpen(false); signOut(); }}>
            <Icon name="logout" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

const PAGE_TITLES = [
  ['/dashboard', 'Dashboard'],
  ['/projects', 'Projects'],
  ['/user-management', 'Users'],
  ['/audit', 'Audit Trail'],
  ['/profile', 'My Profile'],
];

/* ───────────── Shell Layout ───────────── */
function Shell({ children }) {
  const { person, signOut } = useAuth();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('pd.sidebarCollapsed') === '1');

  useEffect(() => {
    localStorage.setItem('pd.sidebarCollapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setCollapsed(c => !c);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const isAdmin = person?.role === 'admin';
  const title = PAGE_TITLES.find(([p]) => location.pathname.startsWith(p))?.[1] || '';
  const closeNav = () => setNavOpen(false);

  return (
    <div className={`app${collapsed ? ' collapsed' : ''}`}>
      <div className={`sidebar-backdrop${navOpen ? ' open' : ''}`} onClick={closeNav} />
      <aside className={`sidebar${navOpen ? ' open' : ''}`}>
        <Link to="/dashboard" className="sidebar-brand" onClick={closeNav}>
          <span className="brand-mark">P</span>
          <span className="brand-text">ProjectDelivery</span>
        </Link>
        <nav className="sidebar-nav">
          <div className="sidebar-section" style={{ paddingTop: 4 }}>Workspace</div>
          <NavItem to="/dashboard" icon="dashboard" onNavigate={closeNav} collapsed={collapsed}>Dashboard</NavItem>
          <NavItem to="/projects" icon="folder" onNavigate={closeNav} collapsed={collapsed}>Projects</NavItem>
          {isAdmin && (
            <>
              <div className="sidebar-section">Administration</div>
              <NavItem to="/user-management" icon="users" onNavigate={closeNav} collapsed={collapsed}>Users</NavItem>
              <NavItem to="/audit" icon="history" onNavigate={closeNav} collapsed={collapsed}>Audit Trail</NavItem>
            </>
          )}
        </nav>
        {person && (
          <div className="sidebar-footer">
            <UserMenu person={person} signOut={signOut} />
          </div>
        )}
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon menu-toggle" onClick={() => setNavOpen(true)} aria-label="Open navigation">
            <Icon name="menu" />
          </button>
          <button
            className="btn btn-ghost btn-icon btn-sm collapse-toggle"
            onClick={() => setCollapsed(c => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed}
            title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl/⌘ + B)`}
          >
            <Icon name="panelLeft" />
          </button>
          <div className="text-sm muted">{title}</div>
          <div className="topbar-spacer" />
        </header>
        <main className="content" key={location.pathname}>
          {children}
        </main>
      </div>
    </div>
  );
}

/* ───────────── App ───────────── */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<RedirectIfAuthed><Login /></RedirectIfAuthed>} />
      <Route path="/forgot-password" element={<RedirectIfAuthed><ForgotPassword /></RedirectIfAuthed>} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route path="/dashboard" element={<RequireAuth><Shell><Dashboard /></Shell></RequireAuth>} />
      <Route path="/projects" element={<RequireAuth><Shell><Projects /></Shell></RequireAuth>} />
      <Route path="/projects/:id" element={<RequireAuth><Shell><ProjectDetail /></Shell></RequireAuth>} />
      <Route path="/profile" element={<RequireAuth><Shell><Profile /></Shell></RequireAuth>} />

      <Route path="/user-management" element={<RequireAdmin><Shell><UserManagement /></Shell></RequireAdmin>} />
      <Route path="/audit" element={<RequireAdmin><Shell><AuditTrail /></Shell></RequireAdmin>} />

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
