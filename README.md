# ระบบจัดการที่ดินขายฝาก — เวอร์ชันเว็บ (Netlify + Firebase + Gemini API)

เวอร์ชันนี้คือแอปเดิมที่เคยใช้ในการ์ดไฟล์ของ Claude แต่ย้ายมาเป็นเว็บไซต์จริง
ของตัวเอง ใช้ **Netlify** โฮสต์เว็บ, **Firebase** เก็บข้อมูล/รูปสัญญา, และ
**Gemini API (free tier)** แทน AI วิเคราะห์ — ฟรีทั้งหมด ยกเว้นถ้าใช้เกิน free
tier ของแต่ละเจ้า

---

## 0. สิ่งที่ต้องมีก่อนเริ่ม

- บัญชี Google (สำหรับ Firebase + Gemini API)
- บัญชี GitHub (ฟรี) — ใช้เก็บโค้ดเพื่อเชื่อมกับ Netlify
- บัญชี Netlify (ฟรี) — สมัครด้วย GitHub ได้เลยที่ https://app.netlify.com
- เครื่องคอมที่ลง **Node.js** (เวอร์ชัน 18 ขึ้นไป) — ดาวน์โหลดที่
  https://nodejs.org ถ้าไม่แน่ใจว่ามีหรือยัง เปิด Terminal/Command Prompt
  แล้วพิมพ์ `node --version`

---

## 1. สร้าง Firebase Project

1. เข้า https://console.firebase.google.com → กด **"Add project" / "สร้างโปรเจกต์"**
2. ตั้งชื่อโปรเจกต์ เช่น `khaifak-app` → กด Continue จนเสร็จ (ปิด Google
   Analytics ก็ได้ ไม่จำเป็น)
3. เมื่อเข้าหน้าโปรเจกต์แล้ว ที่เมนูซ้าย ไปที่ **Build → Firestore Database**
   → กด **Create database** → เลือก **Start in production mode** → เลือก
   location ที่ใกล้ที่สุด (เช่น `asia-southeast1`) → Enable

   > **หมายเหตุ:** เวอร์ชันนี้เก็บรูปสัญญาเป็นรูปบีบอัดไว้ใน Firestore
   > โดยตรง — **ไม่ใช้ Firebase Storage** เพราะ Google เปลี่ยนนโยบายให้
   > Storage ต้องอัปเกรดเป็นแพลน Blaze (ผูกบัตรเครดิต) ก่อนถึงจะเปิดใช้ได้
   > วิธีนี้เลยไม่ต้องผูกบัตร ใช้ฟรีบนแพลน Spark ได้ครบ ไม่ต้องไปที่เมนู
   > "Storage" เลย
4. ไปที่ **⚙️ Project settings** (รูปเฟืองมุมซ้ายบน) → เลื่อนลงมาที่
   **"Your apps"** → กดไอคอนเว็บ `</>` → ตั้งชื่อ (เช่น `khaifak-web`) →
   Register app
5. จะเห็นโค้ด config หน้าตาแบบนี้ — **คัดลอกค่าเก็บไว้** จะใช้ตอนตั้งค่า
   ในขั้นตอนที่ 4 (ไม่ต้องใช้บรรทัด `storageBucket`):
   ```js
   const firebaseConfig = {
     apiKey: "...",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "...",
   };
   ```

### ตั้งค่าความปลอดภัย (สำคัญมาก)

