import { useState, type FormEvent } from 'react';
import { outputsSectionSchema, type OutputsSection } from '@agent-builder/contracts';
import { Modal } from '../../components/Modal';
import { Notice } from '../../components/Notice';
import { issueSummary, parseJson } from './form-utils';
import { UnresolvedReview } from './UnresolvedReview';
import {
  hasUnresolvedAnswers,
  type InterpretationResolutionById,
  type InterpretationResolutionChange,
  type InterpretationUnresolvedItem,
} from './unresolved-review-utils';

interface OutputsFormProps {
  initialValue: OutputsSection | null;
  isSaving: boolean;
  unresolvedItems?: InterpretationUnresolvedItem[];
  resolutions?: InterpretationResolutionById;
  onResolutionChange?: InterpretationResolutionChange;
  onClose: () => void;
  onSubmit: (value: OutputsSection) => void;
}

type MetricDraft = {
  id: number;
  name: string;
  operator: OutputsSection['successMetrics'][number]['operator'];
  threshold: string;
  unit: string;
};

type TestDraft = {
  id: number;
  name: string;
  input: string;
  expectedResult: string;
};

let nextRowId = 1;
const rowId = () => nextRowId++;

function initialMetrics(value: OutputsSection | null): MetricDraft[] {
  const values = value?.successMetrics ?? [
    { name: 'Evidence coverage', operator: 'gte' as const, threshold: 0.9, unit: 'ratio' },
  ];
  return values.map((metric) => ({
    id: rowId(),
    name: metric.name,
    operator: metric.operator,
    threshold: String(metric.threshold),
    unit: metric.unit ?? '',
  }));
}

function initialTests(value: OutputsSection | null): TestDraft[] {
  const values = value?.acceptanceTests ?? [
    {
      name: 'Produces a governed answer',
      input: { request: 'Summarize the highest-priority case' },
      expectedResult: { includesCitations: true },
    },
  ];
  return values.map((test) => ({
    id: rowId(),
    name: test.name,
    input: JSON.stringify(test.input, null, 2),
    expectedResult: JSON.stringify(test.expectedResult, null, 2),
  }));
}

