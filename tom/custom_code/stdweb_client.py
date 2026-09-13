import json
from pathlib import Path

import requests
from django.conf import settings


class StdWebError(RuntimeError):
    pass


class StdWebClient:
    def __init__(self):
        self.api_url = settings.STDWEB_API_URL.rstrip("/") + "/"
        self.public_url = settings.STDWEB_PUBLIC_URL.rstrip("/")
        self.headers = {"Authorization": f"Token {settings.STDWEB_API_TOKEN}"}

    def create_task(self, file_path, title, config):
        path = Path(file_path)
        try:
            with path.open("rb") as stream:
                response = requests.post(
                    f"{self.api_url}tasks/",
                    headers=self.headers,
                    files={"file": (path.name, stream, "application/fits")},
                    data={"title": title, "config": json.dumps(config)},
                    timeout=(5, 180),
                )
            response.raise_for_status()
            return response.json()
        except (OSError, requests.RequestException, ValueError) as exc:
            raise StdWebError(f"STDWeb 提交失败：{exc}") from exc

    def task_state(self, task_id):
        try:
            response = requests.get(
                f"{self.api_url}tasks/{task_id}/state/",
                headers=self.headers,
                timeout=(3, 10),
            )
            response.raise_for_status()
            return response.json().get("state", "unknown")
        except (requests.RequestException, ValueError):
            return "unavailable"

    def task_url(self, task_id):
        return f"{self.public_url}/tasks/{task_id}"