ค่าเริ่มต้นของ Firestore แบบ "production mode" จะ**ปิดการเข้าถึงทั้งหมด**
ไว้ก่อน (ปลอดภัยแต่แอปจะเซฟข้อมูลไม่ได้) ต้องเปิดสิทธิ์ให้แอปเขียนได้ ไปที่
**Firestore Database → Rules** แก้เป็น:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /khaifak_data/{docId} {
      allow read, write: if true;
    }
  }
}
```
กด **Publish**

  ⚠️ **กฎด้านบน (`if true`) คือเปิดให้ใครก็ได้ที่รู้ลิงก์เว็บอ่าน/เขียนข้อมูลได้
  ทั้งหมด** เหมาะสำหรับใช้คนเดียว/ทดสอบเท่านั้น ถ้าจะให้ทีมงานใช้จริงหรือกังวล
  เรื่องคนนอกเข้าถึงข้อมูล ควรเพิ่ม **Firebase Authentication** (เช่น ให้ล็อกอิน
  ด้วยอีเมล) แล้วเปลี่ยนกฎเป็น `allow read, write: if request.auth != null;`
  แทน — ถ้าต้องการให้ผมช่วยเพิ่มส่วนนี้บอกได้

---

## 2. ขอ Gemini API Key (ฟรี)

1. เข้า https://aistudio.google.com/apikey (ล็อกอินด้วยบัญชี Google — ใช้
   บัญชีเดียวกับ Gemini ที่จ่ายรายเดือนอยู่ก็ได้ แต่จะเป็นคนละระบบบิลลิ่งกัน
   ไม่เสียเงินเพิ่ม)
2. กด **"Create API key"** → เลือกโปรเจกต์ (จะสร้างโปรเจกต์ Google Cloud ใหม่
   หรือใช้ตัวเดียวกับ Firebase ก็ได้)
3. คัดลอก API key เก็บไว้ (จะใช้ในขั้นตอนที่ 5 — **ห้ามใส่ค่านี้ในไฟล์โค้ดที่จะ
   อัปขึ้น GitHub เด็ดขาด** เดี๋ยวจะตั้งเป็นความลับฝั่งเซิร์ฟเวอร์แทน)
4. ตรวจสอบ free tier ปัจจุบันได้ที่ https://ai.google.dev/gemini-api/docs/pricing
   (โมเดลและโควต้าฟรีเปลี่ยนบ่อย ถ้าอยากได้โมเดลที่ฟรีมากสุด/เร็วสุด ณ วันที่ใช้งาน
   จริง เลือกโมเดลรุ่น "Flash" หรือ "Flash-Lite" ที่เป็นรุ่นใหม่สุด)

---

## 3. เตรียมโค้ดในเครื่อง

1. แตกไฟล์ zip ที่ได้ ไปที่โฟลเดอร์นั้นด้วย Terminal:
   ```bash
   cd khaifak-web
   ```
2. ติดตั้ง dependencies:
   ```bash
   npm install
   ```
3. สร้างไฟล์ `.env` จาก `.env.example`:
   ```bash
   cp .env.example .env
   ```
   แล้วเปิดไฟล์ `.env` ด้วยโปรแกรมแก้ไขข้อความ ใส่ค่า 6 ตัวจาก Firebase config
   (ขั้นตอนที่ 1) ให้ครบ — **ไม่ต้องใส่ GEMINI_API_KEY ในไฟล์นี้**

4. ทดสอบรันในเครื่อง (ดูหน้าตาแอปได้ แต่โหมด AI จะยังใช้ไม่ได้จนกว่าจะ deploy
   เพราะ Netlify Function รันบน Netlify เท่านั้น):
   ```bash
   npm run dev
   ```
   เปิด http://localhost:5173 — ถ้าจะทดสอบ AI ในเครื่องด้วย ให้ติดตั้ง Netlify
   CLI แล้วรันด้วย `netlify dev` แทน (ดูขั้นตอนที่ 6)

---

## 4. อัปโค้ดขึ้น GitHub

1. สร้าง repository ใหม่ (ว่างเปล่า) ที่ https://github.com/new เช่นชื่อ
   `khaifak-app`
2. ในโฟลเดอร์โปรเจกต์ (Terminal เดิม):
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   git branch -M main
   git remote add origin https://github.com/<ชื่อบัญชีคุณ>/khaifak-app.git
   git push -u origin main
   ```
   (ไฟล์ `.env` จะไม่ถูกอัปขึ้นไปเพราะอยู่ใน `.gitignore` แล้ว — ปลอดภัย)

---

## 5. Deploy บน Netlify

1. เข้า https://app.netlify.com → **Add new site → Import an existing project**
2. เลือก **GitHub** → authorize → เลือก repository `khaifak-app`
3. หน้าตั้งค่า build:
   - Build command: `npm run build` (ใส่ไว้ให้แล้วใน `netlify.toml`)
   - Publish directory: `dist`
   - **อย่าเพิ่งกด Deploy** — เลื่อนลงไปที่ **"Add environment variables"**
     ก่อน (หรือไปตั้งทีหลังที่ Site configuration → Environment variables ก็ได้)
4. เพิ่ม environment variables ทั้งหมดนี้:
   | Key | Value |
   |---|---|
   | `VITE_FIREBASE_API_KEY` | จาก Firebase config |
   | `VITE_FIREBASE_AUTH_DOMAIN` | จาก Firebase config |
   | `VITE_FIREBASE_PROJECT_ID` | จาก Firebase config |
   | `VITE_FIREBASE_MESSAGING_SENDER_ID` | จาก Firebase config |
   | `VITE_FIREBASE_APP_ID` | จาก Firebase config |
   | `GEMINI_API_KEY` | API key จากขั้นตอนที่ 2 (**ไม่มี `VITE_` นำหน้า** — ค่านี้ต้องอยู่ฝั่งเซิร์ฟเวอร์เท่านั้น ไม่ถูกฝังลงโค้ด browser) |
   | `GEMINI_MODEL` | (ไม่ใส่ก็ได้ ค่าเริ่มต้นคือ `gemini-2.0-flash`) ใส่ถ้าอยากเปลี่ยนโมเดล |

5. กด **Deploy site** → รอสักครู่ → เสร็จแล้วจะได้ลิงก์เว็บ เช่น
   `https://khaifak-app-xxxx.netlify.app`
