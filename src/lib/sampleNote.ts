export const SAMPLE_NOTE_TITLE = 'Welcome to Null Notes'

export const SAMPLE_NOTE_CONTENT = `# ${SAMPLE_NOTE_TITLE}

This note is a plain \`.md\` file in your workspace. Edit anything here, or delete the note — nothing depends on it.

## Math

Inline $O(n \\log n)$ and display equations render as you type:

$$
T(n) = 2T(n/2) + n \\implies T(n) = \\Theta(n \\log n)
$$

## Code

\`\`\`python
def merge_sort(xs):
    if len(xs) <= 1:
        return xs
    mid = len(xs) // 2
    left, right = merge_sort(xs[:mid]), merge_sort(xs[mid:])
    out = []
    while left and right:
        out.append(left.pop(0) if left[0] <= right[0] else right.pop(0))
    return out + left + right
\`\`\`

> [!theorem 1.1] Master theorem
> Callouts cover theorems, lemmas, proofs and algorithms. Refer to this one anywhere by typing Theorem 1.1.

## Tasks and flashcards

- [ ] Type \`/\` on an empty line to see every block you can insert
- [ ] Press Ctrl P to jump to a note, Ctrl K to search all of them

Merge sort worst-case time :: O(n log n)

## Next

Import a lecture PDF from the sidebar to get its text and equations back as editable Markdown.
`
