#!/usr/bin/env bash
# sync.sh — 여러 컴퓨터(집PC ↔ 맥북)에서 깃으로 작업을 동기화하는 헬퍼.
#
# 사용법:
#   ./sync.sh            작업 "시작" 전 — 최신 내용 받아오기 (git pull)
#   ./sync.sh start      위와 동일
#   ./sync.sh done "메시지"   작업 "끝"난 뒤 — 커밋 + 푸시
#   ./sync.sh done       메시지 생략 시 날짜/시간으로 자동 커밋
#
# 어느 리포에서든(-, makkk 둘 다) 현재 체크아웃된 브랜치를 기준으로 동작한다.
set -euo pipefail

# 이 스크립트가 있는 폴더로 이동 (어디서 실행하든 안전)
cd "$(dirname "$0")"

branch="$(git rev-parse --abbrev-ref HEAD)"

pull() {
  echo "⬇️  [$branch] 최신 내용 받아오는 중..."
  git pull origin "$branch"
  echo "✅ 최신 상태. 이제 작업 시작하세요."
}

push() {
  local msg="${1:-}"
  if [ -z "$msg" ]; then
    # 메시지 생략 시 자동 생성 (예: 작업 동기화 2026-07-21 15:30)
    msg="작업 동기화 $(date '+%Y-%m-%d %H:%M')"
  fi

  if git diff --quiet && git diff --cached --quiet && [ -z "$(git status --porcelain)" ]; then
    echo "ℹ️  변경사항이 없습니다. 커밋할 게 없어요."
  else
    git add -A
    git commit -m "$msg"
    echo "📝 커밋 완료: $msg"
  fi

  echo "⬆️  [$branch] 푸시 중..."
  git push -u origin "$branch"
  echo "✅ 푸시 완료. 다른 컴퓨터에서 ./sync.sh 로 받아가면 됩니다."
}

case "${1:-start}" in
  start|pull|"")
    pull
    ;;
  done|push)
    shift || true
    push "${1:-}"
    ;;
  *)
    echo "사용법:"
    echo "  ./sync.sh            # 작업 시작 전: 최신 받기 (pull)"
    echo "  ./sync.sh done \"메시지\"  # 작업 끝: 커밋+푸시"
    exit 1
    ;;
esac
