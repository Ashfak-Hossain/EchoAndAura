import { Database, Globe, Layers, ListOrdered, Mail } from 'lucide-react';

const nodes = [
  { title: 'Browser', detail: 'Choose tickets', Icon: Globe, tone: 'blue' },
  { title: 'Application', detail: 'Validate and coordinate', Icon: Layers, tone: 'violet' },
  { title: 'Postgres', detail: 'Reserve, audit, commit', Icon: Database, tone: 'teal' },
  { title: 'Redis + BullMQ', detail: 'Queue after commit', Icon: ListOrdered, tone: 'amber' },
  { title: 'Worker', detail: 'Render, retry, deliver', Icon: Mail, tone: 'rose' },
];

export function SystemMap() {
  return (
    <figure className="system-map">
      <p className="eyebrow">ORDER REGISTRATION · EMAIL PATH</p>
      <ol className="system-nodes">
        {nodes.map(({ title, detail, Icon, tone }, index) => (
          <li key={title}>
            <div className={`system-node ${tone}`}>
              <Icon size={25} aria-hidden="true" />
              <strong>{title}</strong>
              <span>{detail}</span>
            </div>
            {index < nodes.length - 1 && (
              <span className="connector" aria-hidden="true">
                →
              </span>
            )}
          </li>
        ))}
      </ol>
      <figcaption>
        The application commits the order in Postgres, then queues an email job in Redis. The worker
        processes the job. This shows the order of work; the application coordinates both stores.
      </figcaption>
    </figure>
  );
}
