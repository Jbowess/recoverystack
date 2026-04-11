'use client';

import { useEffect, useState } from 'react';

export default function ExitIntentModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onMouseLeave = (event: MouseEvent) => {
      if (event.clientY <= 0) setOpen(true);
    };
    window.addEventListener('mouseout', onMouseLeave);
    return () => window.removeEventListener('mouseout', onMouseLeave);
  }, []);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true">
      <h3>Get the Ultimate Recovery Protocol PDF</h3>
      <p>Free download. Practical plan, no hype.</p>
      <button onClick={() => setOpen(false)}>Close</button>
    </div>
  );
}
