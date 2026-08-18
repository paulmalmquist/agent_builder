import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="not-found-page">
      <p className="page-kicker">ROUTE NOT FOUND</p>
      <h1>That instrument panel does not exist.</h1>
      <p>Return to Paul OS home or browse the governed agent catalog.</p>
      <div className="not-found-actions">
        <Link className="primary-button" to="/">
          Return home
        </Link>
        <Link className="secondary-button" to="/catalog">
          Browse catalog
        </Link>
      </div>
    </main>
  );
}
