'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback, useSyncExternalStore } from 'react';

// ─── useAnimatedValue Hook ─────────────────────────────────────────────────

export function useAnimatedValue(target: number, duration: number = 800): { current: number; isAnimating: boolean } {
  const [current, setCurrent] = useState(target);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevTargetRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (prevTargetRef.current === target) return;
    const start = prevTargetRef.current;
    const diff = target - start;
    const startTime = performance.now();
    let started = false;

    function tick(now: number) {
      if (!started) {
        started = true;
        setIsAnimating(true);
      }
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutCubic for natural deceleration
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(Math.round(start + diff * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        prevTargetRef.current = target;
        setCurrent(target);
        setIsAnimating(false);
      }
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  // Sync on first render
  useEffect(() => {
    prevTargetRef.current = target;
  }, []);

  return { current, isAnimating };
}

// ─── Animated Number Component ───────────────────────────────────────────────

export function AnimatedNumber({ value, decimals = 0, suffix = '', glowColor }: { value: number; decimals?: number; suffix?: string; glowColor?: string }) {
  const scaledTarget = Math.round(value * Math.pow(10, decimals));
  const { current: animated, isAnimating } = useAnimatedValue(scaledTarget, 800);
  const display = (animated / Math.pow(10, decimals)).toFixed(decimals);
  return (
    <span
      className={`tabular-nums inline-block transition-colors duration-300${isAnimating && glowColor ? ' animated-number-glow' : ''}`}
      style={isAnimating && glowColor ? { '--glow-color': glowColor } as React.CSSProperties : undefined}
    >
      {display}{suffix}
    </span>
  );
}

// ─── HeaderParticles Component ──────────────────────────────────────────────

export function HeaderParticles() {
  // Only render on client to avoid hydration mismatch with animated CSS particles
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  // Static particle definitions to avoid SSR/CSR hydration mismatch (no Math.random, no Math.sin)
  const particles = useMemo(() => {
    const defs = [
      { s: 2.4, d: 10.2, dl: -8.5, l: 12.3, t: 68.1, mo: 0.06, xo: 0.28, dx1: 15, dy1: -8, dx2: -12, dy2: 5, dx3: 8, dy3: -15 },
      { s: 2.7, d: 13.5, dl: -3.2, l: 45.6, t: 22.8, mo: 0.08, xo: 0.35, dx1: -18, dy1: 12, dx2: 6, dy2: -10, dx3: -5, dy3: 8 },
      { s: 2.1, d: 9.8, dl: -11.3, l: 78.2, t: 55.4, mo: 0.05, xo: 0.22, dx1: 10, dy1: 18, dx2: -8, dy2: -15, dx3: 12, dy3: 6 },
      { s: 2.8, d: 11.7, dl: -6.7, l: 33.9, t: 89.2, mo: 0.07, xo: 0.31, dx1: -5, dy1: -12, dx2: 18, dy2: 8, dx3: -10, dy3: 15 },
      { s: 2.2, d: 14.1, dl: -1.5, l: 67.4, t: 35.7, mo: 0.09, xo: 0.38, dx1: 8, dy1: 5, dx2: -15, dy2: -18, dx3: 3, dy3: -8 },
      { s: 2.5, d: 8.9, dl: -9.8, l: 91.1, t: 72.3, mo: 0.06, xo: 0.25, dx1: -12, dy1: 15, dx2: 5, dy2: -8, dx3: 18, dy3: -3 },
      { s: 2.3, d: 12.6, dl: -4.3, l: 18.7, t: 43.6, mo: 0.07, xo: 0.32, dx1: 16, dy1: -10, dx2: -3, dy2: 12, dx3: -8, dy3: 18 },
      { s: 2.6, d: 10.8, dl: -7.1, l: 55.2, t: 16.9, mo: 0.08, xo: 0.27, dx1: -8, dy1: 6, dx2: 12, dy2: -15, dx3: 5, dy3: -12 },
      { s: 2.0, d: 15.2, dl: -2.6, l: 82.5, t: 61.8, mo: 0.05, xo: 0.20, dx1: 10, dy1: -18, dx2: -6, dy2: 8, dx3: -15, dy3: 5 },
      { s: 2.9, d: 9.3, dl: -10.4, l: 27.3, t: 94.5, mo: 0.09, xo: 0.36, dx1: -15, dy1: 10, dx2: 8, dy2: -5, dx3: 12, dy3: -10 },
      { s: 2.1, d: 13.8, dl: -5.9, l: 60.8, t: 28.4, mo: 0.06, xo: 0.29, dx1: 5, dy1: 15, dx2: -18, dy2: 12, dx3: -3, dy3: 8 },
      { s: 2.4, d: 11.1, dl: -8.7, l: 95.2, t: 79.6, mo: 0.07, xo: 0.33, dx1: -10, dy1: -5, dx2: 15, dy2: -12, dx3: 8, dy3: 15 },
      { s: 2.7, d: 14.5, dl: -0.8, l: 41.6, t: 51.3, mo: 0.08, xo: 0.24, dx1: 18, dy1: -8, dx2: -5, dy2: 18, dx3: -12, dy3: -6 },
      { s: 2.3, d: 10.5, dl: -6.2, l: 73.9, t: 8.5, mo: 0.05, xo: 0.21, dx1: -3, dy1: 12, dx2: 10, dy2: -8, dx3: 15, dy3: -18 },
      { s: 2.5, d: 12.9, dl: -3.5, l: 8.4, t: 65.7, mo: 0.09, xo: 0.37, dx1: 12, dy1: -15, dx2: -10, dy2: 5, dx3: -8, dy3: 12 },
      { s: 2.0, d: 9.6, dl: -11.8, l: 48.7, t: 37.2, mo: 0.06, xo: 0.26, dx1: -18, dy1: 8, dx2: 3, dy2: 15, dx3: 10, dy3: -5 },
      { s: 2.8, d: 15.8, dl: -1.2, l: 86.3, t: 83.9, mo: 0.07, xo: 0.30, dx1: 6, dy1: -3, dx2: -15, dy2: -10, dx3: -5, dy3: 18 },
      { s: 2.2, d: 11.4, dl: -7.9, l: 22.1, t: 46.8, mo: 0.08, xo: 0.34, dx1: -5, dy1: 18, dx2: 12, dy2: -3, dx3: 8, dy3: -12 },
    ];
    return defs.map((p, i) => ({
      size: p.s, duration: p.d, delay: p.dl, left: p.l, top: p.t,
      minOpacity: p.mo, maxOpacity: p.xo,
      dx1: p.dx1, dy1: p.dy1, dx2: p.dx2, dy2: p.dy2, dx3: p.dx3, dy3: p.dy3,
      color: i % 3 === 0 ? 'rgba(201,100,66,0.15)' : i % 3 === 1 ? 'rgba(155,149,144,0.12)' : 'rgba(201,100,66,0.1)',
      key: `hp-${i}`
    }));
  }, []);

  if (!mounted) return null;

  return (
    <>
      {particles.map((p) => (
        <div
          key={p.key}
          className="header-particle"
          suppressHydrationWarning
          style={{
            width: `${p.size.toFixed(1)}px`,
            height: `${p.size.toFixed(1)}px`,
            left: `${p.left}%`,
            top: `${p.top}%`,
            backgroundColor: p.color,
            '--particle-duration': `${p.duration}s`,
            '--particle-delay': `${p.delay}s`,
            '--particle-min-opacity': `${p.minOpacity}`,
            '--particle-max-opacity': `${p.maxOpacity}`,
            '--particle-dx1': `${p.dx1}px`,
            '--particle-dy1': `${p.dy1}px`,
            '--particle-dx2': `${p.dx2}px`,
            '--particle-dy2': `${p.dy2}px`,
            '--particle-dx3': `${p.dx3}px`,
            '--particle-dy3': `${p.dy3}px`,
          } as React.CSSProperties}
        />
      ))}
    </>
  );
}

// ─── useTilt Hook ────────────────────────────────────────────────────────────

export function useTilt<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [tiltStyle, setTiltStyle] = useState<React.CSSProperties>({});
  const [shineStyle, setShineStyle] = useState<React.CSSProperties>({});
  const isTouchDevice = useRef(false);
  const styleRef = useRef<React.CSSProperties>({});
  const shineRef = useRef<React.CSSProperties>({});

  useEffect(() => {
    isTouchDevice.current = !window.matchMedia('(hover: hover)').matches;
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isTouchDevice.current || !ref.current) return;
    const el = ref.current;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const maxRotation = 3;
    const rotateX = ((y - centerY) / centerY) * -maxRotation;
    const rotateY = ((x - centerX) / centerX) * maxRotation;

    const newStyle: React.CSSProperties = {
      transform: `perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.01, 1.01, 1.01) translateY(-1px)`,
      transition: 'transform 150ms ease-out',
    };
    styleRef.current = newStyle;
    setTiltStyle(newStyle);

    const shineX = (x / rect.width) * 100;
    const shineY = (y / rect.height) * 100;
    const newShine: React.CSSProperties = {
      background: `radial-gradient(circle at ${shineX}% ${shineY}%, rgba(255,255,255,0.08) 0%, transparent 60%)`,
    };
    shineRef.current = newShine;
    setShineStyle(newShine);
  }, []);

  const handleMouseLeave = useCallback(() => {
    const newStyle: React.CSSProperties = {
      transform: 'perspective(600px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)',
      transition: 'transform 300ms ease-out, box-shadow 300ms ease',
    };
    styleRef.current = newStyle;
    setTiltStyle(newStyle);
    shineRef.current = {};
    setShineStyle({});
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || isTouchDevice.current) return;
    el.addEventListener('mousemove', handleMouseMove);
    el.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      el.removeEventListener('mousemove', handleMouseMove);
      el.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [handleMouseMove, handleMouseLeave]);

  return { ref, tiltStyle, shineStyle };
}

