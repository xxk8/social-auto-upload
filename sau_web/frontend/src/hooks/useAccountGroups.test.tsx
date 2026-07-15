import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useAuthorizeAccountGroup } from './useAccountGroups'
import { api, type AccountGroup } from '@/api/client'

vi.mock('@/api/client', () => ({
  api: {
    authorizeAccountGroup: vi.fn(),
  },
}))

function makeWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useAuthorizeAccountGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function setup(initialGroups?: AccountGroup[]) {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    if (initialGroups) {
      queryClient.setQueryData(['account-groups'], initialGroups)
    }
    return { queryClient, wrapper: makeWrapper(queryClient) }
  }

  it('cold cache (no group query yet) falls through to backend POST', async () => {
    const { wrapper } = setup()
    const mockAuth = vi.mocked(api.authorizeAccountGroup)
    mockAuth.mockResolvedValue({
      success: true,
      data: { group_name: 'g1', platform: 'douyin', cookie_file: '/x.json' },
    })

    const { result } = renderHook(() => useAuthorizeAccountGroup(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ groupId: 1, platform: 'douyin', headless: true })
    })

    expect(mockAuth).toHaveBeenCalledTimes(1)
    expect(mockAuth).toHaveBeenCalledWith(1, 'douyin', true)
  })

  it('group found but target platform NOT in authorizations falls through to backend', async () => {
    const groups: AccountGroup[] = [
      {
        id: 1,
        name: 'g1',
        created: '2020-01-01',
        authorizations: [
          { id: 10, platform: 'kuaishou', cookie_file: '/k.json', valid: true },
        ],
      },
    ]
    const { wrapper } = setup(groups)
    const mockAuth = vi.mocked(api.authorizeAccountGroup)
    mockAuth.mockResolvedValue({
      success: true,
      data: { group_name: 'g1', platform: 'douyin', cookie_file: '/d.json' },
    })

    const { result } = renderHook(() => useAuthorizeAccountGroup(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ groupId: 1, platform: 'douyin' })
    })

    expect(mockAuth).toHaveBeenCalledTimes(1)
  })

  it('platform already in authorizations short-circuits WITHOUT calling api', async () => {
    const groups: AccountGroup[] = [
      {
        id: 1,
        name: 'g1',
        created: '2020-01-01',
        authorizations: [
          { id: 10, platform: 'douyin', cookie_file: '/path/to/douyin_g1.json', valid: true },
        ],
      },
    ]
    const { wrapper } = setup(groups)
    const mockAuth = vi.mocked(api.authorizeAccountGroup)

    const { result } = renderHook(() => useAuthorizeAccountGroup(), { wrapper })
    const data = await act(async () => {
      return await result.current.mutateAsync({ groupId: 1, platform: 'douyin', headless: true })
    })

    expect(mockAuth).not.toHaveBeenCalled()
    expect(data).toEqual({
      success: true,
      data: {
        group_name: 'g1',
        platform: 'douyin',
        cookie_file: '/path/to/douyin_g1.json',
      },
    })
  })

  it('group id not in cache falls through even if same platform exists under another group', async () => {
    const groups: AccountGroup[] = [
      {
        id: 1,
        name: 'g1',
        created: '2020-01-01',
        authorizations: [
          { id: 10, platform: 'douyin', cookie_file: '/d1.json', valid: true },
        ],
      },
    ]
    const { wrapper } = setup(groups)
    const mockAuth = vi.mocked(api.authorizeAccountGroup)
    mockAuth.mockResolvedValue({
      success: true,
      data: { group_name: 'g2', platform: 'douyin', cookie_file: '/d2.json' },
    })

    const { result } = renderHook(() => useAuthorizeAccountGroup(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ groupId: 999, platform: 'douyin' })
    })

    expect(mockAuth).toHaveBeenCalledTimes(1)
  })

  it('onSuccess invalidates the account-groups query (backend fallthrough path)', async () => {
    const groups: AccountGroup[] = [
      {
        id: 1,
        name: 'g1',
        created: '2020-01-01',
        authorizations: [
          { id: 10, platform: 'douyin', cookie_file: '/d1.json', valid: true },
        ],
      },
    ]
    const { queryClient, wrapper } = setup(groups)
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const mockAuth = vi.mocked(api.authorizeAccountGroup)
    // Use kuaishou so we fall through and onSuccess still fires against a real network result
    mockAuth.mockResolvedValue({
      success: true,
      data: { group_name: 'g1', platform: 'kuaishou', cookie_file: '/k1.json' },
    })

    const { result } = renderHook(() => useAuthorizeAccountGroup(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ groupId: 1, platform: 'kuaishou' })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['account-groups'] })
  })

  it('onSuccess invalidates the account-groups query (synthetic short-circuit path)', async () => {
    // Lock symmetric semantics: when the cache-short-circuit fires,
    // the mutation still resolves successfully → onSuccess → invalidate.
    // Without this, re-clicks while a refetch is in flight could return
    // stale-cached auth rows even after the backend has been rotated.
    const groups: AccountGroup[] = [
      {
        id: 1,
        name: 'g1',
        created: '2020-01-01',
        authorizations: [
          { id: 10, platform: 'douyin', cookie_file: '/d1.json', valid: true },
        ],
      },
    ]
    const { queryClient, wrapper } = setup(groups)
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const mockAuth = vi.mocked(api.authorizeAccountGroup)

    const { result } = renderHook(() => useAuthorizeAccountGroup(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ groupId: 1, platform: 'douyin' })
    })

    expect(mockAuth).not.toHaveBeenCalled()       // short-circuit fired
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['account-groups'] })
  })
})
