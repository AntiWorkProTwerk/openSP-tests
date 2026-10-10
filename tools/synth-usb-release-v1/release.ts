import type {B2ImageBundle, ImagePin, ImageRole, LocalBinary} from './model.ts';
import {B2} from './model.ts';
import {allowOnlyFields, app1Metadata, copyBinary, crc32, hexDigest, ownedBytes, readJsonFile, record, shaText, text} from './data.ts';
import {P6S_IMAGE, P6S_EVIDENCE} from './authority.ts';
import {readSelection, exportSelection, blankSelection, defaultChoice} from '../../src/lib/features/selection.ts';

export {P6S_IMAGE, P6S_EVIDENCE, CANDIDATE_AUTHORITIES} from './authority.ts';
const bytesByAdmission = new WeakMap<object, Uint8Array<ArrayBuffer>>();
const need = (value: unknown, reason: string): void => {if (!value) throw new TypeError(reason);};
const holds = ['public_ready','release_ready','download_ready','upload_ready','browser_build_enabled','browser_upload_enabled','native_hardware_qualified','device_operations'];
const SOURCE_AUTHORITY = 'ef933914f014d27ba18632906423546aa2394e281167e231314bd59eccd95ed5';
const SOURCE_ARCHIVE = '3abb90aafe7ecc1ca669a3f3e35885ddbf3803200db96768ef43fdd16b424117';

export interface QualifiedP6SRestoration extends B2ImageBundle {
  readonly schema: 'opensp-qualified-p6s-restoration-admission-v1';
  readonly scope: 'exact-historical-p6s-on-compatible-b2';
  readonly authenticatedEvidence: readonly {readonly id: string; readonly bytes: number; readonly sha256: string}[];
  readonly candidateUploadEnabled: false;
  readonly publicReleaseReady: false;
  readonly stockFirstInstallSupported: false;
  readonly freshDevicePreflightRequired: true;
  readonly browserWritePreviouslyQualified: true;
}

/** Hash actual retained evidence and the supplied restoration, independently of any selected-build receipt. */
export async function admitQualifiedP6SRestoration(
  restoration: LocalBinary,
  evidenceFiles: Readonly<Record<string, LocalBinary>>,
): Promise<QualifiedP6SRestoration> {
  need(evidenceFiles && Object.keys(evidenceFiles).length === P6S_EVIDENCE.length, 'Exact retained P6S evidence set is required');
  const authenticated = [];
  for (const pin of P6S_EVIDENCE) {
    const file = evidenceFiles[pin.id];
    need(file && file.size === pin.bytes && typeof file.arrayBuffer === 'function', `P6S evidence size differs: ${pin.id}`);
    const snapshot = ownedBytes(new Uint8Array(await file.arrayBuffer()));
    need(snapshot.length === pin.bytes && await hexDigest(snapshot) === pin.sha256, `P6S evidence digest differs: ${pin.id}`);
    authenticated.push(Object.freeze({id:pin.id,bytes:pin.bytes,sha256:pin.sha256}));
  }
  const bytes = await copyBinary(restoration, 'P6S restoration');
  need(bytes.length === P6S_IMAGE.bytes && await hexDigest(bytes) === P6S_IMAGE.sha256, 'Restoration is not the exact hardware-working P6S image');
  const metadata = app1Metadata(bytes, 2, 'P6S restoration');
  need(metadata.crc32 === P6S_IMAGE.crc32 && metadata.paddedBytes === P6S_IMAGE.padded_bytes && metadata.sectors === P6S_IMAGE.sectors, 'P6S ABI2 extent or CRC differs');
  const admission: QualifiedP6SRestoration = Object.freeze({
    schema:'opensp-qualified-p6s-restoration-admission-v1',scope:'exact-historical-p6s-on-compatible-b2',
    restoration:Object.freeze({role:'restoration',format:'spuafw10-abi2',...P6S_IMAGE}),
    authenticatedEvidence:Object.freeze(authenticated),candidateUploadEnabled:false,publicReleaseReady:false,
    stockFirstInstallSupported:false,freshDevicePreflightRequired:true,browserWritePreviouslyQualified:true,
  });
  bytesByAdmission.set(admission, bytes);
  return admission;
}

/** Internal transport ownership seam: clones, caller pins and candidate roles have no authority. */
export function resolveQualifiedImage(bundle: B2ImageBundle, role: ImageRole): {readonly pin: ImagePin; readonly bytes: Uint8Array<ArrayBuffer>} {
  const bytes = bytesByAdmission.get(bundle);
  need(bytes && role === 'restoration', 'Only this module\'s admitted exact P6S restoration may be transferred');
  return {pin:bundle.restoration,bytes:ownedBytes(bytes!)};
}

