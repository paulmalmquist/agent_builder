import { useId, useState, type FormEvent } from 'react';
import { outcomesSectionSchema, type OutcomesSection } from '@agent-builder/contracts';
import { Modal } from '../../components/Modal';
import { Notice } from '../../components/Notice';
import { issueSummary, lines } from './form-utils';
import { UnresolvedReview } from './UnresolvedReview';
import {
  hasUnresolvedAnswers,
  type InterpretationResolutionById,
  type InterpretationResolutionChange,
  type InterpretationUnresolvedItem,
} from './unresolved-review-utils';

interface ScopeFormProps {
  initialValue: OutcomesSection | null;
  isSaving: boolean;
  submitLabel: string;
  unresolvedItems?: InterpretationUnresolvedItem[];
  resolutions?: InterpretationResolutionById;
  onResolutionChange?: InterpretationResolutionChange;
  onClose: () => void;
  onSubmit: (value: OutcomesSection) => void;
}

const defaultValue: OutcomesSection = {
  name: '',
  department: '',
  purpose: '',
  audience: '',
  desiredOutcomes: [''],
  humanBaseline: null,
  exclusions: [],
};

export function ScopeForm({
  initialValue,
  isSaving,
  submitLabel,
  unresolvedItems = [],
  resolutions = {},
  onResolutionChange = () => undefined,
  onClose,
  onSubmit,
}: ScopeFormProps) {
  const fieldPrefix = useId();
  const value = initialValue ?? defaultValue;
  const [name, setName] = useState(value.name);
  const [department, setDepartment] = useState(value.department);
  const [purpose, setPurpose] = useState(value.purpose);
  const [audience, setAudience] = useState(value.audience);
  const [desiredOutcomes, setDesiredOutcomes] = useState(value.desiredOutcomes.join('\n'));
  const [humanBaseline, setHumanBaseline] = useState(value.humanBaseline ?? '');
  const [exclusions, setExclusions] = useState(value.exclusions.join('\n'));
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = outcomesSectionSchema.safeParse({
      name,
      department,
      purpose,
      audience,
      desiredOutcomes: lines(desiredOutcomes),
      humanBaseline: humanBaseline.trim() || null,
      exclusions: lines(exclusions),
    });
    if (!result.success) {
      setError(issueSummary(result.error.issues));
      return;
    }
    setError(null);
    onSubmit(result.data);
  }

  return (
    <Modal kicker="Step 01" onClose={onClose} size="wide" title="Define scope & purpose">
      <p>
        Describe the job before choosing an implementation. We’ll compare it with governed agents
        already in the catalog.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form className="form-grid" noValidate onSubmit={handleSubmit}>
        <div className="full-field">
          <UnresolvedReview
            items={unresolvedItems}
            onChange={onResolutionChange}
            resolutions={resolutions}
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${fieldPrefix}-name`}>Agent name</label>
          <input
            autoComplete="off"
            id={`${fieldPrefix}-name`}
            onChange={(event) => setName(event.target.value)}
            placeholder="Supplier continuity analyst"
            value={name}
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${fieldPrefix}-department`}>Department</label>
          <input
            autoComplete="organization"
            id={`${fieldPrefix}-department`}
            onChange={(event) => setDepartment(event.target.value)}
            placeholder="Manufacturing Operations"
            value={department}
          />
        </div>
        <div className="form-field full-field">
          <label htmlFor={`${fieldPrefix}-purpose`}>Job to be done</label>
          <textarea
            aria-describedby={`${fieldPrefix}-purpose-help`}
            id={`${fieldPrefix}-purpose`}
            onChange={(event) => setPurpose(event.target.value)}
            placeholder="Monitor supplier delays, connect them to affected builds, and prepare an evidence-backed escalation brief."
            value={purpose}
          />
          <small id={`${fieldPrefix}-purpose-help`}>
            Include the inputs, decision, and expected action.
          </small>
        </div>
        <div className="form-field full-field">
          <label htmlFor={`${fieldPrefix}-audience`}>Primary users</label>
          <input
            id={`${fieldPrefix}-audience`}
            onChange={(event) => setAudience(event.target.value)}
            placeholder="Supply planners and program managers"
            value={audience}
          />
        </div>
        <div className="form-field full-field">
          <label htmlFor={`${fieldPrefix}-outcomes`}>Desired outcomes</label>
          <textarea
            aria-describedby={`${fieldPrefix}-outcomes-help`}
            id={`${fieldPrefix}-outcomes`}
            onChange={(event) => setDesiredOutcomes(event.target.value)}
            placeholder={'Identify at-risk builds\nDraft a traceable escalation brief'}
            value={desiredOutcomes}
          />
          <small id={`${fieldPrefix}-outcomes-help`}>One measurable outcome per line.</small>
        </div>
        <div className="form-field">
          <label htmlFor={`${fieldPrefix}-baseline`}>Current human baseline</label>
          <textarea
            id={`${fieldPrefix}-baseline`}
            onChange={(event) => setHumanBaseline(event.target.value)}
            placeholder="A planner reconciles three reports in 45 minutes."
            value={humanBaseline}
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${fieldPrefix}-exclusions`}>Explicitly out of scope</label>
          <textarea
            aria-describedby={`${fieldPrefix}-exclusions-help`}
            id={`${fieldPrefix}-exclusions`}
            onChange={(event) => setExclusions(event.target.value)}
            placeholder={'Changing purchase orders\nContacting suppliers directly'}
            value={exclusions}
          />
          <small id={`${fieldPrefix}-exclusions-help`}>One exclusion per line.</small>
        </div>
        <div className="modal-actions full-field">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={isSaving || !hasUnresolvedAnswers(unresolvedItems, resolutions)}
            type="submit"
          >
            {isSaving ? 'Working…' : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
