'use client';

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Keyboard, X } from 'lucide-react';

const SHORTCUTS = [
  { key: 'F', desc: 'Toggle fullscreen' },
  { key: 'L', desc: 'Toggle layer panel' },
  { key: 'R', desc: 'Reset to global view' },
  { key: '?', desc: 'Show this help' },
  { key: 'ESC', desc: 'Close panels / popups' },
];

export default function KeyboardShortcuts({ open, onOpenChange }: { open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const isOpen = open ?? false;
  const setIsOpen = (o: boolean) => { onOpenChange?.(o); };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as Element)?.tagName)) return;
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) setIsOpen(!isOpen);
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="fixed inset-0 z-[500] flex items-center justify-center pointer-events-auto"
          onClick={() => setIsOpen(false)}
        >
          <div className="absolute inset-0 bg-[var(--bg-void)]/80 backdrop-blur-sm" />
          <motion.div
            onClick={e => e.stopPropagation()}
            className="relative glass-panel p-6 w-[320px] msis-glow"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Keyboard className="w-4 h-4 text-[var(--gold-primary)]" />
                <span className="text-sm font-mono font-bold text-[var(--text-heading)] tracking-wider">SHORTCUTS</span>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              {SHORTCUTS.map(s => (
                <div key={s.key} className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-[var(--text-secondary)]">{s.desc}</span>
                  <kbd className="px-2 py-0.5 rounded text-[9px] font-mono font-bold text-[var(--gold-primary)] bg-[var(--bg-void)]">
                    {s.key}
                  </kbd>
                </div>
              ))}
            </div>
            <div className="mt-4 text-center text-[9px] font-mono text-[var(--text-muted)] tracking-widest">
              PRESS [?] OR [ESC] TO CLOSE
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
