import { createFileRoute, Outlet } from '@tanstack/react-router'

/**
 * Layout for `/dashboard/studio` and `/dashboard/studio/$id`.
 *
 * File-based routing nests ``studio.$id`` under ``studio``; without an
 * ``<Outlet />`` the detail page never mounts (URL changes, list stays).
 * The list itself lives in ``studio.index.tsx``.
 */
export const Route = createFileRoute('/dashboard/studio')({
  component: StudioLayout,
})

function StudioLayout() {
  return <Outlet />
}
