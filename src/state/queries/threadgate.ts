import {AppBskyFeedDefs, AppBskyFeedThreadgate, AtUri} from '@atproto/api'
import {useQuery} from '@tanstack/react-query'

import {useAgent} from '#/state/session'

export type ThreadgateSetting =
  | {type: 'nobody'}
  | {type: 'mention'}
  | {type: 'following'}
  | {type: 'list'; list: unknown}

export function threadgateViewToSettings(
  threadgate: AppBskyFeedDefs.ThreadgateView | undefined,
): ThreadgateSetting[] {
  const record =
    threadgate &&
    AppBskyFeedThreadgate.isRecord(threadgate.record) &&
    AppBskyFeedThreadgate.validateRecord(threadgate.record).success
      ? threadgate.record
      : null
  if (!record) {
    return []
  }
  if (!record.allow?.length) {
    return [{type: 'nobody'}]
  }
  const settings: ThreadgateSetting[] = record.allow
    .map(allow => {
      let setting: ThreadgateSetting | undefined
      if (allow.$type === 'app.bsky.feed.threadgate#mentionRule') {
        setting = {type: 'mention'}
      } else if (allow.$type === 'app.bsky.feed.threadgate#followingRule') {
        setting = {type: 'following'}
      } else if (allow.$type === 'app.bsky.feed.threadgate#listRule') {
        setting = {type: 'list', list: allow.list}
      }
      return setting
    })
    .filter(n => !!n)
  return settings
}

export const threadgateRecordQueryKeyRoot = 'threadgate-record'
export const createThreadgateRecordQueryKey = (uri: string) => [
  threadgateRecordQueryKeyRoot,
  uri,
]

export function useThreadgateRecordQuery({
  postUri,
  initialData,
}: {
  postUri?: string
  initialData?: AppBskyFeedThreadgate.Record
} = {}) {
  const agent = useAgent()

  return useQuery({
    enabled: !!postUri,
    queryKey: createThreadgateRecordQueryKey(postUri || ''),
    placeholderData: initialData,
    async queryFn() {
      const urip = new AtUri(postUri!)

      if (!urip.host.startsWith('did:')) {
        const res = await agent.resolveHandle({
          handle: urip.host,
        })
        urip.host = res.data.did
      }

      const {value} = await agent.api.app.bsky.feed.threadgate.get({
        repo: urip.host,
        rkey: urip.rkey,
      })

      return value
    },
  })
}
