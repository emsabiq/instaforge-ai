# InstaForge AI

Dashboard sederhana untuk membuat video berbasis prompt AI. Mode terbaru mendukung storyboard anak-anak dengan karakter konsisten, render Replicate LTX landscape, artifact GitHub Actions, dan publish Instagram Reels bila diaktifkan.

Alur utamanya:

1. Dashboard Vercel menerima prompt dan PIN.
2. Dashboard memicu GitHub Actions workflow.
3. Workflow membuat naskah/storyboard dengan OpenAI API atau fallback lokal.
4. Video dirender dengan Replicate LTX atau FFmpeg lokal.
5. Jika publish aktif, video diupload ke SFTP/FTP agar punya public URL.
6. Instagram Graph API mem-publish video sebagai Reels.

Platform yang aktif hanya Instagram. Facebook, YouTube, TikTok, dan Threads sengaja tidak dipakai di kode workflow ini.

## Perintah Lokal

```bash
npm install
npm run check
npm run dev
npm run generate -- --prompt "Nara belajar berbagi buah di taman" --duration 15 --engine replicate --audience children --aspect 16:9 --no-publish
npm run generate -- --prompt "Ide video pendek tentang disiplin kecil" --duration 24
npm run generate -- --prompt "Ide video pendek tentang disiplin kecil" --duration 24 --publish
```

## Env Penting

- `OPENAI_API_KEY`
- `REPLICATE_API_TOKEN`
- `REPLICATE_VIDEO_MODEL`, default `lightricks/ltx-2.3-fast`
- `VIDEO_ENGINE=replicate` atau `ffmpeg`
- `VIDEO_AUDIENCE=children` atau `general`
- `VIDEO_ASPECT_RATIO=16:9`, `9:16`, atau `1:1`
- `PUBLIC_BASE_URL`
- `UPLOAD_DRIVER=sftp` atau `ftp`
- `SFTP_HOST`, `SFTP_USER`, `SFTP_PASSWORD` atau `SFTP_PRIVATE_KEY`, `SFTP_REMOTE_DIR`
- `INSTAGRAM_IG_USER_ID`
- `INSTAGRAM_ACCESS_TOKEN`
- `META_APP_ID`, `META_APP_SECRET`
- `AUTO_DASHBOARD_PIN`
- `GH_REPO_SECRET_TOKEN`
- `DASHBOARD_GITHUB_REPO`

Rahasia tidak boleh di-commit. File `.env` sudah diabaikan oleh Git.

Catatan: Replicate tetap membutuhkan credit/billing untuk model video berbayar. Jika tidak ada credit, workflow akan berhenti dengan pesan `credit tidak cukup`.
