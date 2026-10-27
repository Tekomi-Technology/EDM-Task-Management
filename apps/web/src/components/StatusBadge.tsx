import type { TicketStatus } from '../types';
import { STATUS_LABEL } from '../format';

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`badge dot badge-${status}`}>{STATUS_LABEL[status]}</span>;
}
