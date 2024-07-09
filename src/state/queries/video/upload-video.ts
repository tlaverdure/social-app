import React from 'react'
import {FileSystemUploadType, uploadAsync} from 'expo-file-system'
import {ImagePickerAsset} from 'expo-image-picker'
import {msg} from '@lingui/macro'
import {useLingui} from '@lingui/react'
import {useMutation, useQuery} from '@tanstack/react-query'
import {nanoid} from 'nanoid/non-secure'

import {logger} from '#/logger'
import {CompressedVideo} from 'lib/media/video/compress'
import {VideoTooLargeError} from 'lib/media/video/errors'
import {JobState, JobStatus, UploadVideoResponse} from 'lib/media/video/types'
import {useCompressVideoMutation} from 'state/queries/video/compress-video'
import {useSession} from 'state/session'

const UPLOAD_ENDPOINT = process.env.EXPO_PUBLIC_VIDEO_ROOT_ENDPOINT ?? ''
const UPLOAD_HEADER = process.env.EXPO_PUBLIC_VIDEO_HEADER ?? ''

type Status = 'idle' | 'compressing' | 'processing' | 'uploading' | 'done'

type Action =
  | {
      type: 'SetStatus'
      status: Status
    }
  | {
      type: 'SetProgress'
      progress: number
    }
  | {
      type: 'SetError'
      error: string | undefined
    }
  | {type: 'Reset'}
  | {type: 'SetAsset'; asset: ImagePickerAsset}
  | {type: 'SetVideo'; video: CompressedVideo}
  | {type: 'SetJobStatus'; jobStatus: JobStatus}

interface State {
  status: Status
  progress: number
  asset?: ImagePickerAsset
  video: CompressedVideo | null
  jobStatus?: JobStatus
  error?: string
}

function reducer(state: State, action: Action): State {
  let updatedState = state

  if (action.type === 'SetStatus') {
    updatedState = {...state, status: action.status}
  } else if (action.type === 'SetProgress') {
    updatedState = {...state, progress: action.progress}
  } else if (action.type === 'SetError') {
    updatedState = {...state, error: action.error}
  } else if (action.type === 'Reset') {
    updatedState = {
      status: 'idle',
      progress: 0,
      video: null,
    }
  } else if (action.type === 'SetAsset') {
    updatedState = {...state, asset: action.asset}
  } else if (action.type === 'SetVideo') {
    updatedState = {...state, video: action.video}
  } else if (action.type === 'SetJobStatus') {
    updatedState = {...state, jobStatus: action.jobStatus}
  }

  return updatedState
}

export function useVideoUpload({
  setStatus,
}: {
  setStatus: (status: string) => void
}) {
  const {_} = useLingui()
  const [state, dispatch] = React.useReducer(reducer, {
    status: 'idle',
    progress: 0,
    video: null,
  })

  const {setJobId} = useUploadStatusQuery({
    onStatusChange: (status: JobStatus) => {
      console.log(status)
      // TODO Update the state here
      dispatch({
        type: 'SetJobStatus',
        jobStatus: status,
      })
      setStatus(status.state.toString())
    },
  })

  const {mutate: onVideoCompressed} = useUploadVideoMutation({
    onSuccess: response => {
      dispatch({
        type: 'SetStatus',
        status: 'processing',
      })
      setJobId(response.job_id)
    },
    onError: e => {
      dispatch({
        type: 'SetError',
        error: _(msg`An error occurred while uploading the video.`),
      })
      logger.error('Error uploading video', {safeMessage: e})
    },
  })

  const {mutate: onSelectVideo} = useCompressVideoMutation({
    onProgress: p => {
      dispatch({type: 'SetProgress', progress: p})
    },
    onError: e => {
      if (e instanceof VideoTooLargeError) {
        dispatch({
          type: 'SetError',
          error: _(msg`The selected video is larger than 100MB.`),
        })
      } else {
        dispatch({
          type: 'SetError',
          // TODO better error message from server
          error: _(msg`An error occurred while compressing the video.`),
        })
        logger.error('Error compressing video', {safeMessage: e})
      }
    },
    onSuccess: (video: CompressedVideo) => {
      dispatch({
        type: 'SetVideo',
        video,
      })
      dispatch({
        type: 'SetStatus',
        status: 'uploading',
      })
      onVideoCompressed(video)
    },
  })

  const selectVideo = (asset: ImagePickerAsset) => {
    dispatch({
      type: 'SetAsset',
      asset,
    })
    dispatch({
      type: 'SetStatus',
      status: 'compressing',
    })
    onSelectVideo(asset)
  }

  const resetVideo = () => {
    // TODO cancel any running jobs
    dispatch({type: 'Reset'})
  }

  return {
    state,
    dispatch,
    selectVideo,
    resetVideo,
  }
}

const useUploadVideoMutation = ({
  onSuccess,
  onError,
}: {
  onSuccess: (response: UploadVideoResponse) => void
  onError: (e: any) => void
}) => {
  const {currentAccount} = useSession()

  return useMutation({
    mutationFn: async (video: CompressedVideo) => {
      const uri = createUrl('/upload', {
        did: currentAccount!.did,
        name: `hailey-${nanoid(12)}.mp4`,
      })

      const res = await uploadAsync(uri, video.uri, {
        headers: {
          'dev-key': UPLOAD_HEADER,
          'content-type': 'video/mp4',
        },
        httpMethod: 'POST',
        uploadType: FileSystemUploadType.BINARY_CONTENT,
      })

      console.log('[VIDEO]', res.body)

      const responseBody = JSON.parse(res.body) as UploadVideoResponse
      onSuccess(responseBody)
      return responseBody
    },
    onError,
    onSuccess,
  })
}

const useUploadStatusQuery = ({
  onStatusChange,
}: {
  onStatusChange: (status: JobStatus) => void
}) => {
  const {currentAccount} = useSession()
  const [enabled, setEnabled] = React.useState(false)
  const [jobId, setJobId] = React.useState<string>()

  const {isLoading, isError} = useQuery({
    queryKey: ['video-upload'],
    queryFn: async () => {
      console.log('test')
      console.log(jobId)
      const url = createUrl(`/job/${jobId}/status`)
      const res = await fetch(url)
      const status = (await res.json()) as JobStatus
      if (status.state === JobState.JOB_STATE_COMPLETED) {
        setEnabled(false)
      }
      onStatusChange(status)
      return status
    },
    enabled,
    refetchInterval: 1500,
  })

  return {
    isLoading,
    isError,
    setJobId: (_jobId: string) => {
      setEnabled(true)
      setJobId(_jobId)
    },
  }
}

const createUrl = (route: string, params?: Record<string, string>) => {
  const url = new URL(`${UPLOAD_ENDPOINT}`)
  url.pathname = route
  if (params) {
    for (const key in params) {
      url.searchParams.set(key, params[key])
    }
  }
  return url.href
}