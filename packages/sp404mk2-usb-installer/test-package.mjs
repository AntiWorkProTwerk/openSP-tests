import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [resolve(here, 'build.mjs')], {stdio: 'inherit'});
const manifest = JSON.parse(await readFile(resolve(here, 'MANIFEST.json'), 'utf8'));
for (const [name, pin] of Object.entries(manifest.files)) {
  const body = await readFile(resolve(here, name));
  if (body.length !== pin.bytes) throw new Error(`${name} length changed`);
  const digest = createHash('sha256').update(body).digest('hex');
  if (digest !== pin.sha256) throw new Error(`${name} SHA-256 changed`);
}
const module = await import(`${pathToFileURL(resolve(here, 'dist/index.js')).href}?test=${Date.now()}`);
for (const name of ['getAuthorizedStockHighSpeed', 'getAuthorizedStockPort', 'requestStockHighSpeed', 'requestStockPort', 'bootstrapStockToR51',
  'fetchPinnedStockCarrier', 'fetchPinnedStockR51VArtifacts', 'bootstrapStockToR51VSerialOnly',
  'fetchPinnedStockDelta', 'installStockP34DeltaSerialOnly', 'preflightStockP34SerialOnly', 'qualifyAndInstallStockP34',
  'getAuthorizedR51Writer', 'requestR51Writer', 'attestFreshR51', 'installApp1ViaR51', 'installOpenSynthViaR51',
  'waitForSpg1Session', 'waitForOpenSynthP34']) {
  if (typeof module[name] !== 'function') throw new Error(`standalone bundle is missing ${name}`);
}
if (module.STOCK_R51.r51Sha256 !== manifest.stagedImage.sha256
    || module.STOCK_R51.carrierSha256 !== manifest.files['assets/stock-carrier-p34-x1.oscarrier'].sha256
    || module.R51_WEBHID.marker !== 0x52650001 || module.R51_WEBHID.maximum !== 0x37f000) {
  throw new Error('standalone bundle pins differ from the packaged artifacts or writer boundary');
}
if (manifest.format !== 'opensp-sp404mk2-usb-installer-package-v2' || manifest.version !== '0.3.0'
    || !manifest.routes.r51.primary || !manifest.routes.r51.commitJournalRequired
    || module.STOCK_R51_V.writerSha256 !== manifest.developerWriter.writerSha256
    || module.STOCK_R51_V.carrierSha256 !== manifest.developerWriter.carrierSha256) {
  throw new Error('primary R51 package contract changed');
}
if (module.STOCK_P34_DELTA.deltaSha256 !== manifest.stockDeltaRoute.deltaSha256
    || module.STOCK_P34_DELTA.carrierSha256 !== manifest.stockDeltaRoute.carrierSha256) {
  throw new Error('standalone delta pins differ from the packaged artifacts');
}
if (manifest.files['assets/stock-r51-v1.osr51'].sha256 !== manifest.developerWriter.writerSha256
    || manifest.files['assets/stock-carrier-r51-v1.oscarrier'].sha256 !== manifest.developerWriter.carrierSha256) {
  throw new Error('developer R51 assets differ from their manifest pins');
}
const packArgs = ['pack', '--json', '--pack-destination', resolve(here, 'release')];
const npmCli = process.platform === 'win32' ? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js') : undefined;
const packedText = npmCli
  ? execFileSync(process.execPath, [npmCli, ...packArgs], {cwd: here, encoding: 'utf8'})
  : execFileSync('npm', packArgs, {cwd: here, encoding: 'utf8'});
