// A block that opens and closes smoothly instead of jumping: its height slides between 0 and its
// content (the grid-rows trick), and while it closes it keeps showing what it showed last. Nothing
// moves when the person asked for reduced motion.
import { useRef, type ReactNode } from 'react';

export function Smooth({ open, children, className = '' }: { open: boolean; children: ReactNode; className?: string }) {
  const last = useRef<ReactNode>(children);
  if (open) last.current = children;
  return (
    <div aria-hidden={!open} className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${className}`}
      style={{ gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0 }}>
      <div className="min-h-0 overflow-hidden">{open ? children : last.current}</div>
    </div>
  );
}
