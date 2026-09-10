export interface DiffLine {
  type: 'same' | 'add' | 'remove'
  text: string
}

// ponytail: O(n*m) LCS table — fine for note-sized files, switch to a
// Myers diff if this ever runs against multi-thousand-line documents.
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      // Indices stay within the padded (length+1) table by construction — never undefined.
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  const result: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ type: 'same', text: a[i]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      result.push({ type: 'remove', text: a[i]! })
      i++
    } else {
      result.push({ type: 'add', text: b[j]! })
      j++
    }
  }
  while (i < a.length) result.push({ type: 'remove', text: a[i++]! })
  while (j < b.length) result.push({ type: 'add', text: b[j++]! })

  return result
}
