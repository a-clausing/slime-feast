/**
 * Uniform grid for fast proximity queries on many small static-ish items (food).
 * Stores item indices per cell; items are added/removed explicitly.
 */
export class Grid {
  readonly cols: number;
  readonly rows: number;
  readonly cells: number[][];
  constructor(readonly width: number, readonly height: number, readonly cellSize: number) {
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
  }
  private cellIndex(x: number, y: number): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cellSize)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cellSize)));
    return cy * this.cols + cx;
  }
  add(idx: number, x: number, y: number): void {
    this.cells[this.cellIndex(x, y)].push(idx);
  }
  remove(idx: number, x: number, y: number): void {
    const cell = this.cells[this.cellIndex(x, y)];
    const i = cell.indexOf(idx);
    if (i >= 0) {
      cell[i] = cell[cell.length - 1];
      cell.pop();
    }
  }
  clear(): void {
    for (const c of this.cells) c.length = 0;
  }
  /** Calls fn for every item index in cells overlapping the circle's bounding box. */
  query(x: number, y: number, r: number, fn: (idx: number) => void): void {
    const x0 = Math.max(0, Math.floor((x - r) / this.cellSize));
    const x1 = Math.min(this.cols - 1, Math.floor((x + r) / this.cellSize));
    const y0 = Math.max(0, Math.floor((y - r) / this.cellSize));
    const y1 = Math.min(this.rows - 1, Math.floor((y + r) / this.cellSize));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this.cells[cy * this.cols + cx];
        // iterate over a stable snapshot length; removals during fn swap items in
        for (let k = cell.length - 1; k >= 0; k--) {
          if (k < cell.length) fn(cell[k]);
        }
      }
    }
  }
}
