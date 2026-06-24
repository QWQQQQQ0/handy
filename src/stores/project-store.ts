// Project store — tracks the currently selected project within the Projects page.
// Scoped to the Projects page only; does NOT affect global app state or main Chat.

import { create } from 'zustand';

export interface ActiveProject {
  id: string;
  name: string;
  sourceType: 'generated' | 'imported';
  localPath: string;  // disk path for imported projects; empty for generated
}

const STORAGE_KEY = 'handy_active_project';

function loadFromStorage(): ActiveProject | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ActiveProject;
  } catch {
    return null;
  }
}

function saveToStorage(p: ActiveProject | null) {
  try {
    if (p) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch { /* ignore */ }
}

interface ProjectStoreState {
  activeProject: ActiveProject | null;

  /** Set the currently active project. */
  setActiveProject: (p: ActiveProject) => void;

  /** Clear the active project. */
  clearActiveProject: () => void;
}

export const useProjectStore = create<ProjectStoreState>((set) => ({
  activeProject: loadFromStorage(),

  setActiveProject: (p) => {
    saveToStorage(p);
    set({ activeProject: p });
  },

  clearActiveProject: () => {
    saveToStorage(null);
    set({ activeProject: null });
  },
}));

/** Non-reactive snapshot — safe to call from non-React contexts (skills, services). */
export function getActiveProject(): ActiveProject | null {
  return useProjectStore.getState().activeProject;
}
