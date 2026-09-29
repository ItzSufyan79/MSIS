'use client';

import { useCallback, useRef, useState } from 'react';

interface UseResizableOptions {
  initial: number;
  min?: number;
  max?: number;
  direction?: 'vertical' | 'horizontal';
  invert?: boolean;
}

interface UseResizableReturn {
  size: number;
  setSize: (n: number) => void;
  isDragging: boolean;
  handleProps: {
    onMouseDown: (e: React.MouseEvent) => void;
    style: React.CSSProperties;
  };
}

export function useResizable({
  initial,
  min = 80,
  max = Infinity,
  direction = 'vertical',
  invert = false,
}: UseResizableOptions): UseResizableReturn {
  const [size, setSize] = useState(initial);
  const [isDragging, setIsDragging] = useState(false);
  const ref = useRef({ start: 0, startSize: 0 });

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const axis = direction === 'horizontal' ? e.clientX : e.clientY;
      ref.current = { start: axis, startSize: size };
      setIsDragging(true);

      const onMouseMove = (ev: MouseEvent) => {
        const current = direction === 'horizontal' ? ev.clientX : ev.clientY;
        const delta = invert ? ref.current.start - current : current - ref.current.start;
        const next = Math.round(Math.min(max, Math.max(min, ref.current.startSize + delta)));
        setSize(next);
      };

      const onMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [size, min, max, direction, invert],
  );

  const handleProps = {
    onMouseDown,
    style: {
      [direction === 'vertical' ? 'height' : 'width']: 10,
      cursor: direction === 'vertical' ? 'row-resize' : 'col-resize',
      touchAction: 'none' as const,
    } satisfies React.CSSProperties,
  };

  return { size, setSize, isDragging, handleProps };
}
