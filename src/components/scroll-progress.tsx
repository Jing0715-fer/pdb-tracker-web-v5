'use client';

import React, { useState, useEffect } from 'react';
import { motion, useSpring } from 'framer-motion';
import type { Mode } from '@/lib/pdb-types';

interface ScrollProgressProps {
  mode: Mode;
}

const MODE_COLORS: Record<Mode, string> = {
  weekly: '#2d8f8f',
  evaluation: '#7c5cbf',
  literature: '#c9872e',
};

export function ScrollProgress({ mode }: ScrollProgressProps) {
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  const springProgress = useSpring(0, {
    stiffness: 300,
    damping: 30,
  });

  useEffect(() => {
    const unsubscribe = springProgress.on('change', (v) => {
      setProgress(v);
    });
    return unsubscribe;
  }, [springProgress]);

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;

      if (scrollHeight <= 0) {
        springProgress.set(0);
        setVisible(false);
        return;
      }

      const pct = (scrollTop / scrollHeight) * 100;
      springProgress.set(pct);
      setVisible(scrollTop > 10);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial check

    return () => window.removeEventListener('scroll', handleScroll);
  }, [springProgress]);

  const color = MODE_COLORS[mode];

  return (
    <motion.div
      className="fixed top-0 left-0 right-0 z-[60] h-[3px]"
      style={{ opacity: visible ? 1 : 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="h-full origin-left"
        style={{
          width: `${progress}%`,
          background: `linear-gradient(90deg, ${color}80, ${color})`,
          boxShadow: `0 0 8px ${color}40`,
        }}
        transition={{ duration: 0 }}
      />
    </motion.div>
  );
}
