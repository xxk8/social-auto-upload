export type MultiPlatformRequest = {
  topic: string
  platforms: string[]
  model?: string
}

export type PlatformResult = {
  platform: string
  title: string
  description: string
  tags: string[]
  parseError?: boolean
}

export type PlatformError = {
  platform: string
  title: string
  description: string
  tags: string[]
  error: string
}

export type MultiPlatformDone = {
  results: Record<string, PlatformResult | PlatformError>
}

export type ContentVariant = {
  style: string
  styleLabel: string
  title: string
  description: string
  tags: string[]
  parseError?: boolean
}

export type VariantError = {
  style: string
  styleLabel: string
  title: string
  description: string
  tags: string[]
  error: string
}

/**
 * Platform-mode variant — emitted by `/api/ai/generate/variants` when
 * the request body carries `platforms: string[]` instead of the
 * default style-variants path. One event per platform; each becomes
 * a sibling assistant bubble in the chat session tree.
 */
export type PlatformVariant = {
  platform: string
  platformLabel: string
  title: string
  description: string
  tags: string[]
  parseError?: boolean
}

export type PlatformVariantError = {
  platform: string
  platformLabel: string
  title: string
  description: string
  tags: string[]
  error: string
}

export type VariantsDone = {
  results: Record<string, ContentVariant | VariantError>
}
