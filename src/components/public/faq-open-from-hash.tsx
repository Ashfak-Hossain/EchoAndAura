'use client';

import { useEffect } from 'react';

/**
 * Opens the `<details>` named in the URL hash — on load and when the hash
 * changes (a click on another question's anchor). Browsers scroll to the
 * anchor but do not expand a closed details; `name`-grouped siblings close
 * on their own. Touches the DOM attribute directly: there is no React
 * state here to keep in sync.
 */
export function OpenFromHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      if (el instanceof HTMLDetailsElement) el.open = true;
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);
  return null;
}
