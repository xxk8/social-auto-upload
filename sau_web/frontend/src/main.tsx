import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { getRouter } from '../app/router'
import './index.css'

const router = getRouter()

createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />,
)

// Defer IndexedDB chat bootstrap off the critical first-paint path.
const bootChat = () => {
  void import('./lib/chat/bootstrapChatPersistence')
    .then((m) => m.bootstrapChatPersistence())
    .catch((err) => {
      // IndexedDB may be blocked (private mode / policy); chat still works in-memory.
      console.warn('[chat-persistence] bootstrap failed; using memory-only chat', err)
    })
}
if (typeof requestIdleCallback === 'function') {
  requestIdleCallback(() => bootChat(), { timeout: 2_500 })
} else {
  setTimeout(bootChat, 1)
}
