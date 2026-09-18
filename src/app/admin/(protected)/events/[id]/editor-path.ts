/** Editor tabs (B5). URL state: `?tab=` — server-rendered, deep-linkable. */
export const EDITOR_TABS = ['details', 'cover', 'ticket-types', 'publish'] as const;
export type EditorTab = (typeof EDITOR_TABS)[number];

export function isEditorTab(value: string | undefined): value is EditorTab {
  return EDITOR_TABS.includes(value as EditorTab);
}

/** Editor URL for a tab — actions redirect here after a change. */
export function editorPath(eventId: string, tab: EditorTab = 'details'): string {
  const base = `/admin/events/${eventId}/edit`;
  return tab === 'details' ? base : `${base}?tab=${tab}`;
}
