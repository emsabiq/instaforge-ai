# InstaForge AI

Dashboard sederhana untuk membuat video vertikal berbasis prompt AI, mengunggah MP4 ke storage publik, lalu publish ke Instagram Reels lewat Meta Graph API.

Alur utamanya:

1. Dashboard Vercel menerima prompt dan PIN.
2. Dashboard memicu GitHub Actions workflow.
3. Workflow membuat naskah video dengan OpenAI API.
4. FFmpeg merender video 1080x1920.
5. Video diupload ke SFTP/FTP agar punya public URL.
6. Instagram Graph API mem-publish video sebagai Reels.

Platform yang aktif hanya Instagram. Facebook, YouTube, TikTok, dan Threads sengaja tidak dipakai di kode workflow ini.

## Perintah Lokal

```bash
npm install
npm run check
npm run generate -- --prompt "Ide video pendek tentang disiplin kecil" --duration 24
npm run generate -- --prompt "Ide video pendek tentang disiplin kecil" --duration 24 --publish
```

## Env Penting

- `OPENAI_API_KEY`
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
