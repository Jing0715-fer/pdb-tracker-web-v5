'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * useFocusTrap
 *
 * Traps keyboard focus within a container element.
 * Useful for modals, dropdowns, and other overlay components.
 *
 * Features:
 *   - Tab/Shift+Tab cycles focus within the container
 *   - Escape key calls onEscape callback
 *   - Focus is restored to the container on mount
 *   - Focus is restored to the previous element on unmount
 *
 * Usage:
 *   const ref = useRef<HTMLDivElement>(null);
 *   useFocusTrap(ref, () => onClose());
 *   return <div ref={ref}>...modal content...</div>;
 */

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  onEscape?: () => void,
  isActive: boolean = true
) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    // Store the previously focused element
    previousFocusRef.current = document.activeElement as HTMLElement;

    const container = containerRef.current;

    // Focus the container or first focusable element
    const focusableElements = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    } else {
      container.setAttribute('tabindex', '-1');
      container.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onEscape) {
        e.preventDefault();
        onEscape();
        return;
      }

      if (e.key === 'Tab') {
        const currentFocusable = container.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        if (currentFocusable.length === 0) return;

        const first = currentFocusable[0];
        const last = currentFocusable[currentFocusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus to the previously focused element
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
      }
    };
  }, [containerRef, onEscape, isActive]);
}

/**
 * useAriaLive
 *
 * Announces messages to screen readers via an aria-live region.
 * Returns a function to announce messages.
 *
 * Usage:
 *   const announce = useAriaLive();
 *   announce('3 structures selected');
 */

export function useAriaLive() {
  const announce = (message: string) => {
    if (typeof document === 'undefined') return;
    let liveRegion = document.getElementById('aria-live-region');
    if (!liveRegion) {
      liveRegion = document.createElement('div');
      liveRegion.id = 'aria-live-region';
      liveRegion.setAttribute('aria-live', 'polite');
      liveRegion.setAttribute('aria-atomic', 'true');
      liveRegion.setAttribute('class', 'sr-only');
      document.body.appendChild(liveRegion);
    }
    liveRegion.textContent = message;
  };

  return announce;
}
