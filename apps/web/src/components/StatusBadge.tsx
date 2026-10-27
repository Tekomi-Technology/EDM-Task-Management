import type { TicketStatus } from '@edm/shared';
import { STATUS_LABEL } from '../format';

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`badge dot badge-${status}`}>{STATUS_LABEL[status]}</span>;
}