/** Structural browser check of a held patcher handoff. Source verification remains the patcher's responsibility. */
export async function inspectPatcherHandoff(handoffFile: LocalBinary, candidateFile: LocalBinary, restorationFile: LocalBinary) {
  need(handoffFile.size <= 32768, 'Patcher handoff exceeds 32 KiB');
  const {value,sha256:handoffSha256} = await readJsonFile(handoffFile,'Patcher handoff');
  allowOnlyFields(value,new Set(['schema','version','recipe','status','candidate_role','compact_recording_candidate_admitted','canonical_selection_sha256','canonical_selection','source_authority_sha256','source_archive','standalone_report_sha256','official_input','candidate','restoration','source_and_artifact_verified',...holds,'delivery','writer_authority_granted','blockers']),'Patcher handoff');
  need(value.schema === 'opensp-synth-release-local-handoff-v1' && value.version === 1 && value.recipe === 'historical-standalone-source16-v1' && value.status === 'PASS_SOURCE_AND_ARTIFACT_INSPECTION_RELEASE_HELD', 'Patcher handoff schema or recipe differs');
  need(holds.every(key => value[key] === false) && value.delivery === 'DO_NOT_DELIVER' && value.writer_authority_granted === false && value.compact_recording_candidate_admitted === false, 'Patcher handoff promotes held firmware or writer authority');
  const sourceArchive = record(value.source_archive,'source archive');
  need(value.source_authority_sha256 === SOURCE_AUTHORITY && sourceArchive.sha256 === SOURCE_ARCHIVE && sourceArchive.bytes === 1032317, 'Patcher source authority differs');
  shaText(value.standalone_report_sha256,'standalone report SHA-256');
  const selection = readSelection(JSON.stringify(value.canonical_selection));
  const canonical = new TextEncoder().encode(exportSelection(selection));
  need(await hexDigest(canonical) === value.canonical_selection_sha256, 'Patcher canonical selection binding differs');
  const fixedSelection = blankSelection(); fixedSelection.features = [defaultChoice('synth')];
  need(value.candidate_role === (exportSelection(selection) === exportSelection(fixedSelection) ? 'historical-fixed-synth-only-source16' : 'historical-selected-source16'), 'Patcher candidate role differs from canonical selection');
  const official = record(value.official_input,'official input');
  need(official.official_app1_bytes === 2652672 && official.official_app1_sha256 === '4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80' && (
    (official.kind === 'official-v552-app1' && official.bytes === 2652672 && official.sha256 === official.official_app1_sha256) ||
    (official.kind === 'official-v552-zip' && official.bytes === 1966465 && official.sha256 === 'ffe5cbbbc971383bcbef34959ea32cb36470d3c9eadad296f52bc4ea6a3cb3c5')
  ), 'Patcher official-input identity differs');
  const results: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const [role,file,path,identity] of [
    ['candidate',candidateFile,'selected-build/candidate.disabled.bin','Historical Source16 selected build'],
    ['restoration',restorationFile,'restore-build/restore-p6s.disabled.bin',P6S_IMAGE.expected_normal_identity],
  ] as const) {
    const body = await copyBinary(file,role);
    const entry = record(value[role],role), metadata = app1Metadata(body,2,role);
    const padded = new Uint8Array(metadata.paddedBytes).fill(0xff); padded.set(body);
    const expected = {path,identity,bytes:body.length,sha256:await hexDigest(body),crc32:metadata.crc32,padded_crc32:crc32(padded),padded_bytes:metadata.paddedBytes,sectors:metadata.sectors,abi:2,expected_cold_del_marker:B2.marker};
    allowOnlyFields(entry,new Set([...Object.keys(expected),...(role === 'restoration' ? ['artifact_equal_existing_p6s'] : [])]),role);
    need(Object.entries(expected).every(([key,item]) => entry[key] === item), `Patcher ${role} bytes or metadata differ`);
    if(role === 'restoration') need(expected.sha256 === P6S_IMAGE.sha256 && expected.bytes === P6S_IMAGE.bytes && entry.artifact_equal_existing_p6s === true,'Patcher restoration is not exact P6S');
    results[role] = Object.freeze(expected);
  }
  need(value.source_and_artifact_verified === true, 'Patcher source inspection assertion is missing');
  need(Array.isArray(value.blockers) && value.blockers.length === 4 && value.blockers.every(item => typeof item === 'string' && item.length > 0), 'Patcher blockers differ');
  return Object.freeze({schema:'opensp-held-patcher-browser-inspection-v1',handoffSha256,
    candidate:results.candidate,restoration:results.restoration,canonicalSelectionSha256:value.canonical_selection_sha256,
    candidateUploadEnabled:false,publicReleaseReady:false,delivery:'DO_NOT_DELIVER',writerAuthorityGranted:false,
    sourceReceiptAuthenticatedByThisInspection:false,blockers:Object.freeze([...(value.blockers as string[])]),
  });
}

export function admitCandidate(): never {
  throw new TypeError('No candidate artifact has a root-sealed LOCALBENCH software admission; public hardware qualification remains separate');
}

/** Envelope inspection for a future exact artifact. It creates no transfer token or qualification authority. */
export async function inspectUnqualifiedCandidate(file: LocalBinary, declaredNormalIdentity: string) {
  const identity = text(declaredNormalIdentity,'Declared candidate identity',64);
  const bytes = await copyBinary(file,'Unqualified candidate');
  const metadata = app1Metadata(bytes,2,'Unqualified candidate');
  return Object.freeze({schema:'opensp-unqualified-synth-b2-envelope-inspection-v1',
    image:Object.freeze({role:'candidate',format:metadata.format,abi:metadata.abi,bytes:bytes.length,
      sha256:await hexDigest(bytes),crc32:metadata.crc32,padded_bytes:metadata.paddedBytes,sectors:metadata.sectors,
      expected_normal_identity:identity,expected_cold_del_marker:B2.marker}),
    writerEnvelopeCompatible:true,identityEvidence:'caller-declaration-requires-real-runtime-and-owner-confirmation',
    transferAuthorityGranted:false,browserUploadEnabled:false,runtimeQualified:false,hardwareQualified:false,
    publicReleaseReady:false,stockFirstInstallSupported:false,freshDeviceIdentityAndProfileRequired:true,
  });
}
