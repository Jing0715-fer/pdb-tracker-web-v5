'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface ScrollToTopProps {
  /** Ref to the scroll container to monitor and scroll */
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  /** Scroll threshold in px before showing the FAB (default: 300) */
  threshold?: number;
}

export function ScrollToTop({ scrollContainerRef, threshold = 300 }: ScrollToTopProps) {
  const [visible, setVisible] = useState(false);
  const [scrollPercent, setScrollPercent] = useState(0);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight - container.clientHeight;
      const percent = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
      setVisible(scrollTop > threshold);
      setScrollPercent(percent);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => container.removeEventListener('scroll', handleScroll);
  }, [scrollContainerRef, threshold]);

  const scrollToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: 0, behavior: 'smooth' });
  }, [scrollContainerRef]);

  // Determine color based on scroll position
  const accentColor = scrollPercent > 75 ? '#c96442' : scrollPercent > 40 ? '#c9872e' : '#2d8f8f';

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.6, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.6, y: 10 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          onClick={scrollToTop}
          className="fixed bottom-14 right-6 z-30 flex items-center justify-center w-10 h-10 rounded-full text-white shadow-lg hover:shadow-xl transition-shadow duration-200 claude-focus-ring group"
          style={{ 
            touchAction: 'manipulation',
            background: `linear-gradient(135deg, ${accentColor}, ${accentColor}dd)`,
          }}
          aria-label="Back to top"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="relative">
                <ChevronUp className="h-4 w-4" />
                {/* Scroll progress ring */}
                <svg
                  className="absolute inset-0 -m-1.5"
                  width="28"
                  height="28"
                  viewBox="0 0 28 28"
                  style={{ transform: 'rotate(-90deg)' }}
                >
                  <circle
                    cx="14" cy="14" r="12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-white/20"
                  />
                  <circle
                    cx="14" cy="14" r="12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray={`${2 * Math.PI * 12}`}
                    strokeDashoffset={`${2 * Math.PI * 12 * (1 - scrollPercent / 100)}`}
                    strokeLinecap="round"
                    className="text-white/70"
                  />
                </svg>
              </div>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>Back to top ({Math.round(scrollPercent)}%)</p>
            </TooltipContent>
          </Tooltip>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
