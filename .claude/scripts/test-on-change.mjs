/**
 * Claude Code PostToolUse hook - runs unit tests after every Write or Edit.
 *
 * Triggered after Write or Edit tool calls. Runs `npm test` and exits with
 * code 2 on failure so asyncRewake notifies the model.
 */
import { execSync } from 'child_process';

const PROJECT_ROOT = 'C:/workflow/workflow-consultancy';

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(chunks.join(''));
  } catch {
    process.exit(0); // malformed stdin - skip silently
  }

  try {
    const output = execSync('npm test', {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    });

    // On success print only the summary lines (last 8 lines of TAP output)
    const lines = output.split('\n');
    const summary = lines.slice(-9).join('\n');
    process.stdout.write(summary + '\n');
    process.exit(0);
  } catch (err) {
    // Tests failed - print full output so Claude can see what broke
    process.stdout.write(err.stdout || '');
    if (err.stderr) process.stderr.write(err.stderr);
    process.exit(2); // exit 2 = asyncRewake signals the model
  }
});
