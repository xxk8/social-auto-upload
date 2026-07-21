import * as React from 'react'

// Type declarations for `*.mdx` imports. Vite + @mdx-js/rollup emit a
// default-export React component from each .mdx file. Without this shim,
// `tsc --noEmit` fails with:
//
//   TS7016: Could not find a declaration file for module
//   '.../DESIGN-components.mdx'. Try `npm i --save-dev @types/...'`
//
// `components` is optional so callers can pass a per-import mapping if
// they don't want to wrap the rendered tree in `<MDXProvider>`.
// `MDXProps` mirrors the runtime contract documented by
// @mdx-js/react (https://mdxjs.com/packages/react/).

declare module '*.mdx' {
  // `React.ComponentType` defaults to `ComponentType<{}>` which mirrors
  // the upstream `@mdx-js/react` runtime contract (MDX content takes no
  // props; component overrides go through `<MDXProvider components={…}>`
  // wrapping the rendered tree, not as an import prop). We avoid
  // `<any>` here to keep `@typescript-eslint/no-explicit-any` green.
  const MDXContent: React.ComponentType
  export default MDXContent
}
