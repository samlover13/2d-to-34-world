# Google Cloud & Android Studio Setup Guide — Cartoon AI Studio

## 1. Google Cloud & Gemini / Veo Prerequisites
1. Create or select a Google Cloud Project with billing enabled.
2. Enable the required APIs:
   ```bash
   gcloud services enable \
     aiplatform.googleapis.com \
     storage.googleapis.com \
     run.googleapis.com
   ```
3. Create a Google Cloud Storage bucket for source uploads, character reference portraits, Veo scene clips, and rendered MP4 exports:
   ```bash
   gsutil mb -l us-central1 gs://cartoon-ai-studio-media
   ```
4. Create a Service Account with `Storage Object Admin` (`roles/storage.objectAdmin`) and `Vertex AI User` (`roles/aiplatform.user`) roles, and download its JSON key strictly to your backend server (NEVER place credentials inside the Android APK).
5. Generate a billing-enabled `GEMINI_API_KEY` from Google AI Studio and inject it into your server environment (`Settings > Secrets` or Cloud Run Secret Manager).

## 2. Running the Python FastAPI Backend
```bash
cd backend-fastapi
cp .env.example .env
# Edit .env with GEMINI_API_KEY, GCP_PROJECT_ID, GCS_BUCKET_NAME, and DATABASE_URL
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Or deploy to Cloud Run with Docker (includes FFmpeg):
```bash
gcloud run deploy cartoon-ai-studio-api \
  --source ./backend-fastapi \
  --region us-central1 \
  --memory 4Gi \
  --cpu 2 \
  --timeout 900 \
  --set-env-vars "GCP_PROJECT_ID=your-project,GCS_BUCKET_NAME=cartoon-ai-studio-media" \
  --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest"
```

## 3. Building the Native Android App (APK) in Android Studio
1. Open the `android-app/` directory in **Android Studio Ladybug (2024.2+)** with JDK 17 and Android SDK 35 installed.
2. Point the Android app to your deployed backend URL by adding to `android-app/gradle.properties` (or passing via CLI):
   ```properties
   BACKEND_BASE_URL=https://your-cloud-run-backend-url/
   ```
   *(Default `http://10.0.2.2:8000/` connects directly from the Android Emulator to FastAPI running on `localhost:8000`.)*
3. Build the debug or release APK:
   ```bash
   cd android-app
   ./gradlew assembleDebug
   # Output APK: android-app/app/build/outputs/apk/debug/app-debug.apk
   ```
4. Minimum Android version supported: **Android 10 (API 29)**.
   - Scoped Storage `MediaStore` saves converted MP4s cleanly into `Movies/CartoonAIStudio/` with zero legacy storage permissions.
   - `FileProvider` enables native Android Share Sheet distribution.
