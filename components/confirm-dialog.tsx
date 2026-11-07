'use client';

import { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Батлах',
  cancelLabel = 'Болих',
  variant = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      confirmBtnRef.current?.focus();
    }, 30);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, busy, onCancel]);

  if (!isOpen) return null;

  const isDanger = variant === 'danger';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        backgroundColor: 'rgba(15, 23, 42, 0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        style={{
          width: 'min(440px, 100%)',
          background: 'var(--parchment-card, #fffdf9)',
          border: '1px solid var(--parchment-border, #e2d9c8)',
          borderRadius: '16px',
          padding: '22px 24px',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isDanger ? 'rgba(220, 38, 38, 0.12)' : 'rgba(217, 119, 6, 0.14)',
                color: isDanger ? '#dc2626' : '#b45309',
                flexShrink: 0,
              }}
              aria-hidden="true"
            >
              <AlertTriangle size={18} />
            </span>
            <h3
              id="confirm-dialog-title"
              style={{ margin: 0, font: '600 17px Georgia, serif', color: 'var(--ink-primary, #17372b)' }}
            >
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Хаах"
            style={{
              background: 'none',
              border: 'none',
              cursor: busy ? 'not-allowed' : 'pointer',
              color: '#64748b',
              padding: '4px',
            }}
          >
            <X size={18} />
          </button>
        </div>

        <p
          id="confirm-dialog-desc"
          style={{
            margin: '0 0 20px',
            fontSize: '13.5px',
            lineHeight: 1.55,
            color: 'var(--ink-secondary, #485c53)',
            whiteSpace: 'pre-line',
          }}
        >
          {message}
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="homev2-button homev2-button--light"
            style={{ fontSize: '12.5px', padding: '8px 16px' }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              fontSize: '12.5px',
              padding: '8px 18px',
              borderRadius: '999px',
              border: 'none',
              fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
              background: isDanger ? '#dc2626' : 'var(--ink-primary, #17372b)',
              color: '#ffffff',
            }}
          >
            {busy ? 'Гүйцэтгэж байна…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
