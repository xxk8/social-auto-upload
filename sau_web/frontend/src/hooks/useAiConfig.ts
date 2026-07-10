import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'

export function useAiConfig() {
  return useQuery({
    queryKey: ['ai-config'],
    queryFn: async () => {
      const res = await api.getAiConfig()
      return res.data
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    retry: 2,
  })
}

// `ai-keys` listing is founder-gated (ai-api-keys-founder feature).
// Non-founders get a 403 from the backend; we don't want a noisy
// retry/log loop on every dashboard mount for them, so pass an
// `enabled` flag and short-circuit the query when the caller can't
// see the data anyway. Defaults to enabled to preserve call-site
// shape (existing components don't have to change).
export function useAiKeys(enabled: boolean = true) {
  return useQuery({
    queryKey: ['ai-keys'],
    queryFn: async () => {
      const res = await api.listAiKeys()
      return res.data
    },
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    retry: 2,
    enabled,
  })
}

export function useSetAiConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (apiKey: string) => api.setAiConfig(apiKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-config'] })
      queryClient.invalidateQueries({ queryKey: ['ai-keys'] })
    },
  })
}

export function useDeleteAiConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (keyId?: number) => api.deleteAiConfig(keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-config'] })
      queryClient.invalidateQueries({ queryKey: ['ai-keys'] })
    },
  })
}
