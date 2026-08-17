import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { CertificationPage } from './CertificationPage';
import { renderWithClient } from '../../test/render';
import { certificationDetail, certificationRunId, server } from '../../test/server';

const agentId = '11111111-1111-4111-8111-111111111111';

function renderCertification(path = `/certification/${agentId}`) {
  return renderWithClient(
    <Routes>
      <Route element={<CertificationPage />} path="/certification/:agentId" />
    </Routes>,
    [path],
  );
}

describe('certification page', () => {
  it('renders server-scored evidence and records a rationale-gated promotion', async () => {
    const user = userEvent.setup();
    renderCertification();

    expect(
      await screen.findByText(/corpus agreement, not live semantic answer quality/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Corpus')).toBeInTheDocument();
    expect(screen.getByText('Gate config')).toBeInTheDocument();
    expect(screen.getAllByText('PASS').length).toBeGreaterThan(0);
    expect(screen.getByText('NOT APPLICABLE')).toBeInTheDocument();
    expect(screen.getAllByText('Supplier delay evidence brief').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Promote challenger' }));
    await user.type(
      screen.getByLabelText('Promotion rationale'),
      'The immutable coverage evidence meets every applicable gate.',
    );
    await user.click(screen.getByRole('button', { name: 'Promote release' }));
    expect(await screen.findByText(/challenger is now the active champion/i)).toBeInTheDocument();
  });

  it('rejects malformed route identifiers without issuing certification work', async () => {
    renderCertification('/certification/not-a-uuid');
    expect(
      screen.getByRole('heading', { name: 'Malformed agent identifier.' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/No certification request was sent/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Coverage certification passed')).not.toBeInTheDocument();
    });
  });

  it('renders nightly champion re-certification as one subject with no comparison', async () => {
    server.use(
      http.get(`http://localhost/agents/certification-runs/${certificationRunId}`, () =>
        HttpResponse.json({
          ...certificationDetail,
          run: {
            ...certificationDetail.run,
            kind: 'champion_recertification',
            originStatus: 'active',
          },
          subject: {
            ...certificationDetail.subject,
            lifecycleStatus: 'active',
          },
          champion: null,
          promotionEligibility: {
            eligible: false,
            freshUntil: null,
            blockers: [],
          },
        }),
      ),
    );

    renderCertification();

    expect(
      await screen.findByRole('heading', { name: 'Champion Re-certification' }),
    ).toBeInTheDocument();
    expect(screen.getByText('CHAMPION SUBJECT · NIGHTLY RE-CERTIFICATION')).toBeInTheDocument();
    expect(screen.queryByText('VS')).not.toBeInTheDocument();
    expect(screen.queryByText('CHALLENGER')).not.toBeInTheDocument();
    expect(screen.getAllByText('Subject').length).toBeGreaterThan(0);
    expect(screen.getByText('NOT APPLICABLE')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Promote challenger' })).not.toBeInTheDocument();
  });

  it('fails closed when a selected run belongs to another agent version', async () => {
    const otherAgentId = '10101010-1010-4010-8010-101010101010';
    server.use(
      http.get(`http://localhost/agents/certification-runs/${certificationRunId}`, () =>
        HttpResponse.json({
          ...certificationDetail,
          run: { ...certificationDetail.run, agentVersionId: otherAgentId },
          subject: { ...certificationDetail.subject, agentVersionId: otherAgentId },
        }),
      ),
    );

    renderCertification();

    expect(await screen.findByText(/does not belong to this agent version/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Certification gates')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Promote challenger' })).not.toBeInTheDocument();
  });

  it('does not offer re-certification from a rejected lifecycle state', async () => {
    server.use(
      http.get(`http://localhost/agents/certification-runs/${certificationRunId}`, () =>
        HttpResponse.json({
          ...certificationDetail,
          run: {
            ...certificationDetail.run,
            state: 'failed',
            verdict: 'failed',
            message: 'Coverage gates failed',
          },
          subject: {
            ...certificationDetail.subject,
            lifecycleStatus: 'rejected',
          },
          promotionEligibility: {
            eligible: false,
            freshUntil: null,
            blockers: [
              {
                code: 'corpus_superseded',
                message: 'A newer corpus is active.',
                recommendedAction: 'recertify',
              },
            ],
          },
        }),
      ),
    );

    renderCertification();

    expect(await screen.findByText('Coverage gates failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-certify' })).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Re-certify against current corpus' }),
    ).not.toBeInTheDocument();
  });
});
