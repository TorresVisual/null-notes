import { create } from 'zustand'
import type { LucideIcon } from 'lucide-react'

export interface SheetAction {
  label: string
  icon: LucideIcon
  onSelect: () => void
  destructive?: boolean
}

export interface ActionSheetContent {
  title: string
  actions: SheetAction[]
}

interface ActionSheetStore {
  sheet: ActionSheetContent | null
  open: (sheet: ActionSheetContent) => void
  close: () => void
}

export const useActionSheetStore = create<ActionSheetStore>((set) => ({
  sheet: null,
  open: (sheet) => set({ sheet }),
  close: () => set({ sheet: null }),
}))
