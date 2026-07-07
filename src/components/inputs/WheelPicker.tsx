import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

export interface WheelOption {
  value: number;
  label: string;
}

const ITEM_HEIGHT = 36;

// Show fewer rows on phone-class screens so the whole calculator tile fits
// without scrolling. Must stay odd so one row sits in the centre band.
const PHONE = '(max-width: 430px)';

function useVisibleRows() {
  const canMatch = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [rows, setRows] = useState(() => (canMatch && window.matchMedia(PHONE).matches ? 3 : 5));
  useEffect(() => {
    if (!canMatch) return;
    const mq = window.matchMedia(PHONE);
    const apply = () => setRows(mq.matches ? 3 : 5);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [canMatch]);
  return rows;
}

/**
 * An iOS-alarm-style drum picker. Scroll / drag / arrow-key to spin; the value
 * in the centre band is selected. Values are numbers (heights or positions).
 */
export function WheelPicker({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: WheelOption[];
  value: number;
  onChange: (value: number) => void;
  ariaLabel?: string;
}) {
  const VISIBLE = useVisibleRows();
  const scrollRef = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>();
  // True while we are scrolling programmatically to reflect an external value
  // change; a settle triggered by that scroll must not emit a spurious onChange.
  const programmatic = useRef(false);
  const pad = Math.floor(VISIBLE / 2) * ITEM_HEIGHT;

  // Latest props for the native (non-passive) wheel listener, which is attached
  // once and would otherwise close over stale values.
  const stateRef = useRef({ options, value, onChange });
  stateRef.current = { options, value, onChange };

  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  // Move the selection by one step (clamped), for wheel and keyboard.
  function step(dir: 1 | -1) {
    const s = stateRef.current;
    const i = Math.max(0, s.options.findIndex((o) => o.value === s.value));
    const ni = Math.min(s.options.length - 1, Math.max(0, i + dir));
    const next = s.options[ni]?.value;
    if (next !== undefined && next !== s.value) s.onChange(next);
  }

  // Intercept mouse-wheel / trackpad scrolling so one notch moves exactly one
  // item (native scroll + snap jumps several). Needs a non-passive listener to
  // call preventDefault, so it is attached imperatively rather than via onWheel.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let last = 0;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      if (e.timeStamp - last < 45) return; // throttle so trackpads don't fly
      last = e.timeStamp;
      step(e.deltaY > 0 ? 1 : -1);
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the scroll position aligned with the selected value, including when the
  // value changes externally (e.g. a gender switch resets the height).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = index * ITEM_HEIGHT;
    if (Math.abs(el.scrollTop - target) > 1) {
      programmatic.current = true;
      el.scrollTop = target;
    }
  }, [index, VISIBLE]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      if (programmatic.current) {
        programmatic.current = false;
        return;
      }
      const i = Math.min(
        options.length - 1,
        Math.max(0, Math.round(el.scrollTop / ITEM_HEIGHT)),
      );
      const next = options[i]?.value;
      if (next !== undefined && next !== value) onChange(next);
    }, 80);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      step(1);
    }
  }

  return (
    <div className="wheel" style={{ height: ITEM_HEIGHT * VISIBLE }}>
      <div
        className="wheel-center"
        aria-hidden
        style={{ top: pad, height: ITEM_HEIGHT }}
      />
      <div
        className="wheel-scroll"
        ref={scrollRef}
        role="listbox"
        aria-label={ariaLabel}
        tabIndex={0}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
      >
        <div style={{ height: pad }} aria-hidden />
        {options.map((o, i) => (
          <div
            key={o.value}
            role="option"
            aria-selected={i === index}
            className={'wheel-item' + (i === index ? ' selected' : '')}
            style={{ height: ITEM_HEIGHT }}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </div>
        ))}
        <div style={{ height: pad }} aria-hidden />
      </div>
    </div>
  );
}
