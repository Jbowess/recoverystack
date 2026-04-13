'use client';

import { useState } from 'react';

type Props = {
  headers: string[];
  rows: string[][];
};

type SortState = { col: number; dir: 'asc' | 'desc' } | null;

function isNumeric(val: string): boolean {
  return /^[\$]?\s*[\d,]+(\.\d+)?/.test(val.trim());
}

function parseNumeric(val: string): number {
  return parseFloat(val.replace(/[^0-9.]/g, '')) || 0;
}

function compareValues(a: string, b: string, dir: 'asc' | 'desc'): number {
  const mult = dir === 'asc' ? 1 : -1;
  if (isNumeric(a) && isNumeric(b)) {
    return (parseNumeric(a) - parseNumeric(b)) * mult;
  }
  return a.localeCompare(b) * mult;
}

/** Returns row indices that have the best (max numeric) value in column colIdx */
function findWinnerRows(rows: string[][], colIdx: number): Set<number> {
  if (rows.length === 0) return new Set();
  const colVals = rows.map((r) => r[colIdx] ?? '');
  const allNumeric = colVals.every(isNumeric);
  if (!allNumeric) return new Set();
  const nums = colVals.map(parseNumeric);
  const max = Math.max(...nums);
  return new Set(nums.map((n, i) => (n === max ? i : -1)).filter((i) => i >= 0));
}

export default function ComparisonTable({ headers, rows }: Props) {
  const [sort, setSort] = useState<SortState>(null);

  function handleHeaderClick(colIdx: number) {
    setSort((prev) => {
      if (prev?.col === colIdx) {
        return prev.dir === 'asc' ? { col: colIdx, dir: 'desc' } : null;
      }
      return { col: colIdx, dir: 'asc' };
    });
  }

  const sortedRows = sort
    ? [...rows].sort((a, b) => compareValues(a[sort.col] ?? '', b[sort.col] ?? '', sort.dir))
    : rows;

  return (
    <div className="rs-comparison-wrapper" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <table className="rs-comparison-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {headers.map((header, colIdx) => (
              <th
                key={`th-${colIdx}`}
                onClick={() => handleHeaderClick(colIdx)}
                aria-sort={
                  sort?.col === colIdx
                    ? sort.dir === 'asc' ? 'ascending' : 'descending'
                    : 'none'
                }
                style={{
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                  position: colIdx === 0 ? 'sticky' : undefined,
                  left: colIdx === 0 ? 0 : undefined,
                }}
              >
                {header}
                {sort?.col === colIdx ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, rowIdx) => {
            // Find winner cols for this row
            const winnerCols = new Set<number>();
            for (let c = 1; c < headers.length; c++) {
              const winners = findWinnerRows(sortedRows, c);
              if (winners.has(rowIdx)) winnerCols.add(c);
            }

            return (
              <tr key={`row-${rowIdx}`}>
                {row.map((cell, colIdx) => (
                  <td
                    key={`cell-${rowIdx}-${colIdx}`}
                    data-label={headers[colIdx]}
                    style={{
                      position: colIdx === 0 ? 'sticky' : undefined,
                      left: colIdx === 0 ? 0 : undefined,
                      fontWeight: winnerCols.has(colIdx) ? 'bold' : undefined,
                      color: winnerCols.has(colIdx) ? 'var(--rs-accent, #00c2a8)' : undefined,
                    }}
                  >
                    {cell}
                    {winnerCols.has(colIdx) && (
                      <span aria-label="Best value" style={{ marginLeft: '0.25em', fontSize: '0.75em' }}>★</span>
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
