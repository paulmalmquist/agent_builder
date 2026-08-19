import { Icon } from './Icon';
import { WorkflowDraftingMark, type WorkflowDraftingMarkName } from './WorkflowDraftingMark';

export type WorkflowStepId = 1 | 2 | 3 | 4;

interface WorkflowStepProps {
  step: WorkflowStepId;
  title: string;
  description: string;
  mark: WorkflowDraftingMarkName;
  complete: boolean;
  locked: boolean;
  lockedByStep: WorkflowStepId | null;
  active: boolean;
  nextActionable: boolean;
  justUnlocked: boolean;
  justCompleted: boolean;
  onOpen: (step: WorkflowStepId) => void;
  onMotionEnd: (step: WorkflowStepId, motion: 'unlock' | 'complete') => void;
}

export function WorkflowStep({
  step,
  title,
  description,
  mark,
  complete,
  locked,
  lockedByStep,
  active,
  nextActionable,
  justUnlocked,
  justCompleted,
  onOpen,
  onMotionEnd,
}: WorkflowStepProps) {
  const number = String(step).padStart(2, '0');
  const lockedByNumber = lockedByStep ? String(lockedByStep).padStart(2, '0') : null;
  const descriptionId = `step-${step}-description`;
  const lockDescriptionId = `step-${step}-lock-description`;

  return (
    <div
      className="workflow-row"
      data-just-completed={justCompleted ? 'true' : undefined}
      data-just-unlocked={justUnlocked ? 'true' : undefined}
      data-locked={locked ? 'true' : 'false'}
      data-next-actionable={nextActionable ? 'true' : 'false'}
      onAnimationEnd={(event) => {
        if (event.animationName === 'workflow-unlock-flare') {
          onMotionEnd(step, 'unlock');
        }
        if (event.animationName === 'workflow-check-stamp') {
          onMotionEnd(step, 'complete');
        }
      }}
    >
      <button
        aria-disabled={locked}
        aria-label={`Open step ${number}: ${title}`}
        className={`step-number ${complete ? 'done' : ''}`}
        onClick={() => onOpen(step)}
        type="button"
      >
        {complete ? <Icon name="check" size={32} /> : number}
      </button>
      <button
        aria-describedby={`${descriptionId}${locked ? ` ${lockDescriptionId}` : ''}`}
        aria-disabled={locked}
        className="step-card"
        data-active={active ? 'true' : 'false'}
        onClick={() => onOpen(step)}
        type="button"
      >
        <span className="step-icon">
          <WorkflowDraftingMark name={mark} />
        </span>
        <span className="step-copy">
          <strong>
            {complete ? 'Configured · ' : ''}
            {title}
          </strong>
          <span id={descriptionId}>{description}</span>
          {locked && lockedByNumber ? (
            <span className="step-lock-label" id={lockDescriptionId}>
              LOCKED · COMPLETE STEP {lockedByNumber} FIRST
            </span>
          ) : null}
        </span>
        <Icon name="arrow" size={31} />
      </button>
    </div>
  );
}
