import { request } from './request'

export const accountsApi = {
  getAccounts(platform?: string) {
    return request
      .get('/api/accounts', { params: platform ? { platform } : undefined })
      .then((res) => res.data)
  },
  deleteAccount(platform: string, account: string) {
    return request.post('/api/accounts/delete', { platform, account }).then((res) => res.data)
  },
  checkAccount(platform: string, account: string, deep = false) {
    return request.post('/api/accounts/check', { platform, account, deep }).then((res) => res.data)
  },
  checkAllAccounts() {
    return request.post('/api/accounts/check-all', {}).then((res) => res.data)
  },
  loginAccount(payload: { platform: string; account: string; headless?: boolean }) {
    return request.post('/api/accounts/login', payload).then((res) => res.data)
  },
  getAccountGroups() {
    return request.get('/api/account-groups').then((res) => res.data)
  },
  createAccountGroup(name: string) {
    return request.post('/api/account-groups', { name }).then((res) => res.data)
  },
  deleteAccountGroup(groupId: number) {
    return request.delete(`/api/account-groups/${groupId}`).then((res) => res.data)
  },
  renameAccountGroup(groupId: number, name: string) {
    return request.post(`/api/account-groups/${groupId}/rename`, { name }).then((res) => res.data)
  },
  authorizeAccountGroup(groupId: number, platform: string, headless?: boolean) {
    return request.post(`/api/account-groups/${groupId}/authorize`, { platform, headless }).then((res) => res.data)
  },
  confirmAuthorizeAccountGroup(groupId: number, platform: string) {
    return request.post(`/api/account-groups/${groupId}/confirm-authorize`, { platform }).then((res) => res.data)
  },
  removeAuthorization(groupId: number, platform: string) {
    return request.delete(`/api/account-groups/${groupId}/authorize/${platform}`).then((res) => res.data)
  },
  reorderAccountGroups(groupIds: number[]) {
    return request.post('/api/account-groups/reorder', { group_ids: groupIds }).then((res) => res.data)
  },
  reorderAuthorizations(groupId: number, authIds: number[]) {
    return request.post(`/api/account-groups/${groupId}/reorder-authorizations`, { auth_ids: authIds }).then((res) => res.data)
  },
}