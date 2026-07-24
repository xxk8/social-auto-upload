import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { getRouter } from '../app/router'
import { bootstrapChatPersistence } from './lib/chat/bootstrapChatPersistence'
import './index.css'

const router = getRouter()

void bootstrapChatPersistence().catch((err) => {
  // IndexedDB may be blocked (private mode / policy); chat still works in-memory.
  console.warn('[chat-persistence] bootstrap failed; using memory-only chat', err)
})

createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />,
)
