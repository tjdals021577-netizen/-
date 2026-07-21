# 여러 컴퓨터에서 깃으로 작업 동기화하기 (집PC ↔ 맥북)

> 집에서는 PC로, 밖에서는 맥북으로 작업하고, 둘이 항상 같은 상태가 되게 하는 방법.
> **핵심 원칙 딱 하나: 작업 "시작 전엔 받기(pull)", "끝난 뒤엔 올리기(push)".**

## 먼저 알아둘 것 — 리포는 2개, 서로 별개다

대표님 깃허브에는 **서로 완전히 무관한 두 프로젝트**가 있습니다. 합치는 게 아니라 **각각 따로** 동기화합니다.

| 리포 | 무엇 | 공개여부 | 작업 브랜치 |
|------|------|----------|-------------|
| `tjdals021577-netizen/-` | 업메리·마잘남 **AI 콘텐츠 운영 플랫폼** | 공개 | `claude/video-editing-workflow-9yj1zg` |
| `tjdals021577-netizen/makkk` | **별개의 앱 프로젝트** (AI 자동화와 무관) | 비공개 | `main` |

동기화는 "같은 리포 + 같은 브랜치"를 여러 컴퓨터에서 쓰면 자동으로 됩니다. 두 프로젝트를 한 폴더에 섞지 마세요.

---

## 1) 새 컴퓨터(예: 맥북)에 처음 세팅할 때 — 한 번만

터미널을 열고 아래를 그대로 복사해서 실행하세요.

### AI 콘텐츠 플랫폼(`-`)을 쓰려면
```bash
git clone https://github.com/tjdals021577-netizen/-.git ai-platform
cd ai-platform
git checkout claude/video-editing-workflow-9yj1zg
```
> 폴더 이름이 `-` 이면 헷갈려서 뒤에 `ai-platform` 을 붙여 받았습니다.

### 자체 앱(`makkk`)을 쓰려면
```bash
git clone https://github.com/tjdals021577-netizen/makkk.git
cd makkk
# makkk 는 main 브랜치에서 작업 → 따로 checkout 필요 없음
```

---

## 2) 매일 작업할 때 — 이 두 줄만 기억하면 됩니다

작업하려는 프로젝트 폴더로 들어간 다음:

**① 작업 시작 전 (최신 받기)**
```bash
git pull
```

**② 작업 끝난 뒤 (올리기)**
```bash
git add -A && git commit -m "오늘 한 일 간단히" && git push
```

이게 전부입니다. 시작할 때 `pull`, 끝날 때 `push`. 두 컴퓨터에서 이 습관만 지키면 항상 동기화됩니다.

---

## 3) 더 간단하게 — `sync.sh` 한 줄

`-` 리포에는 `sync.sh` 헬퍼가 들어있습니다(같은 파일을 makkk에 복사해 넣어도 됩니다).
명령어 외우기 귀찮으면 이것만 쓰세요.

```bash
./sync.sh              # 작업 시작 전: 최신 받기
./sync.sh done "메시지"   # 작업 끝: 커밋 + 푸시 (메시지 생략하면 자동)
```

처음 한 번만 실행 권한 부여:
```bash
chmod +x sync.sh
```

---

## 4) 자주 나는 상황

- **"양쪽에서 같은 파일을 고쳐서 충돌났어요" (merge conflict)**
  → 당황하지 말고, `git status` 로 충돌 파일을 확인 → 그 파일을 열면 `<<<<<<<` / `>>>>>>>` 표시가 있습니다.
  원하는 내용만 남기고 표시들을 지운 뒤 → `git add <파일> && git commit` → `git push`.
  **예방법: 한 컴퓨터에서 작업 끝나면 꼭 `push`, 다른 컴퓨터에서 시작 전엔 꼭 `pull`.**

- **"push 했더니 거부당했어요 (rejected)"**
  → 다른 컴퓨터에서 먼저 올린 게 있다는 뜻. `git pull` 한 번 하고 다시 `git push`.

- **어느 브랜치인지 확인**: `git branch --show-current`

---

## 요약 (이것만 기억)

1. 프로젝트마다 폴더 하나, 리포 하나.
2. **켜면 `git pull`(또는 `./sync.sh`), 끄기 전 `git push`(또는 `./sync.sh done`).**
3. `-` 는 `claude/video-editing-workflow-9yj1zg` 브랜치, `makkk` 는 `main` 브랜치.
