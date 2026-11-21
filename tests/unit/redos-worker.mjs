import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { openWorkbook } from '../../src/core/workbook.js';
import { executeFile } from '../../src/batch/execute/index.js';

const wb = await openWorkbook(new Uint8Array(readFileSync(workerData.path)), 'pq_simple.xlsx');
if (workerData.text) wb.queries[0].original = workerData.text;
const unit = { fileId: 'f0001', kind: 'workbook', name: 'pq_simple', index: 1 };
const plan = { fileId: 'f0001', source: 'rule', units: [unit], actions: [{ unit, op: 'replaceText', target: { type: 'query', name: 'StudentResults' }, compute: null, output: null, replaces: null }], skipped: null };
const recipe = { recipe: 'replace', v: 1, replace: { in: ['m'], find: workerData.find, with: 'x', kind: 'regex', matchCase: true } };
let announced = false;
const shouldStop = () => {
  if (!announced) {
    announced = true;
    parentPort.postMessage({ type: 'started' });
  }
  return false;
};
const res = await executeFile(wb, plan, { now: '2026-11-14T10:00:00.000Z', recipe, shouldStop });
parentPort.postMessage({ type: 'done', verdict: res.rows[0].verdict, hasBytes: !!res.bytes });
