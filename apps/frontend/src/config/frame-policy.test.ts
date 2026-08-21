import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('frontend frame policy', () => {
  const nginxConfig = readFileSync(resolve(process.cwd(), 'nginx.conf'), 'utf8');

  it('allows only same-origin framing for the live self-test matrix', () => {
    expect(nginxConfig).toContain("frame-ancestors 'self'");
    expect(nginxConfig).toContain('X-Frame-Options "SAMEORIGIN"');
    expect(nginxConfig).not.toMatch(/frame-ancestors\s+\*/u);
    expect(nginxConfig).not.toContain('ALLOWALL');
  });
});
