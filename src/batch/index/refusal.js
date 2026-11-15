import { isQuoinError } from '../../core/errors.js';

export const REFUSAL_CODES = ['file.xls', 'file.xlsb', 'file.encrypted', 'file.strict', 'file.ods', 'file.notWorkbook', 'file.tooLarge', 'file.unsupportedExtension', 'file.lockFile'];

export function refusalFor(error) {
  if (!isQuoinError(error)) return null;
  if (REFUSAL_CODES.includes(error.code)) return error.code;
  if (error.code === 'zip.encrypted') return 'file.encrypted';
  if (error.code.startsWith('limit.')) return 'file.tooLarge';
  return 'file.notWorkbook';
}
