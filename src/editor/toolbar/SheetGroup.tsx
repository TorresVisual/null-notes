import { SplitSquareVertical, Plus, Layers, ListChecks, ChevronDown } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { message } from '@tauri-apps/plugin-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { splitIntoTasks, addNextTask, report, markdownOf } from '../splitIntoTasks'
import { nextTaskLabel } from '../../lib/taskScaffold'
import { insertFlashcardFromLastTask } from '../../lib/taskToFlashcard'
import { insertFlashcardFromLastCallout } from '../../lib/calloutToFlashcard'

const FLASHCARD_OUTCOME_MESSAGE: Record<string, string> = {
  'no-task': 'No Task section found in this note.',
  'no-solution': 'That task has no worked Solution yet.',
  'no-drawing': "That task's Solution has no hand-drawn ink yet.",
  'already-exists': 'That task already has a flashcard.',
}

const CALLOUT_OUTCOME_MESSAGE: Record<string, string> = {
  'no-callout': 'No numbered Definition, Theorem, Lemma, Corollary, Example or Algorithm found in this note.',
  empty: 'That block has no body text to put on a card.',
  'already-exists': 'That block already has a flashcard.',
}

interface SheetGroupProps {
  editor: Editor
}

export function SheetGroup({ editor }: SheetGroupProps) {
  return (
    <div className="toolbar-group" role="group" aria-label="Exercise sheet">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="toolbar-button toolbar-button-labeled" aria-label="Exercise sheet" title="Exercise sheet actions">
            <ListChecks size={15} />
            <span>Tasks</span>
            <ChevronDown size={12} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="context-menu"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            editor.commands.focus()
          }}
        >
          <DropdownMenuItem
            title="Rewrite this note as Task / Solution sections with a canvas each"
            onSelect={() => {
              void splitIntoTasks(editor)
                .then((outcome) => {
                  if (outcome === 'no-structure') {
                    void message('No exercise structure found in this note — nothing was changed.')
                  }
                })
                .catch(report)
            }}
          >
            <SplitSquareVertical size={14} /> Split into tasks
          </DropdownMenuItem>
          <DropdownMenuItem
            title="Append the next numbered Task and Solution pair"
            onSelect={() => {
              void addNextTask(editor, nextTaskLabel(markdownOf(editor))).catch(report)
            }}
          >
            <Plus size={14} /> Add next task
          </DropdownMenuItem>
          <DropdownMenuItem
            title="Turn the last Task's hand-drawn Solution into a review flashcard"
            onSelect={() => {
              try {
                const outcome = insertFlashcardFromLastTask(editor)
                const detail = FLASHCARD_OUTCOME_MESSAGE[outcome]
                if (detail) void message(detail)
              } catch (error) {
                report(error)
              }
            }}
          >
            <Layers size={14} /> Flashcard from last task
          </DropdownMenuItem>
          <DropdownMenuItem
            title="Turn the last numbered Definition, Theorem, Lemma, Corollary, Example or Algorithm into a review flashcard"
            onSelect={() => {
              try {
                const detail = CALLOUT_OUTCOME_MESSAGE[insertFlashcardFromLastCallout(editor)]
                if (detail) void message(detail)
              } catch (error) {
                report(error)
              }
            }}
          >
            <Layers size={14} /> Flashcard from last definition/theorem
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