6. (ทางเลือก) ตั้งชื่อโดเมนให้จำง่ายขึ้นได้ที่ **Site configuration →
   Domain management → Options → Edit site name**

---

## 6. ทดสอบ

1. เปิดลิงก์เว็บที่ได้ → ลองเพิ่มแปลงที่ดินในแท็บ "แปลงในพอร์ต" → รีเฟรชหน้า
   ดูว่าข้อมูลยังอยู่ (แปลว่า Firestore เชื่อมสำเร็จ)
2. ลองกด "ถ่าย/แนบรูปสัญญาขายฝาก" — ควรเปิด file picker/กล้องได้ปกติ (เว็บ
   จริงไม่มีข้อจำกัดแบบตอนอยู่ในการ์ดไฟล์ของ Claude)
3. ลองแท็บ "วิเคราะห์ที่ดินใหม่" หรือ "AI แนะนำที่ดิน" — ถ้าขึ้น error ให้อ่าน
   ข้อความ error ที่ขึ้น (ตอนนี้แอปโชว์รายละเอียด error จริงให้) ปัญหาที่พบ
   บ่อย:
   - `GEMINI_API_KEY is not set` → ลืมตั้ง environment variable ข้อ 5, ตั้ง
     แล้วต้อง **Trigger deploy ใหม่** ที่ Netlify (Deploys → Trigger deploy)
     env var จะไม่มีผลกับ build เก่า
   - error เกี่ยวกับ quota/rate limit → ชน free tier ของ Gemini วันนั้น
     รอ reset หรือดูโควต้าที่ https://aistudio.google.com

### ทดสอบ Netlify Function ในเครื่อง (ไม่บังคับ)

```bash
npm install -g netlify-cli
netlify login
netlify dev
```
จะรันทั้งเว็บและ Function พร้อมกันในเครื่อง ต้องตั้งค่า env vars ในเครื่องด้วย
(สร้างไฟล์ `.env` ตามข้อ 3 และเพิ่ม `GEMINI_API_KEY=...` ต่อท้ายได้ เฉพาะตอนรัน
ในเครื่องเท่านั้น — **ไฟล์นี้ไม่ถูกอัปขึ้น GitHub อยู่แล้วเพราะอยู่ใน
.gitignore**)

---

## โครงสร้างไฟล์

```
khaifak-web/
├── netlify/functions/gemini.js   ← เรียก Gemini API (API key อยู่ตรงนี้เท่านั้น)
├── netlify.toml                  ← ตั้งค่า build/deploy ของ Netlify
├── src/
│   ├── App.jsx                   ← โค้ดแอปหลัก (เหมือนเวอร์ชันเดิมเกือบทั้งหมด)
│   ├── main.jsx                  ← จุดเริ่มโปรแกรม React
│   ├── firebaseConfig.js         ← ตั้งค่าเชื่อม Firebase
│   ├── lib/storage.js            ← เก็บ/อ่านข้อมูลแปลง+ประวัติ+รูปสัญญา ผ่าน Firestore
│   ├── lib/ai.js                 ← เรียก Netlify Function (Gemini) จากฝั่งเว็บ
│   └── lib/jsonRepair.js         ← ซ่อมแซม JSON ที่ AI ตอบมาไม่ครบ (กันแอปพัง)
├── .env.example                  ← แม่แบบไฟล์ตั้งค่า Firebase (ฝั่งเว็บ)
└── package.json
```

---

## ค่าใช้จ่าย / ขีดจำกัด free tier ที่ควรรู้

- **Netlify Free plan**: bandwidth/build minutes จำกัดต่อเดือน แต่เหลือเฟือ
  สำหรับใช้คนเดียว/ทีมเล็ก
- **Firebase Spark plan (ฟรี)**: Firestore ~50,000 reads/20,000 writes ต่อวัน,
  1GiB เก็บข้อมูล (รวมรูปสัญญาที่เก็บแบบบีบอัดในนี้ด้วย) — พอสำหรับธุรกิจ
  ขนาดเล็ก-กลาง
- **Gemini API free tier**: จำกัดจำนวนครั้งต่อนาที/ต่อวัน (เปลี่ยนตามรุ่นโมเดล
  และช่วงเวลา) เช็คค่าล่าสุดได้ที่ https://ai.google.dev/gemini-api/docs/pricing
  — ถ้าใช้ "AI แนะนำที่ดิน" บ่อยๆ (แต่ละครั้งเรียก AI หลายรอบ) มีโอกาสชน
  limit รายวันได้เหมือนกัน แค่รอ reset วันถัดไป

ถ้าธุรกิจโตขึ้นจนชน free tier บ่อย ค่อยพิจารณาอัปเป็นแพลนเสียเงินของแต่ละเจ้า
ทีหลังได้ ไม่ต้องเปลี่ยนโค้ดอะไรเพิ่ม
