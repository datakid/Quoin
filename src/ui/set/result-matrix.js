import { Grid } from '../grid.js';
import { S, errorMessage } from '../strings.js';

const VERDICT_CLASS = { changed: 'status-good', unchanged: 'status-neutral', skipped: 'status-neutral', refused: 'status-neutral', cancelled: 'status-neutral', failed: 'status-bad', 'not-released': 'status-bad' };

const VERDICT_TEXT = { changed: S.matrixYes, unchanged: S.matrixNo, skipped: S.matrixSkipped, refused: S.matrixRefused, failed: S.matrixFailed, cancelled: S.matrixCancelled, 'not-released': S.matrixNotReleased };

const VERDICT_COLUMN = 4;

export class ResultMatrix {
  constructor(host, { mode = 'report', onSelectRow = null } = {}) {
    this.mode = mode;
    this.verdicts = [];
    this.selected = -1;
    this.grid = new Grid(host, {
      onActive: (r) => {
        if (r === this.selected) return;
        this.selected = r;
        if (onSelectRow) onSelectRow(r);
      },
      cellClass: (r, c) => (c === VERDICT_COLUMN ? VERDICT_CLASS[this.verdicts[r]] || '' : '')
    });
    this.grid.el.setAttribute('aria-label', S.matrixLabel);
  }

  setRows(rows) {
    this.verdicts = rows.map((r) => r.verdict);
    this.selected = -1;
    const text = (name) => ({ name, type: 'text' });
    const columns = [text(S.matrixFile), text(S.matrixUnit), text(S.matrixAction), text(S.matrixCompute), text(this.mode === 'preview' ? S.matrixWouldChange : S.matrixChanged), text(S.matrixReason), text(S.matrixOldHash), text(S.matrixNewHash)];
    const data = rows.map((r) => [`${r.folder}${r.file}`, r.unit, r.action, r.compute, VERDICT_TEXT[r.verdict] || r.verdict, r.reason || (r.reason_code ? errorMessage(r.reason_code) : ''), r.old_hash, r.new_hash]);
    this.grid.setData({ columns, rowCount: data.length, rows: data });
  }

  destroy() {
    this.grid.destroy();
    this.grid.el.remove();
  }
}
