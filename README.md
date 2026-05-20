# Telegram AI Frame Video Pipeline

MVP full-stack ringan untuk workflow:

Telegram -> Cloudflare Worker -> GitHub Actions -> Magnific image editing -> VideoProvider -> FFmpeg -> SFTP -> Telegram.

User upload foto base ke Telegram, membuat `frame1` dan `frame2` lewat instruksi teks, lalu generate video 8 detik. Setelah video selesai, job mengambil frame akhir dengan FFmpeg, upload hasil ke SFTP, mengirim video + frame akhir ke Telegram, dan menyimpan frame akhir sebagai kandidat `frame1` part berikutnya.

## Stack

- Node.js + TypeScript
- Cloudflare Worker untuk webhook Telegram
- GitHub Actions untuk proses berat
- JSON session store di `data/sessions`
- Magnific API untuk image edit/enhance
- `VideoProvider` abstraction dengan default `MagnificVideoProvider` untuk Magnific Kling 3 Pro
- FFmpeg untuk extract first/last frame dan fallback video stub jika frame URL publik belum tersedia
- SFTP upload via `ssh2-sftp-client`

## Struktur

```txt
worker/src/index.ts              Cloudflare Worker webhook
src/telegram/telegramClient.ts   Telegram API client
src/telegram/commandRouter.ts    Command handler
src/session/sessionStore.ts      JSON session store
src/image/magnificImageProvider.ts
src/video/videoProvider.ts
src/video/magnificVideoProvider.ts
src/ffmpeg/frameExtractor.ts
src/uploader/sftpUploader.ts
src/jobs/generateSceneJob.ts     GitHub Actions entrypoint
.github/workflows/generate-video.yml
```

## Environment

`.env.example` berisi template. `.env` lokal sudah dibuat ulang untuk proyek ini; nilai SFTP/FTP/PUBLIC_BASE_URL disalin dari `C:/xampp/htdocs/oto/.env`.

Target upload lokal saat ini dipisahkan dari proyek lama:

```txt
PUBLIC_BASE_URL=https://ai.emsa.pro/telegram-ai-frame
UPLOAD_DRIVER=ftp
SFTP_REMOTE_DIR=/home/u940617512/domains/emsa.pro/public_html/ai/telegram-ai-frame
FTP_REMOTE_DIR=/public_html/ai/telegram-ai-frame
```

Folder remote sudah dibuat lewat FTP untuk subdomain `ai.emsa.pro`. Jika `https://ai.emsa.pro/telegram-ai-frame/health-ftp.json` belum bisa dibuka, berarti DNS/subdomain hosting belum diarahkan ke document root `public_html/ai`.

Cloudflare Worker secrets/vars:

```txt
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
GITHUB_TOKEN
GITHUB_OWNER
GITHUB_REPO
GITHUB_WORKFLOW_FILE=generate-video.yml
GITHUB_BRANCH=main
```

GitHub repository secrets:

```txt
TELEGRAM_BOT_TOKEN
MAGNIFIC_API_KEY
MAGNIFIC_BASE_URL
VIDEO_PROVIDER_API_KEY
VIDEO_PROVIDER_BASE_URL
SFTP_HOST
SFTP_PORT
SFTP_USER
SFTP_PASSWORD
SFTP_REMOTE_DIR
FTP_HOST
FTP_PORT
FTP_USER
FTP_PASSWORD
FTP_REMOTE_DIR
PUBLIC_BASE_URL
UPLOAD_DRIVER
```

`VIDEO_PROVIDER_*` boleh kosong untuk MVP. Jika kosong, `MagnificVideoProvider` memakai `MAGNIFIC_API_KEY` + `MAGNIFIC_BASE_URL` dan memanggil Kling 3 Pro. Jika frame belum punya URL publik, provider otomatis fallback ke FFmpeg stub.

## Install

```bash
npm install
npm run typecheck
npm run build
```

Gunakan Node.js 22 untuk hasil paling aman, sama seperti workflow GitHub Actions.

## Deploy Cloudflare Worker

Login dan set secret:

