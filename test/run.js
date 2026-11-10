// Compiles the tests (test/tsconfig.json -> .testbuild) and runs every *.test.js in it.
//   npm test                 run everything
//   npm test -- timesync     only the suites whose name contains "timesync"
// The Homey runtime module is not installed in node_modules, so test/stubs is put on NODE_PATH
// (a real node_modules package such as jsmodbus always wins over the stub).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const build = path.join(root, '.testbuild', 'test');
const filter = process.argv[2];

let tsc;
try { tsc = require.resolve('typescript/bin/tsc', { paths: [root] }); } catch (e) { tsc = null; }
const tsconfig = process.env.TEST_TSCONFIG || path.join(__dirname, 'tsconfig.json');
const compile = tsc
  ? spawnSync(process.execPath, [tsc, '-p', tsconfig], { stdio: 'inherit' })
  : spawnSync('tsc', ['-p', tsconfig], { stdio: 'inherit', shell: true });
if (compile.status !== 0) console.log('\nWARNING: TypeScript reported errors (see above); running the tests anyway.\n');
if (!fs.existsSync(build)) { console.log('Nothing was compiled, cannot run the tests.'); process.exit(1); }

const env = { ...process.env, NODE_PATH: [path.join(__dirname, 'stubs'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter) };
const suites = fs.readdirSync(build).filter((f) => f.endsWith('.test.js') && (!filter || f.includes(filter))).sort();
let failed = 0;
for (const file of suites) {
  const r = spawnSync(process.execPath, [path.join(build, file)], { env, encoding: 'utf8', timeout: 60000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const lines = out.split('\n');
  const bad = lines.filter((l) => l.startsWith('FAIL'));
  const checks = lines.filter((l) => l.startsWith('ok') || l.startsWith('FAIL')).length;
  const passed = r.status === 0 && bad.length === 0 && checks > 0;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${file.replace('.test.js', '').padEnd(18)} ${checks} checks`);
  if (!passed) { failed++; console.log(bad.length ? bad.join('\n') : out.split('\n').slice(-15).join('\n')); }
}
console.log(`\n${suites.length - failed}/${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
