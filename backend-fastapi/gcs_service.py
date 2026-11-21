import os
from typing import Optional
from google.cloud import storage


class GCSMediaService:
    """Uploads temporary source videos, reference frames, generated clips, and final MP4s to Google Cloud Storage."""

    def __init__(self) -> None:
        self.bucket_name = os.getenv("GCS_BUCKET_NAME", "").strip()
        self._client: Optional[storage.Client] = None

    @property
    def enabled(self) -> bool:
        return bool(self.bucket_name)

    def _get_client(self) -> storage.Client:
        if self._client is None:
            self._client = storage.Client()
        return self._client

    def upload_file(self, local_path: str, object_path: str, content_type: str) -> Optional[str]:
        if not self.enabled:
            return None
        bucket = self._get_client().bucket(self.bucket_name)
        blob = bucket.blob(object_path)
        blob.upload_from_filename(local_path, content_type=content_type)
        return f"gs://{self.bucket_name}/{object_path}"

    def download_file(self, object_path: str, destination_path: str) -> bool:
        if not self.enabled:
            return False
        bucket = self._get_client().bucket(self.bucket_name)
        blob = bucket.blob(object_path)
        if not blob.exists():
            return False
        os.makedirs(os.path.dirname(destination_path), exist_ok=True)
        blob.download_to_filename(destination_path)
        return True
