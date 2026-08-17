import { useState, useEffect, useCallback, useRef } from 'react';

interface TourStep {
  title: string;
  body: string;
  sel?: string;
}

const TOUR_STEPS: TourStep[] = [
  { title: 'Welcome to HigherPays 👋', body: "Here's a 30-second tour of the essentials. You can skip anytime." },
  { sel: '.side nav', title: 'Your workspace', body: 'Everything lives in this sidebar — payments, links, analytics, goals and more.' },
  { sel: '.navitem[href="/analytics"]', title: 'Analytics war room', body: 'Live KPIs with a global date filter up top, plus quick per-section date filters.' },
  { sel: '.navitem[href="/goals"]', title: 'Team Goals', body: 'Set daily, weekly or monthly KPI targets and track the live leaderboard.' },
  { sel: '.navitem[href="/compare"]', title: 'Compare', body: 'Put chatters, creators, or the same metric across different dates side by side.' },
  { sel: '.roleswitch', title: 'Role-aware views', body: 'Switch roles to see exactly what each teammate sees — every screen is scoped to their permissions.' },
  { sel: '.navitem[href="/settings"]', title: 'Make it yours', body: "Set your time zone in Settings so every date and time matches your location. Turn on 2FA while you\u2019re there." },
  { title: 'A few pro tips ✨', body: '• Click any payment row for full detail.\n• Use the per-section filters in Analytics for quick slicing.\n• The leaderboard updates live as sales come in.' },
];

function positionPop(rect: DOMRect, pop: HTMLDivElement) {
  const pad = 14;
  const pw = pop.offsetWidth || 300;
  const ph = pop.offsetHeight || 170;
  const vw = window.innerWidth || 1200;
  const vh = window.innerHeight || 800;
  let left = rect.right + pad;
  let top = rect.top;
  if (left + pw > vw - 10) left = rect.left - pw - pad;
  if (left < 10) {
    left = Math.min(Math.max(10, rect.left), vw - pw - 10);
    top = rect.bottom + pad;
  }
  if (top + ph > vh - 10) top = vh - ph - 10;
  if (top < 10) top = 10;
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

export default function ProductTour() {
  const [seen, setSeen] = useState(false);
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const popRef = useRef<HTMLDivElement>(null);

  // Auto-start after short delay
  useEffect(() => {
    if (seen) return;
    const t = setTimeout(() => {
      if (!seen) setActive(true);
    }, 700);
    return () => clearTimeout(t);
  }, [seen]);

  // Visible steps (skip ones whose selector isn't in DOM)
  const visibleSteps = useCallback(() => {
    return TOUR_STEPS.filter(s => {
      if (!s.sel) return true;
      const el = document.querySelector(s.sel);
      return el && (el as HTMLElement).offsetParent !== null;
    });
  }, []);

  const steps = active ? visibleSteps() : [];
  const current = steps[step] || null;

  // Position spotlight + popover
  useEffect(() => {
    if (!active || !current || !popRef.current) return;
    const pop = popRef.current;
    const el = current.sel ? document.querySelector(current.sel) : null;
    const rect = el?.getBoundingClientRect?.();
    if (rect && (rect.width || rect.height)) {
      positionPop(rect, pop);
    } else {
      pop.style.left = Math.max(10, ((window.innerWidth || 1200) - (pop.offsetWidth || 300)) / 2) + 'px';
      pop.style.top = Math.max(10, ((window.innerHeight || 800) - (pop.offsetHeight || 180)) / 2) + 'px';
    }
  }, [active, step, current]);

  const end = () => { setActive(false); setSeen(true); };
  const go = (i: number) => {
    if (i < 0) i = 0;
    if (i >= steps.length) { end(); return; }
    setStep(i);
  };

  const spotEl = current?.sel ? document.querySelector(current.sel) : null;
  const spotRect = spotEl?.getBoundingClientRect?.() ?? null;
  const showSpot = spotRect && (spotRect.width || spotRect.height);

  if (!active && !seen) return null;

  return (
    <>
      {/* Help button */}
      <button
        onClick={() => { setStep(0); setActive(true); }}
        title="Take a tour"
        style={{
          position: 'fixed', right: 18, bottom: 18, zIndex: 900,
          width: 42, height: 42, borderRadius: '50%',
          border: '1px solid var(--line)', background: 'var(--panel-2)',
          color: 'var(--brand)', fontSize: 20, fontWeight: 800,
          cursor: 'pointer', boxShadow: '0 8px 24px rgba(0,0,0,.4)',
        }}
      >
        ?
      </button>

      {/* Tour overlay */}
      {active && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }}>
          {/* Spotlight */}
          {showSpot && spotRect && (
            <div style={{
              position: 'absolute',
              left: spotRect.left - 6, top: spotRect.top - 6,
              width: spotRect.width + 12, height: spotRect.height + 12,
              borderRadius: 12,
              boxShadow: '0 0 0 9999px rgba(3,13,21,.74)',
              border: '2px solid var(--brand)',
              pointerEvents: 'none',
              transition: 'all .32s cubic-bezier(.22,1,.36,1)',
            }} />
          )}
          {/* Click-away backdrop when no spotlight */}
          {!showSpot && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'rgba(3,13,21,.74)',
            }} onClick={end} />
          )}

          {/* Popover */}
          <div ref={popRef} style={{
            position: 'absolute', width: 300, maxWidth: 'calc(100vw - 24px)',
            background: 'var(--panel-2)', border: '1px solid var(--line)',
            borderRadius: 14, padding: '16px 16px 14px',
            boxShadow: '0 24px 70px rgba(0,0,0,.55)',
            transition: 'left .28s, top .28s',
          }}>
            <div style={{ fontWeight: 800, fontSize: '15.4px', marginBottom: 6 }}>
              {current?.title}
            </div>
            <div style={{ fontSize: '13.4px', color: 'var(--muted)', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
              {current?.body}
            </div>
            {/* Dots */}
            <div style={{ display: 'flex', gap: 5, marginTop: 12 }}>
              {steps.map((_, i) => (
                <i key={i} style={{
                  width: i === step ? 16 : 6, height: 6,
                  borderRadius: i === step ? 3 : '50%',
                  background: i === step ? 'var(--brand)' : 'var(--line)',
                  display: 'inline-block',
                  transition: 'width .2s',
                }} />
              ))}
            </div>
            {/* Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <button className="btn ghost" style={{ padding: '7px 12px' }} onClick={end}>Skip</button>
              <span style={{ flex: 1 }} />
              {step > 0 && (
                <button className="btn ghost" style={{ padding: '7px 12px' }} onClick={() => go(step - 1)}>Back</button>
              )}
              <button className="btn" style={{ padding: '7px 14px' }} onClick={() => go(step + 1)}>
                {step >= steps.length - 1 ? 'Done' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
