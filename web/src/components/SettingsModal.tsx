// Minimal theme settings modal (PLAN.md §7). Not polished — Phase 6 is
// "polish" — this just proves preset + accent round-trip through config.json.
import type { Theme, ThemePreset } from '@agent-dashboard/shared';

const PRESETS: ThemePreset[] = ['dark', 'light', 'midnight', 'terminal-green'];
const DEFAULT_ACCENT = '#7c5cff';
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export interface SettingsModalProps {
  theme: Theme;
  onChange: (theme: Theme) => void;
  onClose: () => void;
}

export function SettingsModal({ theme, onChange, onClose }: SettingsModalProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(event) => event.stopPropagation()}>
        <h2>Theme</h2>
        <div className="settings-modal__presets">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={preset === theme.preset ? 'preset-swatch preset-swatch--active' : 'preset-swatch'}
              onClick={() => onChange({ ...theme, preset })}
            >
              {preset}
            </button>
          ))}
        </div>
        <label className="settings-modal__accent">
          Accent color
          <input
            type="color"
            value={HEX_COLOR_RE.test(theme.accent) ? theme.accent : DEFAULT_ACCENT}
            onChange={(event) => onChange({ ...theme, accent: event.target.value })}
          />
        </label>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