const packed = JSON.parse(packedText);
if (!Array.isArray(packed) || packed.length !== 1) throw new Error('npm pack returned an unexpected result');
const names = new Set(packed[0].files.map(item => item.path));
for (const required of ['package.json', 'README.md', 'SAFETY.md', 'INTEGRATION.md', 'PUBLISHING.md', 'MANIFEST.json', 'dist/index.js',
  'assets/opensynth-p34-from-stock-v552.osdelta', 'assets/stock-carrier-p34-z1.oscarrier',
  'assets/stock-carrier-p34-x1.oscarrier', 'assets/stock-carrier-p34-preflight-w.oscarrier',
  'assets/stock-r51-v1.osr51', 'assets/stock-carrier-r51-v1.oscarrier']) {
  if (!names.has(required)) throw new Error(`packed archive is missing ${required}`);
}
if ([...names].some(name => name.startsWith('release/') || name.endsWith('.bin') || name.includes('opensynth-v552'))) {
  throw new Error('packed archive contains a release archive or firmware image');
}
const archives = (await readdir(resolve(here, 'release'))).filter(name => name.endsWith('.tgz'));
if (archives.length !== 1) throw new Error('expected one standalone package archive');
const archiveBody = await readFile(resolve(here, 'release', archives[0]));
const archiveSha256 = createHash('sha256').update(archiveBody).digest('hex');
const consumer = await mkdtemp(resolve(tmpdir(), 'opensp-usb-installer-'));
try {
  await writeFile(resolve(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
  const installArgs = ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false',
    resolve(here, 'release', archives[0])];
  if (npmCli) execFileSync(process.execPath, [npmCli, ...installArgs], {cwd: consumer, stdio: 'pipe'});
  else execFileSync('npm', installArgs, {cwd: consumer, stdio: 'pipe'});
  const consumerCheck = `
    import {readFile} from 'node:fs/promises';
    import {fileURLToPath} from 'node:url';
    import {createHash} from 'node:crypto';
    import * as api from '@opensp/sp404mk2-usb-installer';
    const required=['getAuthorizedStockHighSpeed','getAuthorizedStockPort','requestStockPort','getAuthorizedR51Writer','requestR51Writer','requestStockHighSpeed','bootstrapStockToR51','fetchPinnedStockR51VArtifacts','bootstrapStockToR51VSerialOnly','fetchPinnedStockDelta','installStockP34DeltaSerialOnly','preflightStockP34SerialOnly','qualifyAndInstallStockP34','attestFreshR51','installApp1ViaR51','waitForSpg1Session'];
    for(const name of required)if(typeof api[name]!=='function')throw new Error('missing installed export '+name);
    for(const [specifier,expected] of [
      ['@opensp/sp404mk2-usb-installer/stock-delta-p34','${manifest.files['assets/opensynth-p34-from-stock-v552.osdelta'].sha256}'],
      ['@opensp/sp404mk2-usb-installer/stock-delta-carrier-p34','${manifest.files['assets/stock-carrier-p34-z1.oscarrier'].sha256}'],
      ['@opensp/sp404mk2-usb-installer/stock-carrier-p34','${manifest.files['assets/stock-carrier-p34-x1.oscarrier'].sha256}'],
      ['@opensp/sp404mk2-usb-installer/stock-carrier-p34-preflight','${manifest.files['assets/stock-carrier-p34-preflight-w.oscarrier'].sha256}'],
      ['@opensp/sp404mk2-usb-installer/stock-r51','${manifest.files['assets/stock-r51-v1.osr51'].sha256}'],
      ['@opensp/sp404mk2-usb-installer/stock-carrier-r51','${manifest.files['assets/stock-carrier-r51-v1.oscarrier'].sha256}'],
    ]){
      const body=await readFile(fileURLToPath(import.meta.resolve(specifier)));
      if(createHash('sha256').update(body).digest('hex')!==expected)throw new Error('installed asset pin changed');
    }
  `;
  execFileSync(process.execPath, ['--input-type=module', '--eval', consumerCheck], {cwd: consumer, stdio: 'pipe'});
} finally {
  await rm(consumer, {recursive: true, force: true});
}
await writeFile(resolve(here, 'release', 'SHA256SUMS'), `${archiveSha256}  ${archives[0]}\n`);
console.log(JSON.stringify({status: 'PASS', archive: `release/${archives[0]}`, files: names.size}, null, 2));
