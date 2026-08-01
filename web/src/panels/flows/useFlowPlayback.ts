// Playback clock for one flow run (PLAN.md §8 item 9: "a transport bar
// (play/pause/scrub/speed) that replays events by timestamp"). Pure timing
// state — no rendering, no knowledge of nodes/edges/statuses; FlowCanvas
// feeds `scrubMs` into effectiveStatus.ts's `effectiveStepStatusAt`. Uses a
// real requestAnimationFrame loop (not setInterval) for smooth per-frame
// advancement, with the loop torn down (cancelAnimationFrame) whenever
// `playing` flips false or the component unmounts — no leaked timers.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FlowRun } from '@agent-dashboard/shared';

export interface FlowPlaybackState {
  /** Epoch ms of the run's startedAt — the scrub range's minimum (PLAN.md §8 item 9). */
  startMs: number;
  /** Epoch ms of the run's latest event's `at` — the scrub range's maximum. */
  endMs: number;
  /** Current scrub position, epoch ms, always within [startMs, endMs]. */
  scrubMs: number;
  playing: boolean;
  /** Playback speed multiplier (1/2/4, PLAN.md §8 item 9's "speed"). */
  speed: number;
  /** Manually move the scrub position (e.g. dragging the slider) — pauses playback. */
  setScrubMs: (ms: number) => void;
  /** Start playback from the current scrub position, restarting from the beginning if already
   *  at (or past) the end. */
  play: () => void;
  pause: () => void;
  setSpeed: (speed: number) => void;
}

export function useFlowPlayback(run: FlowRun | undefined): FlowPlaybackState {
  const startMs = run ? Date.parse(run.startedAt) : 0;
  const endMs = useMemo(() => {
    if (!run) return startMs;
    let max = startMs;
    for (const event of run.events) {
      const at = Date.parse(event.at);
      if (at > max) max = at;
    }
    return max;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `run` (object identity) is the real dep; startMs is derived from it
  }, [run]);

  const [scrubMs, setScrubMsState] = useState(endMs);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);

  // A different run was selected (via the run picker, or a different flow entirely): snap back
  // to the end (the pre-existing "final state" default from the static part-3 display) and stop
  // any in-flight playback. This is React's documented "adjust state during render when a prop
  // changes" pattern (react.dev), not an effect — an effect that synchronously calls setState on
  // every run change is exactly what react-hooks/set-state-in-effect flags, since this is pure
  // derived-state adjustment, not synchronizing with an external system.
  const runKey = run?.startedAt ?? null;
  const [trackedRunKey, setTrackedRunKey] = useState(runKey);
  if (runKey !== trackedRunKey) {
    setTrackedRunKey(runKey);
    setScrubMsState(endMs);
    setPlaying(false);
  }

  useEffect(() => {
    if (!playing) {
      lastFrameRef.current = null;
      return;
    }

    function frame(ts: number): void {
      if (lastFrameRef.current === null) {
        // First frame after (re)starting: just calibrate the clock, don't advance yet (avoids a
        // large synthetic dt from time elapsed before playback started).
        lastFrameRef.current = ts;
        rafRef.current = requestAnimationFrame(frame);
        return;
      }
      const dtMs = ts - lastFrameRef.current;
      lastFrameRef.current = ts;

      let reachedEnd = false;
      setScrubMsState((prev) => {
        const next = Math.min(endMs, prev + dtMs * speed);
        if (next >= endMs) reachedEnd = true;
        return next;
      });
      if (reachedEnd) {
        setPlaying(false);
        return; // reached the end — stop automatically, don't schedule another frame
      }
      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastFrameRef.current = null;
    };
  }, [playing, speed, endMs]);

  const play = useCallback(() => {
    setScrubMsState((prev) => (prev >= endMs ? startMs : prev));
    setPlaying(true);
  }, [startMs, endMs]);

  const pause = useCallback(() => setPlaying(false), []);

  const setScrubMs = useCallback(
    (ms: number) => {
      setPlaying(false);
      setScrubMsState(Math.max(startMs, Math.min(endMs, ms)));
    },
    [startMs, endMs],
  );

  return { startMs, endMs, scrubMs, playing, speed, setScrubMs, play, pause, setSpeed };
}
