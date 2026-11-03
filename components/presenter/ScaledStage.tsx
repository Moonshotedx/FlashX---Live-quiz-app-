'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Renders children on a fixed 1920x1080 canvas and scales it to fit the parent (letterboxed).
 * Used for the real presenter view and for the 16:9 preview in the theme editor.
 */
export function ScaledStage({ children, width = 1920, height = 1080 }: { children: ReactNode; width?: number; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(Math.min(el.clientWidth / width, el.clientHeight / height));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  return (
    <div ref={ref} className="relative h-full w-full overflow-hidden">
      <div
        style={{
          width,
          height,
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: `translate(-50%,-50%) scale(${scale ?? 0})`,
          visibility: scale === null ? 'hidden' : 'visible',
        }}
      >
        {children}
      </div>
    </div>
  );
}

