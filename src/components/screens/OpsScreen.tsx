import { BlogComposer } from '../BlogComposer'
import { PreviewBanner } from './PreviewBanner'

export function OpsScreen() {
  return (
    <div>
      <PreviewBanner message="콘텐츠 캘린더·결재함·지시 입력창은 Phase 4(백엔드) 이후에 실제 데이터와 연결됩니다. 지금은 블로그 SEO 위원회가 실제로 동작합니다." />
      <BlogComposer />
    </div>
  )
}
