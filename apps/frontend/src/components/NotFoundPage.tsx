import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="not-found-page">
      <p className="page-kicker">ROUTE NOT FOUND</p>
      <h1>That instrument panel does not exist.</h1>
      <p>Return to the governed builder or browse the agent catalog.</p>
      <div className="not-found-actions">
        <Link className="primary-button" to="/build">
          Open builder
        </Link>
        <Link className="secondary-button" to="/library">
          Browse library
        </Link>
      </div>
    </main>
  );
}
