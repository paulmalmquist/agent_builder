interface InputModeToggleProps {
  mode: 'guided' | 'single-shot';
  onChange: (mode: 'guided' | 'single-shot') => void;
}

export function InputModeToggle({ mode, onChange }: InputModeToggleProps) {
  return (
    <div className="workflow-mode-header">
      <span>SPECIFICATION INPUT</span>
      <div aria-label="Specification input mode" className="mode-toggle" role="group">
        <button aria-pressed={mode === 'guided'} onClick={() => onChange('guided')} type="button">
          Guided
        </button>
        <button
          aria-pressed={mode === 'single-shot'}
          onClick={() => onChange('single-shot')}
          type="button"
        >
          Single-shot
        </button>
      </div>
    </div>
  );
}
