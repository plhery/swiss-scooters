import { describe, expect, it } from 'vitest';
import {
  API_CONTENT_SECURITY_POLICY,
  documentContentSecurityPolicy,
  SERVICE_WORKER_CONTENT_SECURITY_POLICY,
} from '@/lib/contentSecurityPolicy';

function directive(policy: string, name: string): string {
  return policy
    .split(';')
    .map(value => value.trim())
    .find(value => value.startsWith(`${name} `)) ?? '';
}

describe('documentContentSecurityPolicy', () => {
  it('uses a strict nonce-based production script policy', () => {
    const csp = documentContentSecurityPolicy({ nonce: 'test-nonce', development: false });

    expect(directive(csp, 'script-src')).toBe(
      "script-src 'self' 'nonce-test-nonce' 'strict-dynamic'"
    );
    expect(directive(csp, 'script-src')).not.toContain("'unsafe-inline'");
    expect(directive(csp, 'script-src')).not.toContain("'unsafe-eval'");
    expect(directive(csp, 'script-src-attr')).toBe("script-src-attr 'none'");
    expect(directive(csp, 'style-src-elem')).toBe(
      "style-src-elem 'self' 'nonce-test-nonce'"
    );
    expect(directive(csp, 'worker-src')).toBe("worker-src 'self'");
    expect(directive(csp, 'img-src')).not.toContain('blob:');
    expect(directive(csp, 'frame-src')).toBe("frame-src 'none'");
    expect(directive(csp, 'base-uri')).toBe("base-uri 'none'");
    expect(csp).toContain('upgrade-insecure-requests;');
  });

  it('adds only the development capabilities required by Next.js', () => {
    const csp = documentContentSecurityPolicy({ nonce: 'dev-nonce', development: true });

    expect(directive(csp, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(csp, 'script-src')).not.toContain("'unsafe-inline'");
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' ws: wss:");
    expect(directive(csp, 'worker-src')).toBe("worker-src 'self' blob:");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('can preserve the production policy on a local HTTP origin', () => {
    const csp = documentContentSecurityPolicy({
      nonce: 'local-production-nonce',
      development: false,
      upgradeInsecureRequests: false,
    });

    expect(directive(csp, 'script-src')).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
});

describe('non-document policies', () => {
  it('denies all active API response content', () => {
    expect(API_CONTENT_SECURITY_POLICY).toBe(
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox;"
    );
  });

  it('allows the service worker to fetch only from its own origin', () => {
    expect(directive(SERVICE_WORKER_CONTENT_SECURITY_POLICY, 'default-src')).toBe(
      "default-src 'none'"
    );
    expect(directive(SERVICE_WORKER_CONTENT_SECURITY_POLICY, 'script-src')).toBe(
      "script-src 'self'"
    );
    expect(directive(SERVICE_WORKER_CONTENT_SECURITY_POLICY, 'connect-src')).toBe(
      "connect-src 'self'"
    );
    expect(directive(SERVICE_WORKER_CONTENT_SECURITY_POLICY, 'worker-src')).toBe(
      "worker-src 'none'"
    );
  });
});
