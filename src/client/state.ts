/**
 * Simple reactive state store for the RSS reader client.
 * Holds minimal global state that must be preserved across layout switches.
 */

export interface AppState {
  /** The ID of the article currently being viewed, or null if none. */
  currentArticleId: string | null;
}

export type StateChangeHandler = (state: AppState) => void;

let state: AppState = {
  currentArticleId: null,
};

let listeners: StateChangeHandler[] = [];

/**
 * Get the current application state (read-only snapshot).
 */
export function getState(): Readonly<AppState> {
  return state;
}

/**
 * Get the currently viewed article ID.
 */
export function getCurrentArticleId(): string | null {
  return state.currentArticleId;
}

/**
 * Set the currently viewed article ID.
 * This value is preserved across layout transitions.
 */
export function setCurrentArticleId(id: string | null): void {
  if (state.currentArticleId !== id) {
    state = { ...state, currentArticleId: id };
    notify();
  }
}

/**
 * Subscribe to state changes. Returns an unsubscribe function.
 */
export function onStateChange(handler: StateChangeHandler): () => void {
  listeners.push(handler);
  return () => {
    listeners = listeners.filter((l) => l !== handler);
  };
}

/**
 * Notify all listeners of a state change.
 */
function notify(): void {
  listeners.forEach((handler) => handler(state));
}