```bash
npx wrangler login
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put GITHUB_OWNER
npx wrangler secret put GITHUB_REPO
npx wrangler secret put GITHUB_WORKFLOW_FILE
npx wrangler secret put GITHUB_BRANCH
```

Deploy:

```bash
npm run worker:deploy
```

Ambil URL Worker dari output deploy.

## Setup Domain Output

Untuk memakai `https://ai.emsa.pro/telegram-ai-frame` sebagai public URL hasil video/frame:

1. Buat subdomain `ai.emsa.pro` di panel hosting.
2. Arahkan document root subdomain ke:

```txt
/home/u940617512/domains/emsa.pro/public_html/ai
```

3. Di Cloudflare DNS, buat record untuk `ai`:

```txt
Type: A atau CNAME
Name: ai
Target: IP hosting atau target CNAME hosting
Proxy: DNS only dulu sampai SSL hosting aktif
```

4. Setelah DNS resolve, cek:

```bash
curl https://ai.emsa.pro/telegram-ai-frame/health-ftp.json
```

Jika URL ini mengembalikan JSON `ok: true`, output pipeline siap dipakai.

## Set Webhook Telegram

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -F "url=https://<worker-url>" \
  -F "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Worker memvalidasi header `X-Telegram-Bot-Api-Secret-Token`, lalu men-dispatch workflow `generate-video.yml`.

## Command Telegram

```txt
/new
upload foto base
/frame1 buat latar hutan, karakter memakai seragam tentara lengkap dengan senjata, realistis, cinematic
/frame2 karakter sampai di markas, cahaya dramatis, realistis, cinematic
/prompt kamera tracking shot pelan, karakter berjalan maju, suasana tegang, realistis, durasi 8 detik
/generate
```

Command lanjutan:

```txt
/continue
/use_last_frame1
/new_frame1
/new_frame2
/replace_frame1
/replace_frame2
/status
/reset
```

Setelah `/generate`, bot mengirim:

1. Video hasil
2. Frame akhir
3. Pilihan `/continue`, `/use_last_frame1`, `/new_frame1`

Frame akhir disimpan di session sebagai `lastEndFramePath`.

## GitHub Actions

Workflow bisa dijalankan manual dari tab Actions dengan input `telegram_update` berisi JSON update Telegram. Worker juga mengirim input yang sama secara otomatis.

Session JSON dipersist ke repo oleh workflow:

```txt
data/sessions/<telegram-user-id>.json
```

Output lokal di-upload sebagai artifact `generated-ai-frame-outputs`. Jika SFTP gagal, bot tetap diberi notifikasi dan file lokal tetap tersedia di artifact.

## Magnific Image API

`MagnificImageProvider` memakai endpoint resmi Magnific:

```txt
POST <MAGNIFIC_BASE_URL>/v1/ai/text-to-image/seedream-v5-lite-edit
GET  <MAGNIFIC_BASE_URL>/v1/ai/text-to-image/seedream-v5-lite-edit/<taskId>
POST <MAGNIFIC_BASE_URL>/v1/ai/image-upscaler-precision-v2
GET  <MAGNIFIC_BASE_URL>/v1/ai/image-upscaler-precision-v2/<taskId>
```

Provider dibuat toleran terhadap response umum seperti `generated`, `image_url`, `output_url`, `url`, atau base64. Jika endpoint Magnific aktual berbeda, ubah adapter ini saja:

```txt
src/image/magnificImageProvider.ts
```

## Mengganti Video Provider

Implement interface:

```ts
export interface VideoProvider {
  generateVideo(input: VideoInput): Promise<VideoResult>;
}
```

Lalu ganti instansiasi di:

```txt
src/jobs/generateSceneJob.ts
```

Flow command, session, FFmpeg, SFTP, dan Telegram tidak perlu berubah.

Default video provider sekarang memakai:

```txt
POST <MAGNIFIC_BASE_URL>/v1/ai/video/kling-v3-pro
GET  <MAGNIFIC_BASE_URL>/v1/ai/video/kling-v3-pro/<taskId>
```
