// Phase 7.5: one CPU core's speed at the kind of work the web does (building
// objects, JSON, strings). Run the same file on the laptop and the server to
// scale the laptop's load results (docs/LOAD-TEST.md). Prints milliseconds;
// lower is faster.
const rows = Array.from({ length: 2000 }, (_, i) => ({
  id: i,
  title: `Event ${i}`,
  price: i * 100,
  tags: ['dhaka', 'live', String(i)],
}));
const t = process.hrtime.bigint();
let n = 0;
for (let i = 0; i < 300; i++) {
  const html = rows.map((r) => `<li data-id="${r.id}">${r.title} ${r.price}</li>`).join('');
  n += JSON.parse(JSON.stringify(rows)).length + html.length;
}
console.log(`${Number((process.hrtime.bigint() - t) / 1_000_000n)} ms (${n})`);
