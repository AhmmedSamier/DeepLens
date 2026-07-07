const { execSync } = require('child_process');
try {
  execSync('xvfb-run bun run test', { stdio: 'inherit' });
} catch (e) {
  process.exit(1);
}
