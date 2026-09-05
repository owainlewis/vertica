/** Reserve both labels so a pending action cannot move adjacent controls. */
export default function BusyLabel({ busy, idle, pending }: { busy: boolean; idle: string; pending: string }) {
  return (
    <span className="busy-label">
      <span className="busy-label-measure" aria-hidden="true">{idle}</span>
      <span className="busy-label-measure" aria-hidden="true">{pending}</span>
      <span>{busy ? pending : idle}</span>
    </span>
  );
}
