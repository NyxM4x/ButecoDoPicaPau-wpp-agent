'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Hace que su contenido entre creciendo la primera vez que llega a la pantalla
 * (la foto de cada plato). El gesto está en `globals.css` (`.menu-reveal`);
 * esto solo avisa cuándo.
 *
 * Una sola vez: al volver a subir, la foto ya está en su sitio. Repetir la
 * entrada cada vez que el plato cruza la pantalla cansa, y hace que el menú
 * parezca estar cargando.
 */
export function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Un navegador sin IntersectionObserver no se queda con el menú en blanco.
    if (typeof IntersectionObserver === 'undefined') {
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisible(true);
        observer.disconnect();
      },
      // Espera a que asome un buen trozo: si arranca con el primer píxel, el
      // gesto ocurre debajo del pulgar y nadie lo ve.
      { threshold: 0.2, rootMargin: '0px 0px -6% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`menu-reveal ${visible ? 'is-visible' : ''} ${className}`}>
      {children}
    </div>
  );
}
