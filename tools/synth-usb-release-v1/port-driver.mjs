import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const pin = '9283155fbb074f8c6650fbed308f674dde8f2f144276f7ffc2901ad1ec65e5ef';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const raw = await readFile(process.argv[2]);
if (hash(raw) !== pin) throw Error('Historical physical-trial adapter source differs.');
const source = raw.toString('utf8');
const part = (start, end) => source.slice(source.indexOf(start), end ? source.indexOf(end) : undefined);
const constants = part('export const B2', 'const APP1_OFFSET');
let models = part('export type ImageRole', 'interface BundleBytes');
models = models.replace(part('export interface FeatureSelectionSummary', 'export interface B2ImageBundle'), '');
models = models.replace(part('export interface AdmittedBundleSummary', 'export interface ConnectOptions'), '');
models = models.replace('  readonly candidate: ImagePin;\r\n', '');
const bounds = part('const APP1_OFFSET', 'const FEATURE_FIELDS');
const fields = part('const FEATURE_FIELDS', 'const PACKAGE_RECEIPT_FIELDS');
const utilities = part('function fail(', 'function parseImagePin(').replace(/^function /gm, 'export function ').replace(/^async function /gm, 'export async function ');
const transport = part('function flattenCollections(');
const tokens = part('const preflightTokens', 'function fail(');
const prefix = `import {B2, B2DeliveryError, B2TransportError, B2ReadOnlyProbeError} from './model.ts';\nimport type {B2ImageBundle, ImageRole, ImagePin, HidCollectionInfo, BrowserHidDevice, B2Status, BrowserHidApi, ConnectOptions, ReadOnlyProbeOptions, OperationOptions, B2Progress, B2Preflight, B2ReadOnlyProbe, B2StorageResult, DeliveryStage} from './model.ts';\nimport {resolveAdmittedImage as getImage} from './resolve-image.ts';\nimport {crc32, ownedBytes} from './data.ts';\nexport * from './model.ts';\n\n`;
const directory = new URL('./', import.meta.url);
await mkdir(directory, {recursive:true});
await writeFile(new URL('model.ts', directory), constants + models);
await writeFile(new URL('data.ts', directory), `import {B2} from './model.ts';\nimport type {LocalBinary, ImageFormat} from './model.ts';\n` + bounds + utilities);
await writeFile(new URL('b2-driver.ts', directory), prefix + 'const APP1_OPCODES = new Set([1, 2, 3, 5, 6]);\n' + fields + tokens + transport);
await writeFile(new URL('DRIVER_PROVENANCE.json', directory), JSON.stringify({
  schema:'opensp-synth-b2-driver-port-v1', sourceSha256:pin,
  physicalTrialStorageSha256:'090872342cc913029ca9f5ba5005ee2606dc4399df99710a9029b2557f4e97ac',
  transportSectionSha256:hash(transport), transportSectionBytes:Buffer.byteLength(transport),
  transportSectionUnchanged:true,
  changes:['Admission and private byte ownership moved to the restoration-only release module.', 'Shared types, constants and bounded binary/JSON helpers extracted.'],
  deviceOperations:false, firmwareRebuilt:false,
},null,2)+'\n');
