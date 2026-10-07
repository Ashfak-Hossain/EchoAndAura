import { ClipboardCheck, CreditCard, Mail, Ticket } from 'lucide-react';

const stages = [
  {
    title: 'Register and reserve',
    detail: 'Order + hold + audit commit together',
    Icon: Ticket,
    tone: 'teal',
  },
  {
    title: 'Pay and submit',
    detail: 'Manual transfer, then transaction ID',
    Icon: CreditCard,
    tone: 'violet',
  },
  {
    title: 'Verify and issue',
    detail: 'Admin decision + tickets commit together',
    Icon: ClipboardCheck,
    tone: 'amber',
  },
  { title: 'Deliver', detail: 'Queue and worker, after commit', Icon: Mail, tone: 'rose' },
];

export function TicketJourney() {
  return (
    <figure className="system-map">
      <p className="eyebrow">ONE ORDER · FOUR BOUNDARIES</p>
      <ol className="system-nodes">
        {stages.map(({ title, detail, Icon, tone }, index) => (
          <li key={title}>
            <div className={`system-node ${tone}`}>
              <Icon size={25} aria-hidden="true" />
              <strong>{title}</strong>
              <span>{detail}</span>
            </div>
            {index < stages.length - 1 && (
              <span className="connector" aria-hidden="true">
                →
              </span>
            )}
          </li>
        ))}
      </ol>
      <figcaption>
        The buyer transfers money outside the application. Registration and approval each commit
        their related writes atomically. Payment submission is a separate audited transaction. Email
        delivery follows each relevant commit.
      </figcaption>
    </figure>
  );
}
