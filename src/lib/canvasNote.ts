// A canvas note is just a normal note that opens with an ink block: a heading,
// then the canvas, then room to type underneath. Nothing about it is special —
// which is why the title, search, tags and [[links]] all keep working.
export function canvasNoteBody(
  title: string,
  src: string,
  width: number,
  height: number,
): string {
  const fence = JSON.stringify({ src, width, height })
  return `# ${title}\n\n\`\`\`ink\n${fence}\n\`\`\`\n\n`
}
