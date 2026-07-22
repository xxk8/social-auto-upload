declare module '*.mdx' {
  let MDXComponent: (props: Record<string, unknown>) => JSX.Element
  export default MDXComponent
}
declare module 'react-big-calendar' {
  import type { ComponentType } from 'react'
  export const Calendar: ComponentType<Record<string, unknown>>
  export const dateFnsLocalizer: (...args: unknown[]) => unknown
  export type Event = {
    title?: string
    start?: Date
    end?: Date
    resource?: unknown
    [key: string]: unknown
  }
  export type View = string
  export const Views: Record<string, string>
}
