/**
 * ADR-061: the public site's English text, the shape every other language
 * must match (`bn.ts` is checked against it at build time). Filled page by
 * page from L2 on; names, codes, references and amounts are never here.
 */
const en = {
  language: {
    /** The switch's label, read by screen readers. */
    label: 'Language',
    en: 'English',
    bn: 'বাংলা',
  },
};

export type Messages = typeof en;
export default en;
