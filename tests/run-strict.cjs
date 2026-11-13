const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = readdirSync(__dirname).filter(name => name.endsWith('.test.cjs')).map(name => path.join(__dirname, name));
const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root, stdio: 'inherit', env: { ...process.env, LEDGER_STRICT_TESTS: '1' }
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
