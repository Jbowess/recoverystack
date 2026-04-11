type Row = { feature: string; recoverystack: string; competitor: string };

export default function ComparisonTable({ rows }: { rows: Row[] }) {
  return (
    <table>
      <thead><tr><th>Feature</th><th>RecoveryStack</th><th>Competitor</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.feature}><td>{r.feature}</td><td>{r.recoverystack}</td><td>{r.competitor}</td></tr>)}</tbody>
    </table>
  );
}
