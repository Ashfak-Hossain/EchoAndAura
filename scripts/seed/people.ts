/**
 * Invented buyers for the dev seed. Emails are @example.com (reserved — no
 * mail can ever reach a real person); a few names are in Bengali script so
 * the PDF ticket and check-in list are exercised with real Dhaka data.
 */
export interface Person {
  name: string;
  email: string;
}

const NAMES: readonly [string, string][] = [
  ['Nusrat Jahan', 'nusrat.jahan'],
  ['Tanvir Alam', 'tanvir.alam'],
  ['Farhana Rahman', 'farhana.rahman'],
  ['Arif Hossain', 'arif.hossain'],
  ['Sadia Islam', 'sadia.islam'],
  ['Rafiq Ahmed', 'rafiq.ahmed'],
  ['Tahmina Akter', 'tahmina.akter'],
  ['Imran Chowdhury', 'imran.chowdhury'],
  ['Nabila Karim', 'nabila.karim'],
  ['Shahriar Kabir', 'shahriar.kabir'],
  ['Mehjabin Sultana', 'mehjabin.sultana'],
  ['Zubair Hasan', 'zubair.hasan'],
  ['Ayesha Siddiqua', 'ayesha.siddiqua'],
  ['Rakib Mahmud', 'rakib.mahmud'],
  ['Tasnim Ferdous', 'tasnim.ferdous'],
  ['Mahfuz Rahman', 'mahfuz.rahman'],
  ['Lamia Haque', 'lamia.haque'],
  ['Sabbir Hossain', 'sabbir.hossain'],
  ['Nafisa Anjum', 'nafisa.anjum'],
  ['Fahim Shahriar', 'fahim.shahriar'],
  ['Rumana Afroz', 'rumana.afroz'],
  ['Asif Iqbal', 'asif.iqbal'],
  ['Jannatul Ferdous', 'jannatul.ferdous'],
  ['Ehsan Habib', 'ehsan.habib'],
  ['Priyanka Das', 'priyanka.das'],
  ['Sourav Saha', 'sourav.saha'],
  ['Mithila Roy', 'mithila.roy'],
  ['Kazi Nazmul', 'kazi.nazmul'],
  ['Samira Khan', 'samira.khan'],
  ['Adnan Sami', 'adnan.sami'],
  ['Rifat Jahan', 'rifat.jahan'],
  ['Tanjim Ahmed', 'tanjim.ahmed'],
  ['Maliha Tabassum', 'maliha.tabassum'],
  ['Nayeem Islam', 'nayeem.islam'],
  ['Sharmin Akhter', 'sharmin.akhter'],
  ['Omar Faruk', 'omar.faruk'],
  ['তানভীর আলম', 'tanvir.alam.bn'],
  ['নুসরাত জাহান', 'nusrat.jahan.bn'],
  ['সাদিয়া ইসলাম', 'sadia.islam.bn'],
  ['মাহমুদুল হাসান', 'mahmudul.hasan.bn'],
];

export const PEOPLE: readonly Person[] = NAMES.map(([name, handle]) => ({
  name,
  email: `${handle}@example.com`,
}));

/** A Bangladeshi mobile in E.164, deterministic per index (operators 17/18/19). */
export function phoneFor(i: number): string {
  const operator = ['17', '18', '19', '16', '15', '13'][i % 6]!;
  const body = String(10_000_000 + ((i * 7_919_313) % 89_999_999)).padStart(8, '0');
  return `+880${operator.slice(0, 2)}${body}`;
}
