# 🎨 얼굴 그리기 아이스브레이커 (Icebreaker_Face Drawing)  
> 처음 만난 사람들이 둥글게 마주 앉아 서로의 얼굴을 순서대로 그려주고, 마지막에 나를 그린 그림들을 익명으로 감상하며 누가 그렸는지 맞혀보는 실시간 아이스브레이킹 게임
  
**🏠 실행 환경:**  
인터넷 배포 없이, 모임 현장에서 진행자 노트북을 서버 삼아 같은 와이파이로 연결되어 참가자들이 각자 폰/노트북으로 접속하는 로컬 네트워크 전용 도구입니다.
  
---

## ✨ 핵심 유저 플로우 (User Flow)
1. **진행자 세팅**: 참가자 이름을 앉은 순서대로 입력해 세션 생성 (QR코드 + 접속 주소 자동 발급)
2. **입장**: 참가자는 QR코드를 찍거나 주소로 접속해 자기 이름 선택
3. **라운드 진행**: 좌석 순환 알고리즘이 매 라운드 서로 다른 대상을 배정 → 캔버스에 얼굴 그리기 → 시간 마감 시 자동 제출 & 다음 라운드로 자동 전환
4. **결과 감상**: 전원이 서로를 정확히 한 번씩 그린 뒤, 자신을 그린 그림들을 익명으로 넘겨보며 누가 그렸는지 맞히고 공개

> 🌐 인원수가 N명이면 라운드는 자동으로 N-1회 진행되며, 전원이 서로를 정확히 한 번씩 그리도록 순환 오프셋을 계산합니다.
  
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
  `assignment.js`의 순수 함수로 분리해 N=3~10 전 구간에서 "자기 자신 제외 + 전원 정확히 한 번씩" 불변식을 자동 테스트로 검증합니다.
* **재접속 복구**  
  참가자 식별 정보를 로컬 스토리지에 저장해 새로고침해도 같은 자리로 복귀합니다.
* **인간이 읽을 수 있는 저장 구조**  
  세션 폴더는 `n회차_시작~종료시각`, 그림은 `라운드_대상(상대방)-작가(본인).png` 형식으로 정리되어 모임이 끝난 뒤에도 파일탐색기에서 바로 알아볼 수 있습니다.
  
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
실행 후 진행자는 `http://localhost:3000/host`, 참가자는 콘솔에 출력되는 로컬 IP 주소(`http://192.168.x.x:3000/`)나 진행자 화면의 QR코드로 접속합니다.
---

## 📅 Roadmap
- [ ] 그림 일괄 다운로드 (zip)
- [ ] 인원수 입력 시 예상 총 소요시간 안내
- [ ] GitHub Actions 기반 자동 테스트 파이프라인
- [ ] 세션 상태 스냅샷 저장으로 서버 재시작 시 복구
- [x] 좌석 순환 기반 자동 배정 알고리즘 (전원이 서로를 정확히 한 번씩 그리도록 보장)
- [x] 서버 권위 타이머 + 지각 제출 유예시간
- [x] QR코드 기반 로컬 네트워크 입장
- [x] 캔버스 그림판 (펜/지우개/색상)
- [x] 익명 결과 공개 + 그린 사람 맞히기/공개
- [x] 그림 파일 자동 저장 (라운드/대상/작가 이름 기반 분류 + 세션 폴더 자동 리네임)
- [x] 재접속 지원 (새로고침해도 같은 자리로 복귀)
