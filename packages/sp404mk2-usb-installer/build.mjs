import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const sourceRoot = resolve(root, 'src/lib/opensynth');
const dist = resolve(here, 'dist');
const sourceOut = resolve(here, 'src');
const assets = resolve(here, 'assets');
const release = resolve(here, 'release');
const sources = ['usb-installer.ts', 'usb-route.ts', 'r50-webhid.ts', 'r51-webhid.ts', 'browser-hid.ts', 'stock-bootstrap.ts'];
const artifactSources = [
  ['public/opensynth/usb/opensynth-p34-from-stock-v552.osdelta', 'opensynth-p34-from-stock-v552.osdelta'],
  ['public/opensynth/usb/stock-carrier-p34-z1.oscarrier', 'stock-carrier-p34-z1.oscarrier'],
  ['public/opensynth/usb/stock-carrier-p34-x1.oscarrier', 'stock-carrier-p34-x1.oscarrier'],
  ['public/opensynth/usb/stock-r51-v1.osr51', 'stock-r51-v1.osr51'],
  ['public/opensynth/usb/stock-carrier-r51-v1.oscarrier', 'stock-carrier-r51-v1.oscarrier'],
];

for (const target of [dist, sourceOut, assets, release]) {
  if (!target.startsWith(`${here}\\`) && !target.startsWith(`${here}/`)) throw new Error(`Refusing unsafe output path ${target}`);
  await rm(target, {recursive: true, force: true});
  await mkdir(target, {recursive: true});
}

for (const name of sources) await cp(resolve(sourceRoot, name), resolve(sourceOut, name));
for (const [from, name] of artifactSources) await cp(resolve(root, from), resolve(assets, name));

await build({
  entryPoints: [resolve(sourceRoot, 'usb-installer.ts')],
  outfile: resolve(dist, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome120'],
  sourcemap: true,
  legalComments: 'none',
});

const files = [
  ...sources.map(name => resolve(sourceOut, name)),
  ...artifactSources.map(([, name]) => resolve(assets, name)),
  resolve(dist, 'index.js'),
  resolve(dist, 'index.js.map'),
];
const entries = {};
for (const file of files) {
  const body = await readFile(file);
  entries[relative(here, file).replaceAll('\\', '/')] = {
    bytes: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
  };
}
const manifest = {
  format: 'opensp-sp404mk2-usb-installer-package-v2',
  package: '@opensp/sp404mk2-usb-installer',
  version: '0.3.0',
  stockIdentity: {vendorId: '0582', productId: '02E7', transport: 'web-serial'},
  stagedImage: {providedByCaller: true, bytes: 2830672, sha256: '00299601316516283cdda08b66893cee09d0375f9719759c9e13917503b5e864'},
  stockDeltaRoute: {
    sourceFirmware: 'Roland v5.52 APP1',
    sourceSha256: '4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80',
    deltaBytes: 165559,
    deltaSha256: '3e84b57f11a39ad16db0219cb2f9887c87c72ddc3c218c0f4d4742d60c6800fa',
    carrierBytes: 6656,
    carrierSha256: '4e85b44a47cc014a9ccea122598c359938b38c818760c64bf4794a3aa21de3bd',
    targetSha256: '00299601316516283cdda08b66893cee09d0375f9719759c9e13917503b5e864',
  },
  preflightCarrier: {diagnosticOnly: true, flashWritePath: false, bytes: 2560, sha256: '773179fcb6713de25d368833d6d0be439e19a174080d5e2548c3a80256b704d7'},
  developerWriter: {
    applicationFirmwareIncluded: false,
    writerBytes: 18500,
    writerSha256: '6e72ed9487089f3014ccd161f3600eeb85979285890437cd34be4b51fda4ef26',
    carrierBytes: 26112,
    carrierSha256: 'c082ec3733096a99ba55a7aada19388eea1ed0eef2f2d7ff148c5add99669831',
  },
  routes: {
    r51: {primary: true, writerMaximumBytes: 0x37f000, candidateContract: 'stock-derived ABI2 B2', commitJournalRequired: true},
    directP34X: {primary: false, compatibility: true, exactImageOnly: true, firstOffset: '00080000', exclusiveEndOffset: '00334000'},
  },
  files: entries,
};
await writeFile(resolve(here, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
