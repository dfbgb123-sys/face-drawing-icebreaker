# 🎨 얼굴 그리기 아이스브레이커 (Icebreaker_Face Drawing)  
> 처음 만난 사람들이 둥글게 마주 앉아 서로의 얼굴을 순서대로 그려주고, 마지막에 나를 그린 그림들을 익명으로 감상하며 누가 그렸는지 맞혀보는 실시간 아이스브레이킹 게임
  
**🏠 실행 환경:**  
인터넷 배포 없이, 모임 현장에서 진행자 노트북을 서버 삼아 같은 와이파이로 연결되어 참가자들이 각자 폰/노트북으로 접속하는 로컬 네트워크 전용 도구입니다.
  
---

## 🎮 게임 모드 (Game Modes)
진행자가 세션 생성 시 세 가지 모드 중 하나를 선택합니다.

| 모드 | 인원 | 진행 방식 | 결과 화면 |
|---|---|---|---|
| **1:1 초상화** (`portrait`) | 정확히 2명 | 단 둘이 정해진 시간 동안 서로의 얼굴을 마주 그림 (1라운드) | 둘 다 완료되면 짧은 "두구두구" 서스펜스 연출 후 서로 그려준 초상화를 나란히 공개 |
| **바톤터치** (`baton`) | 2~15명 | 자기 얼굴을 그리며 시작 → 정해진 시간마다 캔버스가 다음 사람에게 넘어가며 이어 그림 (참가자 수만큼 라운드) → 그리는 중에는 화면에 누구를 그리는지 이름 표시 | 각자 자신의 캔버스가 여러 사람 손을 거쳐 완성된 채로 돌아오는 갤러리 열람 |
| **1:多 초상화** (`multi`) | 3명 이상 (기존 기본 모드) | 나를 제외한 모든 참가자를 한 명씩 돌아가며 그림 (N-1라운드) | 자신을 그린 여러 장의 초상화를 익명으로 넘겨보며 누가 그렸는지 맞히고 공개 |

## ✨ 핵심 유저 플로우 (User Flow)
1. **진행자 세팅**: 모드 선택(1:1 / 바톤터치 / 1:多) → 참가자 이름을 앉은 순서대로 입력해 세션 생성 (QR코드 + 접속 주소 자동 발급)
2. **입장**: 참가자는 QR코드를 찍거나 주소로 접속해 자기 이름 선택
3. **라운드 진행**: 좌석 순환 알고리즘이 모드에 맞게 매 라운드 대상을 배정 → 캔버스에 얼굴 그리기 → 시간 마감 시 자동 제출 & 다음 라운드로 자동 전환
4. **결과 감상**: 모드별 결과 화면(1:1 나란히 공개 / 바톤터치 갤러리 / 1:多 익명 맞히기)에서 그림을 확인

> 🌐 좌석 순환 오프셋 계산 로직은 세 모드가 공유하며, 1:1은 2인 한정 1라운드, 바톤터치는 자기 자신부터 시작하는 N라운드, 1:多는 기존과 동일한 N-1라운드로 라운드 수만 다르게 파생됩니다.
  
---

## 🛠 기술 스택 (Tech Stack)

### Backend & Frontend
<img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white"/> <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white"/> <img src="https://img.shields.io/badge/Socket.io-010101?style=for-the-badge&logo=socketdotio&logoColor=white"/> <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black"/> <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white"/> <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white"/>

* **Core:** Node.js + Express (정적 서빙, 세션/업로드 라우트), Socket.IO (실시간 동기화)
* **Frontend:** 빌드 도구 없는 순수 HTML/CSS/JS — Canvas API 기반 그림판 (pointer 이벤트)
* **QR:** `qrcode` 패키지로 입장 링크를 이미지로 발급
* **Testing:** Node.js 내장 테스트 러너(`node --test`)
  
---

## 🛡️ 설계 포인트
* **서버 권위 타이머**  
  라운드 마감을 클라이언트가 아닌 서버가 판정해 기기 간 시간차 문제를 방지하고, 늦게 도착하는 정상 제출을 위한 유예시간을 둡니다.
* **좌석 순환 배정 알고리즘**  
  `assignment.js`의 순수 함수로 분리해 N=3~10 전 구간에서 "자기 자신 제외 + 전원 정확히 한 번씩" 불변식을 자동 테스트로 검증합니다. `roundEngine.js`는 이 엔진을 재사용해 1:1(2인 1라운드), 바톤터치(자기 자신부터 시작하는 N라운드), 1:多(기존 N-1라운드) 세 모드의 라운드 수·배정을 파생합니다.
* **재접속 복구**  
  참가자 식별 정보를 로컬 스토리지에 저장해 새로고침해도 같은 자리로 복귀합니다.
* **인간이 읽을 수 있는 저장 구조**  
  세션 폴더는 `날짜_시작~종료시각_n회차` 형식이라 파일탐색기에서 이름순 정렬만 해도 날짜순으로 나열되고, 그림은 `라운드_대상(상대방)-작가(본인).png` 형식으로 정리되어 모임이 끝난 뒤에도 바로 알아볼 수 있습니다.
  
---

## 🚀 Quick Start (로컬 실행)
```bash
# 의존성 패키지 설치
npm install

# 서버 실행 (같은 와이파이의 다른 기기에서도 접속 가능)
npm start

# 단위 테스트 구동 (배정 알고리즘 검증)
npm test
```
실행 후 진행자는 `http://localhost:3000/host`, 참가자는 콘솔에 출력되는 로컬 IP 주소(`http://192.168.x.x:3000/`)나 진행자 화면의 QR코드로 접속합니다.
  
---

## 🚀 Quick Start_w/ Claude (로컬/클로드 실행)
```bash
# 레포지토리 연결 (클로드 코드에서 실행)
git clone https://github.com/dfbgb123-sys/face-drawing-icebreaker.git

# 페이지 이동
cd face-drawing-icebreaker

# 의존성 패키지 설치 (필요시)
npm install

# 서버 실행 (같은 와이파이의 다른 기기에서도 접속 가능)
npm start
```
---

## 📅 Roadmap
- [ ] 그림 일괄 다운로드 (zip)
- [ ] 인원수 입력 시 예상 총 소요시간 안내
- [ ] GitHub Actions 기반 자동 테스트 파이프라인
- [ ] 세션 상태 스냅샷 저장으로 서버 재시작 시 복구
- [x] 3가지 게임 모드 (1:1 초상화 / 바톤터치 / 1:多 초상화) 및 모드별 호스트·플레이어 UI
- [x] 좌석 순환 기반 자동 배정 알고리즘 (전원이 서로를 정확히 한 번씩 그리도록 보장)
- [x] 서버 권위 타이머 + 지각 제출 유예시간
- [x] QR코드 기반 로컬 네트워크 입장
- [x] 캔버스 그림판 (펜/지우개/색상)
- [x] 익명 결과 공개 + 그린 사람 맞히기/공개
- [x] 그림 파일 자동 저장 (라운드/대상/작가 이름 기반 분류 + 세션 폴더 자동 리네임)
- [x] 재접속 지원 (새로고침해도 같은 자리로 복귀)
