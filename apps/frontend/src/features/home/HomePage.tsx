import { consoleCriticalCopy, type ConsoleCopyAction } from '@agent-builder/contracts';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { featureFlags } from '../../config/feature-flags';

const homeCopy = consoleCriticalCopy.home;

const workspaceCards = [
  {
    key: 'registry',
    path: '/registry',
    kicker: 'REGISTRY & PLUGINS',
    title: 'Govern definitions and connections',
    icon: 'database',
    action: homeCopy.actions[2],
  },
  {
    key: 'runs',
    path: '/runs',
    kicker: 'RUNS & APPROVALS',
    title: 'See authority before execution',
    icon: 'shield',
    action: homeCopy.actions[3],
  },
  {
    key: 'evidence',
    path: '/evidence',
    kicker: 'EVIDENCE',
    title: 'Prove outcomes and compare change',
    icon: 'success',
    action: homeCopy.actions[4],
  },
  {
    key: 'incubator',
    path: '/incubator',
    kicker: 'INCUBATOR',
    title: 'Turn signals into reviewed improvements',
    icon: 'sparkles',
    action: homeCopy.actions[5],
  },
] as const;

interface WorkspaceCardProps {
  action: ConsoleCopyAction;
  icon: (typeof workspaceCards)[number]['icon'];
  kicker: string;
  path: string;
  title: string;
}

function ActionExplanation({ action }: { action: ConsoleCopyAction }) {
  return (
    <>
      <p>{action.consequence}</p>
      <small>{action.undo}</small>
    </>
  );
}

function AimTeaser() {
  return (
    <div aria-hidden="true" className="home-aim-teaser">
      <svg fill="none" viewBox="0 0 320 210">
        <path className="home-aim-axis" d="M24 105h272" />
        <path
          className="home-aim-outline"
          d="m34 105 38-26h63l25-39 25 39h62l39 26-39 26h-62l-25 39-25-39H72Z"
        />
        <path className="home-aim-outline" d="M135 79h50v52h-50z" />
        <path className="home-aim-detail" d="M72 79v52M247 79v52M160 40v130" />
        <circle className="home-aim-node" cx="72" cy="105" r="5" />
        <circle className="home-aim-node" cx="135" cy="105" r="5" />
        <circle className="home-aim-node" cx="185" cy="105" r="5" />
        <circle className="home-aim-node" cx="247" cy="105" r="5" />
      </svg>
      <span>SYNTHETIC CAPABILITY VEHICLE · NOT CAD</span>
    </div>
  );
}

function WorkspaceCard({ action, icon, kicker, path, title }: WorkspaceCardProps) {
  return (
    <article className="home-workspace-card">
      <Icon name={icon} size={22} />
      <div>
        <span>{kicker}</span>
        <h3>{title}</h3>
        <ActionExplanation action={action} />
      </div>
      <Link aria-label={`${action.label}: ${title}`} to={path}>
        {action.label} <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}

export function HomePage({ aimEnabled = featureFlags.aimEnabled }: { aimEnabled?: boolean }) {
  return (
    <main className="home-surface">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-copy">
          <span className="home-kicker">PAUL OS · GOVERNED AGENT PLATFORM</span>
          <h1 id="home-title">Build, run, prove, and improve governed work.</h1>
          <p>{homeCopy.introduction.join(' ')}</p>
          <div className="home-primary-control">
            <Link className="primary-button home-primary-action" to="/attention">
              {homeCopy.actions[0].label} <span aria-hidden="true">→</span>
            </Link>
            <div className="home-primary-explanation">
              <ActionExplanation action={homeCopy.actions[0]} />
            </div>
          </div>
          <ul aria-label="Platform operating principles" className="home-principles">
            <li>REUSE FIRST</li>
            <li>AUTHORITY BOUND</li>
            <li>EVIDENCE ATTACHED</li>
          </ul>
        </div>

        <aside className="home-priority" aria-labelledby="home-priority-title">
          <header>
            <span>CONTROLLED SURFACING</span>
            <h2 id="home-priority-title">One place for review</h2>
          </header>
          <div className="home-priority-state">
            <strong>Attention owns interruption.</strong>
            <p>{homeCopy.body?.[0]}</p>
            <small>{homeCopy.body?.[1]}</small>
            <div className="home-attention-rule" aria-hidden="true">
              <span>DECISIONS</span>
              <span>DEGRADED WORK</span>
              <span>ONE QUEUE</span>
            </div>
          </div>
        </aside>
      </section>

      <section className="home-feature-section" aria-labelledby="home-capabilities-title">
        <header className="home-section-heading">
          <div>
            <span>START HERE</span>
            <h2 id="home-capabilities-title">
              {aimEnabled ? 'Two ways into the system' : 'Start with reusable capability'}
            </h2>
          </div>
          <p>
            {aimEnabled
              ? 'Create governed capability, or inspect how capability becomes one program.'
              : 'Find a certified match before creating something new.'}
          </p>
        </header>
        <div className={aimEnabled ? 'home-feature-grid' : 'home-feature-grid single'}>
          <article className="home-feature-card home-builder-card">
            <div className="home-feature-number">01</div>
            <div className="home-feature-copy">
              <span>AGENT BUILDER</span>
              <h3>Reuse a certified agent before creating another.</h3>
              <ActionExplanation action={homeCopy.actions[1]} />
            </div>
            <Link to="/build">
              {homeCopy.actions[1].label} <span aria-hidden="true">→</span>
            </Link>
          </article>
          {aimEnabled ? (
            <article className="home-feature-card home-aim-card">
              <AimTeaser />
              <div className="home-feature-copy">
                <span>AIM · MANUFACTURING CAPABILITY MAP</span>
                <h3>See evidence-gated capabilities assemble into one system.</h3>
                <ActionExplanation action={homeCopy.actions[6]} />
              </div>
              <Link to="/aim">
                {homeCopy.actions[6].label} <span aria-hidden="true">→</span>
              </Link>
            </article>
          ) : null}
        </div>
      </section>

      <section className="home-workspace-section" aria-labelledby="home-workspaces-title">
        <header className="home-section-heading">
          <div>
            <span>OPERATING LOOP</span>
            <h2 id="home-workspaces-title">Govern the whole lifecycle</h2>
          </div>
          <p>{homeCopy.body?.join(' ')}</p>
        </header>
        <div className="home-workspace-grid">
          {workspaceCards.map((card) => (
            <WorkspaceCard {...card} key={card.key} />
          ))}
        </div>
      </section>
    </main>
  );
}
