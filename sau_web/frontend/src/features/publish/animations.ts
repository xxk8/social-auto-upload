/**
 * Shared Framer Motion animation variants used across publish-form cards.
 * Extracted from VideoForm / NoteForm to eliminate duplication.
 */

/** Staggered card entrance. `custom={index}` (0..N) cascades top-to-bottom. */
export const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      type: 'spring' as const,
      stiffness: 320,
      damping: 28,
      delay: i * 0.06,
    },
  }),
}

/** Default spring used by file-preview, success banners, etc. */
export const springTransition = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 30,
}

/** Staggered thumbnail entrance for the NoteForm image grid. */
export const thumbVariants = {
  hidden: { opacity: 0, scale: 0.5 },
  visible: (i: number) => ({
    opacity: 1,
    scale: 1,
    transition: {
      type: 'spring' as const,
      stiffness: 400,
      damping: 25,
      delay: i * 0.04,
    },
  }),
}
