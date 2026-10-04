import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const lintPackages = new Set([
  'eslint-config-next',
  '@next/eslint-plugin-next',
  'fast-glob',
  'micromatch',
  'braces',
]);
const unpatchedLintAdvisory = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';

export function checkAuditReport(report, packages) {
  if (report.auditReportVersion !== 2 || report.error || !report.vulnerabilities) {
    throw new Error('npm did not return a valid dependency audit.');
  }

  // This unpatched advisory only processes repository-controlled lint patterns.
  // Check npm's inherited findings too, without accepting another advisory or
  // allowing the vulnerable dependency into the production dependency graph.
  function isLintException(name, ancestors = new Set()) {
    const finding = report.vulnerabilities[name];
    if (!lintPackages.has(name) || !finding || ancestors.has(name)) return false;
    if (!finding.nodes?.length || !finding.nodes.every(node => packages[node]?.dev === true)) {
      return false;
    }
    if (name === 'braces' && !finding.nodes.every(node => packages[node].version === '3.0.3')) {
      return false;
    }
    const visited = new Set([...ancestors, name]);
    return finding.via?.length > 0 && finding.via.every(cause => (
      typeof cause === 'string'
        ? isLintException(cause, visited)
        : name === 'braces' && cause.name === 'braces' && cause.url === unpatchedLintAdvisory
    ));
  }

  const failures = [];
  const exceptions = [];
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    if (['info', 'low'].includes(finding.severity)) continue;
    if (!['moderate', 'high', 'critical'].includes(finding.severity)) {
      throw new Error(`Unrecognized audit severity for ${name}.`);
    }
    (isLintException(name) ? exceptions : failures).push(name);
  }
  return { failures, exceptions };
}

function main() {
  const audit = spawnSync('npm', ['audit', '--json', '--audit-level=moderate'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (audit.error || ![0, 1].includes(audit.status)) {
    throw new Error(audit.error?.message || audit.stderr || 'npm audit failed.');
  }
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const report = JSON.parse(audit.stdout);
  const { failures, exceptions } = checkAuditReport(report, lock.packages);
  if (exceptions.length) {
    console.log(`Known development-only lint advisory: ${unpatchedLintAdvisory}`);
    console.log(`Affected lint packages: ${exceptions.join(', ')}`);
  }
  if (failures.length) {
    for (const name of failures) {
      console.error(`${name}: ${JSON.stringify(report.vulnerabilities[name])}`);
    }
    process.exitCode = 1;
  } else {
    console.log('Dependency audit passed: no unexcepted moderate or higher advisories.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
