import { useEffect, useState, useCallback } from 'react';

let _showToast: (msg: string) => void = () => {};

export function toast(msg: string) {
  _showToast(msg);
}

export default function ToastContainer() {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((msg: string) => {
    if (timer) clearTimeout(timer);
    setMessage(msg);
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 2200);
    setTimer(t);
  }, [timer]);

  useEffect(() => {
    _showToast = show;
    return () => { _showToast = () => {}; };
  }, [show]);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 11,
        padding: '10px 18px',
        fontSize: '14.3px',
        color: 'var(--text)',
        boxShadow: '0 12px 40px rgba(0,0,0,.5)',
        zIndex: 999,
        opacity: visible ? 1 : 0,
        pointerEvents: 'none',
        transition: 'opacity .25s ease',
        whiteSpace: 'nowrap',
      }}
    >
      {message}
    </div>
  );
}
