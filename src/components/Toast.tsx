import { useEffect, useRef, useState } from 'react';
import { AlertTriangleIcon, CheckIcon, CloseIcon, InfoIcon } from './Icons';

export interface ToastMessage {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  durationMs?: number;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export default function ToastContainer({ toasts, onDismiss }: ToastProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  const remainingMsRef = useRef(toast.durationMs ?? 4000);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => onDismissRef.current(), remainingMsRef.current);
    return () => {
      clearTimeout(timer);
      remainingMsRef.current = Math.max(0, remainingMsRef.current - (Date.now() - startedAt));
    };
  }, [paused, toast.id]);

  const Icon = () => {
    switch (toast.type) {
      case 'success':
        return <CheckIcon className="toast-icon success" width={16} height={16} />;
      case 'warning':
        return <AlertTriangleIcon className="toast-icon warning" width={16} height={16} />;
      case 'error':
        return <AlertTriangleIcon className="toast-icon error" width={16} height={16} />;
      default:
        return <InfoIcon className="toast-icon info" width={16} height={16} />;
    }
  };

  return (
    <div
      className={`toast-item toast-${toast.type}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="alert"
    >
      <div className="toast-content">
        <Icon />
        <span className="toast-message">{toast.message}</span>
      </div>
      <button className="toast-close" onClick={onDismiss} aria-label="Dismiss notification">
        <CloseIcon width={14} height={14} />
      </button>
    </div>
  );
}
