const OPERATORS = ['folder:', 'tag:', 'type:', 'task:']

interface MobileSearchControlsProps {
  allWorkspaces: boolean
  onScopeChange: (all: boolean) => void
  onOperator: (operator: string) => void
}

export function MobileSearchControls({ allWorkspaces, onScopeChange, onOperator }: MobileSearchControlsProps) {
  return (
    <>
      <div className="mobile-search-chips">
        {OPERATORS.map((operator) => (
          <button key={operator} type="button" className="mobile-search-chip" onClick={() => onOperator(operator)}>
            {operator}
          </button>
        ))}
      </div>
      <div className="mobile-search-scope" role="group" aria-label="Search scope">
        <button type="button" className={allWorkspaces ? '' : 'is-on'} aria-pressed={!allWorkspaces} onClick={() => onScopeChange(false)}>
          This workspace
        </button>
        <button type="button" className={allWorkspaces ? 'is-on' : ''} aria-pressed={allWorkspaces} onClick={() => onScopeChange(true)}>
          All workspaces
        </button>
      </div>
    </>
  )
}
