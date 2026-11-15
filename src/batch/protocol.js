export const BATCH_MESSAGE_TYPES = ['open', 'opened', 'refused', 'inspect', 'inspected', 'apply', 'applied', 'cancel', 'cancelled', 'progress'];
export const INSPECT_NEEDS = ['nonEmpty'];
export const PHASES = ['open', 'run', 'write', 'verify'];

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export const openMessage = (fileRef) => ({ type: 'open', fileRef });
export const openedMessage = (fileId, index) => ({ type: 'opened', fileId, index });
export const refusedMessage = (fileId, code) => ({ type: 'refused', fileId, code });
export const inspectMessage = (fileRef, need) => ({ type: 'inspect', fileRef, need });
export const inspectedMessage = (fileId, index) => ({ type: 'inspected', fileId, index });
export const applyMessage = (fileRef, filePlan, options) => ({ type: 'apply', fileRef, filePlan, options });
export const appliedMessage = (fileId, result) => ({ type: 'applied', fileId, result });
export const cancelMessage = (target) => ({ type: 'cancel', target });
export const cancelledMessage = (fileId) => ({ type: 'cancelled', fileId });
export const progressMessage = (fileId, unitId, phase, pct) => ({ type: 'progress', fileId, unitId, phase, pct });

export const isBatchMessage = (m) => !!m && typeof m === 'object' && BATCH_MESSAGE_TYPES.includes(m.type);

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.length > 0;
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

const bad = (reason) => ({ ok: false, reason });
const ok = () => ({ ok: true });

function fileRefProblem(ref) {
  if (!isObject(ref)) return 'fileRef is missing';
  if (!isText(ref.id)) return 'fileRef.id must be a non-empty string';
  if (!isText(ref.name)) return 'fileRef.name must be a non-empty string';
  if (typeof ref.relPath !== 'string') return 'fileRef.relPath must be a string';
  if (!isNumber(ref.size)) return 'fileRef.size must be a number';
  if (!isNumber(ref.lastModified)) return 'fileRef.lastModified must be a number';
  if (typeof Blob === 'undefined' || !(ref.file instanceof Blob)) return 'fileRef.file must be a Blob';
  return null;
}

function optionsProblem(o) {
  if (!isObject(o)) return 'options are missing';
  if (typeof o.now !== 'string' || !ISO_UTC.test(o.now)) return 'options.now must be an ISO UTC time';
  if (typeof o.dryRun !== 'boolean') return 'options.dryRun must be a boolean';
  if (!isObject(o.limits)) return 'options.limits must be an object';
  if (!isText(o.culture)) return 'options.culture must be a string';
  return null;
}

function resultProblem(fileId, r) {
  if (!isObject(r)) return 'result is missing';
  if (r.fileId !== fileId) return 'result.fileId must match fileId';
  if (r.bytes !== null) {
    if (!(r.bytes instanceof Uint8Array)) return 'result.bytes must be null or a Uint8Array';
    if (r.bytes.byteOffset !== 0 || r.bytes.byteLength !== r.bytes.buffer.byteLength) return 'result.bytes must own its whole buffer';
    if (typeof r.sha256 !== 'string' || !SHA256_HEX.test(r.sha256)) return 'result.sha256 must be 64 lower case hex characters';
  } else if (r.sha256 !== null) return 'result.sha256 must be null when there are no bytes';
  for (const k of ['changes', 'warnings', 'rows']) if (!Array.isArray(r[k])) return `result.${k} must be an array`;
  return null;
}

export function validateMessage(m) {
  if (!isObject(m)) return bad('message must be an object');
  if (!BATCH_MESSAGE_TYPES.includes(m.type)) return bad(`unknown message type ${String(m.type)}`);
  let problem = null;
  switch (m.type) {
    case 'open':
      problem = fileRefProblem(m.fileRef);
      break;
    case 'inspect':
      problem = fileRefProblem(m.fileRef);
      if (!problem && (!Array.isArray(m.need) || m.need.length === 0 || m.need.some((n) => !INSPECT_NEEDS.includes(n)))) problem = 'need must list known needs';
      break;
    case 'apply':
      problem = fileRefProblem(m.fileRef) || optionsProblem(m.options);
      if (!problem && (!isObject(m.filePlan) || !isText(m.filePlan.fileId) || !Array.isArray(m.filePlan.actions) || !Array.isArray(m.filePlan.units))) problem = 'filePlan must carry fileId, actions and units';
      break;
    case 'opened':
    case 'inspected':
      problem = !isText(m.fileId) ? 'fileId must be a string' : !isObject(m.index) ? 'index is missing' : null;
      break;
    case 'refused':
      problem = !isText(m.fileId) ? 'fileId must be a string' : !isText(m.code) ? 'code must be a string' : null;
      break;
    case 'applied':
      problem = !isText(m.fileId) ? 'fileId must be a string' : resultProblem(m.fileId, m.result);
      break;
    case 'cancel':
      problem = isText(m.target) ? null : 'target must be a file id or all';
      break;
    case 'cancelled':
      problem = isText(m.fileId) ? null : 'fileId must be a string';
      break;
    case 'progress':
      if (!isText(m.fileId) || !isText(m.unitId)) problem = 'fileId and unitId must be strings';
      else if (!PHASES.includes(m.phase)) problem = 'phase must be open, run, write or verify';
      else if (!isNumber(m.pct) || m.pct < 0 || m.pct > 100) problem = 'pct must be from 0 to 100';
      break;
  }
  return problem ? bad(problem) : ok();
}

export function transferListFor(m) {
  if (m && m.type === 'applied' && m.result && m.result.bytes instanceof Uint8Array) return [m.result.bytes.buffer];
  return [];
}
