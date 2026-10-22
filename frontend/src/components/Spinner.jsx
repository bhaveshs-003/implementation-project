import { useEffect, useState } from 'react';

export function useDelayedLoading(loading, delay = 250) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!loading) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [loading, delay]);
  return show;
}

export function Spinner({ size = 32, thickness = 3 }) {
  return <div className="spinner" style={{ width: size, height: size, borderWidth: thickness }} />;
}

export function PageLoader({ message = 'Loading…', fullscreen = false }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: fullscreen ? '100vh' : '60vh', gap: 16 }}>
      <Spinner size={36} thickness={3} />
      <div className="text-sm muted" style={{ animation: 'pd-pulse 1.5s ease-in-out infinite' }}>{message}</div>
    </div>
  );
}

export function InlineLoader({ message = 'Loading…' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', gap: 12 }}>
      <Spinner size={20} thickness={2} />
      <span className="text-sm muted">{message}</span>
    </div>
  );
}

export function SkeletonBlock({ width = '100%', height = 16, radius = 6, style: extra = {} }) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius, ...extra }} />;
}

export function ProjectDetailSkeleton() {
  return (
    <div>
      <SkeletonBlock width={90} height={12} style={{ marginBottom: 14 }} />
      <SkeletonBlock width={320} height={28} style={{ marginBottom: 8 }} />
      <SkeletonBlock width={160} height={14} style={{ marginBottom: 28 }} />
      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        {[80, 96, 90].map((w, i) => <SkeletonBlock key={i} width={w} height={14} />)}
      </div>
      <div className="stat-grid">
        {[1, 2, 3].map(i => (
          <div key={i} className="card stat">
            <SkeletonBlock width="50%" height={12} />
            <SkeletonBlock width="35%" height={28} />
          </div>
        ))}
      </div>
      <div className="card card-body">
        <SkeletonBlock width={180} height={16} style={{ marginBottom: 20 }} />
        {[1, 2, 3].map(i => (
          <div key={i} style={{ borderTop: '1px solid var(--border)', padding: '16px 0' }}>
            <SkeletonBlock width="45%" height={14} style={{ marginBottom: 8 }} />
            <SkeletonBlock width="25%" height={10} />
          </div>
        ))}
      </div>
    </div>
  );
}