// ─── TiltCard Component ────────────────────────────────────────────────────

export function TiltCard({ children, className = '', style = {}, animationDelay }: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  animationDelay?: string;
}) {
  const { ref, tiltStyle, shineStyle } = useTilt<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`tilt-card relative hover:shadow-lg transition-shadow duration-200 ${className}`}
      style={{ ...tiltStyle, ...style, ...(animationDelay ? { animationDelay } : {}) }}
    >
      <div className="tilt-shine" style={shineStyle} />
      <div className="relative z-[1] h-full">{children}</div>
    </div>
  );
}

// ─── useTypewriter Hook ─────────────────────────────────────────────────────

export function useTypewriter(text: string, speed: number = 30) {
  const [displayedText, setDisplayedText] = useState('');
  const [isComplete, setIsComplete] = useState(false);
  const textRef = useRef(text);
  const indexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    textRef.current = text;
    indexRef.current = 0;

    function tick(idx: number) {
      if (idx === 0) {
        setDisplayedText('');
        setIsComplete(false);
      }
      const nextIdx = idx + 1;
      if (nextIdx <= textRef.current.length) {
        setDisplayedText(textRef.current.slice(0, nextIdx));
        indexRef.current = nextIdx;
        timerRef.current = setTimeout(() => tick(nextIdx), speed);
      } else {
        setIsComplete(true);
      }
    }

    timerRef.current = setTimeout(() => tick(0), 0);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [text, speed]);

  return { displayedText, isComplete };
}

// ─── TypewriterText Component ───────────────────────────────────────────────

export function TypewriterText({ text, speed = 30 }: { text: string; speed?: number }) {
  const { displayedText, isComplete } = useTypewriter(text, speed);
  return (
    <span>
      {displayedText}
      {!isComplete && <span className="typewriter-cursor" />}
    </span>
  );
}
