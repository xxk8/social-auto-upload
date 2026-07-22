import { request } from './request'

export const publishApi = {
  uploadVideo(payload: {
    platform: string
    account: string
    title: string
    file: File
    desc?: string
    tags?: string
    schedule?: string
    headless?: string
    thumbnail?: string
    thumbnail_landscape?: string
    thumbnail_portrait?: string
    product_link?: string
    product_title?: string
    tid?: number
    short_title?: string
    category?: string
    is_draft?: string
  }) {
    const formData = new FormData()
    formData.append('platform', payload.platform)
    formData.append('account', payload.account)
    formData.append('title', payload.title)
    formData.append('file', payload.file)
    if (payload.desc !== undefined) formData.append('desc', payload.desc)
    if (payload.tags !== undefined) formData.append('tags', payload.tags)
    if (payload.schedule) formData.append('schedule', payload.schedule)
    if (payload.thumbnail) formData.append('thumbnail', payload.thumbnail)
    if (payload.thumbnail_landscape) formData.append('thumbnail_landscape', payload.thumbnail_landscape)
    if (payload.thumbnail_portrait) formData.append('thumbnail_portrait', payload.thumbnail_portrait)
    if (payload.product_link) formData.append('product_link', payload.product_link)
    if (payload.product_title) formData.append('product_title', payload.product_title)
    if (payload.tid !== undefined) formData.append('tid', String(payload.tid))
    if (payload.headless !== undefined) formData.append('headless', payload.headless)
    if (payload.short_title) formData.append('short_title', payload.short_title)
    if (payload.category) formData.append('category', payload.category)
    if (payload.is_draft !== undefined) formData.append('is_draft', payload.is_draft)
    return request({
      method: 'post',
      url: '/api/upload/video',
      data: formData,
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((res) => res.data)
  },

  uploadNoteMultipart(payload: {
    platform: string
    account: string
    title: string
    images: File[]
    note?: string
    tags?: string
    schedule?: string
    headless?: string
  }) {
    const formData = new FormData()
    formData.append('platform', payload.platform)
    formData.append('account', payload.account)
    formData.append('title', payload.title)
    if (payload.note) formData.append('note', payload.note)
    if (payload.tags) formData.append('tags', payload.tags)
    if (payload.schedule) formData.append('schedule', payload.schedule)
    if (payload.headless !== undefined) formData.append('headless', payload.headless)
    payload.images.forEach((file, idx) => {
      formData.append(`images_${idx}`, file)
    })
    return request({
      method: 'post',
      url: '/api/upload/note',
      data: formData,
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((res) => res.data)
  },
}