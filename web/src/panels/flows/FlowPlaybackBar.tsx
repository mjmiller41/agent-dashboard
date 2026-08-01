// Transport bar for flow run playback (PLAN.md §8 item 9: "play/pause/scrub/speed"). Pure
// controlled UI over `useFlowPlayback`'s state — no state of its own, aside from the run picker
// selection it's handed via props (owned by FlowCanvas, since changing the selected run also
// resets the playback clock).
import type { FlowRun } from '@agent-dashboard/shared';
import type { FlowPlaybackState } from './useFlowPlayback';

export interface FlowPlaybackBarProps {
  runs: FlowRun[];
  selectedRunIndex: number;
  onSelectRun: (index: number) => void;
  playback: FlowPlaybackState;
}

const SPEEDS = [1, 2, 4];
// 10s per step: coarse enough for a small number of keyboard presses (Home/End + arrow keys) to
// reach a specific scrub position deterministically, fine-grained enough to distinguish the
// individual step transitions in the shipped example flows' runs (which span minutes).
const SCRUB_STEP_MS = 10_000;

export function FlowPlaybackBar({ runs, selectedRunIndex, onSelectRun, playback }: FlowPlaybackBarProps) {
  const { scrubMs, startMs, endMs, playing, speed, setScrubMs, play, pause, setSpeed } = playback;
  const disabled = startMs >= endMs;

  return (
    // The scrub <input>'s own DOM `value` is snapped to `step` by the browser's range-input
    // value-sanitization algorithm (applies even to programmatic sets, not just user drags), so
    // it under-represents the *actual* scrub position between step boundaries. `data-scrub-ms`
    // exposes the real, unquantized value directly — same "not just visually, in the DOM" reasoning
    // as FlowStepNode's `data-status` attribute.
    <div className="flow-playback" data-scrub-ms={Math.round(scrubMs)}>
      <label className="flow-playback__field">
        Run
        <select
          className="flow-playback__run-select"
          value={selectedRunIndex}
          onChange={(event) => onSelectRun(Number(event.target.value))}
        >
          {runs.map((run, index) => (
            <option key={run.startedAt} value={index}>
              {new Date(run.startedAt).toLocaleString()}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="flow-playback__play-button"
        disabled={disabled}
        onClick={() => (playing ? pause() : play())}
      >
        {playing ? 'Pause' : 'Play'}
      </button>

      <label className="flow-playback__field flow-playback__field--scrub">
        Scrub
        <input
          type="range"
          className="flow-playback__scrub-input"
          aria-label="Playback scrub position"
          min={startMs}
          max={endMs}
          step={SCRUB_STEP_MS}
          value={scrubMs}
          disabled={disabled}
          onChange={(event) => setScrubMs(Number(event.target.value))}
        />
      </label>
      <span className="flow-playback__time">{new Date(scrubMs).toLocaleTimeString()}</span>

      <label className="flow-playback__field">
        Speed
        <select
          className="flow-playback__speed-select"
          value={speed}
          onChange={(event) => setSpeed(Number(event.target.value))}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
