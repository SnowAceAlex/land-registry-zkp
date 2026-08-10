/**
 * scripts/lib/report.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Console output for the check-style scripts, plus the pass/fail tally.
 *
 * The distinction that matters is `fail` versus `note`. Not every unexpected
 * state is a defect: a receipt whose root has been superseded is the normal
 * consequence of someone else transferring, and reporting that as a failure
 * would train whoever runs these scripts to ignore red lines. `note` says
 * "expected under these circumstances", `fail` counts toward the exit code.
 */

export class CheckReport {
  private failures = 0;

  pass(label: string, detail = ''): void {
    console.log(`  OK    ${label}${detail ? ` — ${detail}` : ''}`);
  }

  fail(label: string, detail = ''): void {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    this.failures++;
  }

  /** Notable but not a defect — does not affect the exit code. */
  note(label: string, detail = ''): void {
    console.log(`  note  ${label}${detail ? ` — ${detail}` : ''}`);
  }

  /** `pass` when the condition holds, `fail` otherwise. */
  check(condition: boolean, label: string, passDetail = '', failDetail = ''): void {
    if (condition) {
      this.pass(label, passDetail);
    } else {
      this.fail(label, failDetail || passDetail);
    }
  }

  get failureCount(): number {
    return this.failures;
  }

  /** Print the verdict and return the process exit code. */
  summarise(): number {
    console.log(
      this.failures === 0 ? '\nAll checks passed.\n' : `\n${this.failures} check(s) FAILED.\n`,
    );
    return this.failures === 0 ? 0 : 1;
  }
}
