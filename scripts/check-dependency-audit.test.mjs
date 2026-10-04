import { describe, expect, it } from 'vitest';
import { checkAuditReport } from './check-dependency-audit.mjs';

function lintAudit() {
  const chain = ['braces', 'micromatch', 'fast-glob', '@next/eslint-plugin-next', 'eslint-config-next'];
  const packages = {};
  const vulnerabilities = {};
  for (const [index, name] of chain.entries()) {
    const node = `node_modules/${name}`;
    packages[node] = { dev: true, version: name === 'braces' ? '3.0.3' : '1.0.0' };
    vulnerabilities[name] = {
      severity: 'high',
      nodes: [node],
      via: index ? [chain[index - 1]] : [{
        name: 'braces',
        url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
      }],
    };
  }
  return { report: { auditReportVersion: 2, vulnerabilities }, packages };
}

describe('CI dependency audit', () => {
  it('accepts a clean audit and the single unpatched lint advisory with inherited findings', () => {
    expect(checkAuditReport({ auditReportVersion: 2, vulnerabilities: {} }, {})).toEqual({
      failures: [], exceptions: [],
    });
    const { report, packages } = lintAudit();
    expect(checkAuditReport(report, packages)).toEqual({
      failures: [], exceptions: Object.keys(report.vulnerabilities),
    });
  });

  it('rejects the lint advisory when any affected package is also a production dependency', () => {
    const { report, packages } = lintAudit();
    delete packages['node_modules/braces'].dev;
    expect(checkAuditReport(report, packages).failures).toEqual(Object.keys(report.vulnerabilities));
  });

  it('rejects another advisory in the same lint dependency chain', () => {
    const { report, packages } = lintAudit();
    report.vulnerabilities.braces.via.push({ name: 'braces', url: 'https://github.com/advisories/new-advisory' });
    expect(checkAuditReport(report, packages).failures).toEqual(Object.keys(report.vulnerabilities));
  });

  it('rejects moderate findings outside the lint chain, including development dependencies', () => {
    const { report, packages } = lintAudit();
    report.vulnerabilities.vitest = { severity: 'moderate', nodes: ['node_modules/vitest'], via: ['braces'] };
    packages['node_modules/vitest'] = { dev: true };
    expect(checkAuditReport(report, packages).failures).toEqual(['vitest']);
  });

  it('rejects missing lockfile entries and additional production copies of braces', () => {
    const { report, packages } = lintAudit();
    report.vulnerabilities.braces.nodes.push('node_modules/runtime/node_modules/braces');
    expect(checkAuditReport(report, packages).failures).toEqual(Object.keys(report.vulnerabilities));
    packages['node_modules/runtime/node_modules/braces'] = { version: '3.0.3' };
    expect(checkAuditReport(report, packages).failures).toEqual(Object.keys(report.vulnerabilities));
  });

  it('rejects a different braces version so the exception must be reviewed after an update', () => {
    const { report, packages } = lintAudit();
    packages['node_modules/braces'].version = '3.0.4';
    expect(checkAuditReport(report, packages).failures).toEqual(Object.keys(report.vulnerabilities));
  });

  it('rejects broken audit responses and dependency cycles', () => {
    expect(() => checkAuditReport({ error: { message: 'registry unavailable' } }, {})).toThrow();
    const { report, packages } = lintAudit();
    report.vulnerabilities.braces.via = ['micromatch'];
    expect(checkAuditReport(report, packages).failures).toEqual(Object.keys(report.vulnerabilities));
  });
});
