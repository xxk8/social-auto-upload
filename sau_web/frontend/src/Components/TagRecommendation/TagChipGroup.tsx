import { memo } from 'react'

interface TagChipGroupProps {
  tags: string[]
  selectedTags: string[]
  onToggle: (tag: string) => void
  loading?: boolean
}

export const TagChipGroup = memo(function TagChipGroup({
  tags,
  selectedTags,
  onToggle,
  loading = false,
}: TagChipGroupProps) {
  if (loading) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-6 w-16 rounded-full bg-muted animate-pulse"
          />
        ))}
      </div>
    )
  }

  if (tags.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => {
        const isSelected = selectedTags.includes(tag)
        return (
          <button
            key={tag}
            type="button"
            onClick={() => onToggle(tag)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              isSelected
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}
          >
            #{tag}
          </button>
        )
      })}
    </div>
  )
})
