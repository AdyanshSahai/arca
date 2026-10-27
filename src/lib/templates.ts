// Template variables, filled in on the frontend so they use the user's
// local time zone:
//
//   {{title}}     the new note's name
//   {{date}}      2026-10-27
//   {{time}}      14:05
//   {{datetime}}  2026-10-27 14:05
//   {{folder}}    the folder the note is created in ("" at the vault root)

/** Zero-pads a number to two digits. */
const two = (n: number) => String(n).padStart(2, "0");

export function fillTemplate(text: string, vars: { title: string; folder: string }, now = new Date()): string {
  const date = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  const time = `${two(now.getHours())}:${two(now.getMinutes())}`;
  const values: Record<string, string> = {
    title: vars.title,
    date,
    time,
    datetime: `${date} ${time}`,
    folder: vars.folder,
  };
  // Unknown {{names}} are left untouched so a typo stays visible.
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) => values[name] ?? whole);
}

/** Today's date as YYYY-MM-DD, used to suggest note names. */
export function today(now = new Date()): string {
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}