export function OutputsForm({
  initialValue,
  isSaving,
  unresolvedItems = [],
  resolutions = {},
  onResolutionChange = () => undefined,
  onClose,
  onSubmit,
}: OutputsFormProps) {
  const [outputType, setOutputType] = useState<OutputsSection['outputType']>(
    initialValue?.outputType ?? 'investigation_report',
  );
  const [outputSchema, setOutputSchema] = useState(
    JSON.stringify(
      initialValue?.outputSchema ?? {
        type: 'object',
        required: ['summary', 'citations'],
        properties: {
          summary: { type: 'string' },
          citations: { type: 'array' },
        },
      },
      null,
      2,
    ),
  );
  const [metrics, setMetrics] = useState(() => initialMetrics(initialValue));
  const [tests, setTests] = useState(() => initialTests(initialValue));
  const [error, setError] = useState<string | null>(null);

  function updateMetric(id: number, update: Partial<MetricDraft>) {
    setMetrics((current) =>
      current.map((metric) => (metric.id === id ? { ...metric, ...update } : metric)),
    );
  }

  function updateTest(id: number, update: Partial<TestDraft>) {
    setTests((current) => current.map((test) => (test.id === id ? { ...test, ...update } : test)));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = outputsSectionSchema.safeParse({
        outputType,
        outputSchema: parseJson(outputSchema),
        successMetrics: metrics.map(({ name, operator, threshold, unit }) => ({
          name,
          operator,
          threshold: Number(threshold),
          unit: unit.trim() || null,
        })),
        acceptanceTests: tests.map(({ name, input, expectedResult }) => ({
          name,
          input: parseJson(input),
          expectedResult: parseJson(expectedResult),
        })),
      });
      if (!result.success) {
        setError(issueSummary(result.error.issues));
        return;
      }
      setError(null);
      onSubmit(result.data);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Enter valid JSON.');
    }
  }

  return (
    <Modal kicker="Step 04" onClose={onClose} size="wide" title="Define success criteria">
      <p>
        Make the output machine-checkable, then define measurable thresholds and acceptance cases.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form className="stack-form" onSubmit={handleSubmit}>
        <UnresolvedReview
          items={unresolvedItems}
          onChange={onResolutionChange}
          resolutions={resolutions}
        />
        <div className="form-grid">
          <label>
            Output type
            <select
              onChange={(event) =>
                setOutputType(event.target.value as OutputsSection['outputType'])
              }
              value={outputType}
            >
              <option value="investigation_report">Investigation report</option>
              <option value="decision_brief">Decision brief</option>
              <option value="dashboard_update">Dashboard update</option>
              <option value="ticket">Ticket</option>
              <option value="email_draft">Email draft</option>
              <option value="api_response">API response</option>
              <option value="structured_record">Structured record</option>
            </select>
          </label>
          <label>
            JSON output schema
            <textarea
              className="code-input"
              onChange={(event) => setOutputSchema(event.target.value)}
              spellCheck={false}
              value={outputSchema}
            />
          </label>
        </div>

        <fieldset className="repeat-section">
          <legend>Success metrics</legend>
          {metrics.map((metric) => (
            <div className="metric-row" key={metric.id}>
              <label>
                Metric
                <input
                  onChange={(event) => updateMetric(metric.id, { name: event.target.value })}
                  value={metric.name}
                />
              </label>
              <label>
                Operator
                <select
                  onChange={(event) =>
                    updateMetric(metric.id, {
                      operator: event.target.value as MetricDraft['operator'],
                    })
                  }
                  value={metric.operator}
                >
                  <option value="gte">At least</option>
                  <option value="lte">At most</option>
                  <option value="eq">Exactly</option>
                </select>
              </label>
              <label>
                Threshold
                <input
                  inputMode="decimal"
                  onChange={(event) => updateMetric(metric.id, { threshold: event.target.value })}
                  type="number"
                  value={metric.threshold}
                />
              </label>
              <label>
                Unit
                <input
                  onChange={(event) => updateMetric(metric.id, { unit: event.target.value })}
                  value={metric.unit}
                />
              </label>
              <button
                aria-label={`Remove ${metric.name || 'metric'}`}
                className="remove-row"
                disabled={metrics.length === 1}
                onClick={() =>
                  setMetrics((current) => current.filter((item) => item.id !== metric.id))
                }
                type="button"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            className="secondary-button add-row"
            onClick={() =>
              setMetrics((current) => [
                ...current,
                {
                  id: rowId(),
                  name: '',
                  operator: 'gte',
                  threshold: '',
                  unit: '',
                },
              ])
            }
            type="button"
          >
            Add metric
          </button>
        </fieldset>

        <fieldset className="repeat-section">
          <legend>Acceptance tests</legend>
          {tests.map((test) => (
            <div className="test-row" key={test.id}>
              <label>
                Test name
                <input
                  onChange={(event) => updateTest(test.id, { name: event.target.value })}
                  value={test.name}
                />
              </label>
              <label>
                JSON input
                <textarea
                  className="code-input compact"
                  onChange={(event) => updateTest(test.id, { input: event.target.value })}
                  spellCheck={false}
                  value={test.input}
                />
              </label>
              <label>
                Expected JSON
                <textarea
                  className="code-input compact"
                  onChange={(event) => updateTest(test.id, { expectedResult: event.target.value })}
                  spellCheck={false}
                  value={test.expectedResult}
                />
              </label>
              <button
                aria-label={`Remove ${test.name || 'acceptance test'}`}
                className="remove-row"
                disabled={tests.length === 1}
                onClick={() => setTests((current) => current.filter((item) => item.id !== test.id))}
                type="button"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            className="secondary-button add-row"
            onClick={() =>
              setTests((current) => [
                ...current,
                {
                  id: rowId(),
                  name: '',
                  input: '{}',
                  expectedResult: '{}',
                },
              ])
            }
            type="button"
          >
            Add acceptance test
          </button>
        </fieldset>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={isSaving || !hasUnresolvedAnswers(unresolvedItems, resolutions)}
            type="submit"
          >
            {isSaving ? 'Saving…' : 'Save success criteria'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
