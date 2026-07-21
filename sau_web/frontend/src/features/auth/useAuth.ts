import { useCallback, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from './authStore'
import { authApi } from './authApi'

export function useAuth() {
  const store = useAuthStore()
  const queryClient = useQueryClient()

  // Check auth on mount
  const { data, isLoading, isError } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => authApi.getMe(),
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (data?.success && data.data?.user) {
      store.setUser(data.data.user)
    } else if (data?.success === false || isError) {
      store.clearAuth()
    }
  }, [data, isError]) // eslint-disable-line react-hooks/exhaustive-deps

  const sendCodeMutation = useMutation({
    mutationFn: (email: string) => authApi.sendCode(email),
  })

  const loginMutation = useMutation({
    mutationFn: ({ email, code }: { email: string; code: string }) => authApi.login(email, code),
    onSuccess: (data) => {
      if (data.success && data.data?.user) {
        store.setUser(data.data.user)
        queryClient.invalidateQueries({ queryKey: ['auth'] })
      }
    },
  })

  const logoutMutation = useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => {
      store.clearAuth()
      queryClient.clear()
    },
  })

  // Round 7 — profile mutation hook. Wraps PATCH /api/auth/me so a
  // future inline edit form on ProfilePage can drive it. Returning
  // a `useCallback`-wrapped mutateAsync + `status` mirror (same
  // shape as login/logout above) so call sites can `if (status
  // === 'pending')` uniformly.
  //
  // onSuccess invalidates the ['auth', 'me'] query — the next read
  // triggers a fresh GET that returns the updated user in the
  // round-7 extended shape (name + avatar + tier). Using
  // invalidateQueries (instead of setQueryData) means we never
  // accidentally drift from the server's source of truth — e.g.
  // a future PATCH handler that mutates additional fields beyond
  // what name/avatar covers (server-derived tier shifts, licensing
  // timestamp re-derivations, etc.) still round-trip cleanly
  // through the cache.
  const updateMeMutation = useMutation({
    mutationFn: (payload: Parameters<typeof authApi.updateMe>[0]) =>
      authApi.updateMe(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })

  const loginByPasswordMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      authApi.loginByPassword(email, password),
    onSuccess: (data) => {
      if (data.success && data.data?.user) {
        store.setUser(data.data.user)
        queryClient.invalidateQueries({ queryKey: ['auth'] })
      }
    },
  })

  const sendCode = useCallback(
    (email: string) => sendCodeMutation.mutateAsync(email),
    [sendCodeMutation],
  )

  const login = useCallback(
    (email: string, code: string) => loginMutation.mutateAsync({ email, code }),
    [loginMutation],
  )

  const logout = useCallback(
    () => logoutMutation.mutateAsync(),
    [logoutMutation],
  )

  const updateMe = useCallback(
    (payload: Parameters<typeof authApi.updateMe>[0]) =>
      updateMeMutation.mutateAsync(payload),
    [updateMeMutation],
  )

  const loginByPassword = useCallback(
    (email: string, password: string) =>
      loginByPasswordMutation.mutateAsync({ email, password }),
    [loginByPasswordMutation],
  )

  return {
    user: store.user,
    isAuthenticated: store.isAuthenticated,
    isLoading: isLoading || store.isLoading,
    sendCode,
    login,
    loginByPassword,
    logout,
    updateMe,
    sendCodeStatus: sendCodeMutation.status,
    loginStatus: loginMutation.status,
    loginByPasswordStatus: loginByPasswordMutation.status,
    updateMeStatus: updateMeMutation.status,
  }
}
