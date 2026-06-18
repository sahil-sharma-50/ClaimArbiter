"""Thin REST wrapper for Band Agent API."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from agents.shared.config import BandUrls, get_band_urls

logger = logging.getLogger("arbiter.band_client")


class BandClient:
    def __init__(self, api_key: str, *, urls: BandUrls | None = None) -> None:
        self.api_key = api_key
        self.urls = urls or get_band_urls()
        self._headers = {"X-API-Key": api_key, "Content-Type": "application/json"}

    @property
    def base(self) -> str:
        return self.urls.rest_url

    async def create_chat(self, title: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"chat": {}}
        if title:
            body["chat"]["title"] = title
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{self.base}/api/v1/agent/chats",
                headers=self._headers,
                json=body,
            )
            r.raise_for_status()
            return r.json()["data"]

    async def list_peers(self, *, not_in_chat: str | None = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"page_size": 100}
        if not_in_chat:
            params["not_in_chat"] = not_in_chat
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(
                f"{self.base}/api/v1/agent/peers",
                headers=self._headers,
                params=params,
            )
            r.raise_for_status()
            return r.json().get("data", [])

    async def add_contact(self, handle: str, message: str | None = None) -> dict[str, Any]:
        """Send a cross-org contact request. Returns {id, status:'pending'|'approved'}.

        Status is 'approved' immediately if the other party already requested us.
        """
        body: dict[str, Any] = {"handle": handle}
        if message is not None:
            body["message"] = message
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{self.base}/api/v1/agent/contacts/add",
                headers=self._headers,
                json=body,
            )
            r.raise_for_status()
            return r.json().get("data", {})

    async def list_contact_requests(self, *, sent_status: str = "pending") -> dict[str, Any]:
        """List sent/received contact requests. Returns {received: [...], sent: [...]}."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(
                f"{self.base}/api/v1/agent/contacts/requests",
                headers=self._headers,
                params={"sent_status": sent_status, "page_size": 100},
            )
            r.raise_for_status()
            return r.json().get("data", {}) or {}

    async def add_participant(self, chat_id: str, participant_id: str, role: str = "member") -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{self.base}/api/v1/agent/chats/{chat_id}/participants",
                headers=self._headers,
                json={"participant": {"participant_id": participant_id, "role": role}},
            )
            r.raise_for_status()
            return r.json()["data"]

    async def list_participants(self, chat_id: str, *, retries: int = 3) -> list[dict[str, Any]]:
        """List chat participants, retrying transient Band 5xx errors with backoff.

        Band's participants endpoint intermittently returns 500s while a freshly
        created room is still settling. Those are transient, so retry a few times
        with exponential backoff before giving up.
        """
        url = f"{self.base}/api/v1/agent/chats/{chat_id}/participants"
        last_exc: httpx.HTTPStatusError | None = None
        async with httpx.AsyncClient(timeout=30.0) as client:
            for attempt in range(retries):
                r = await client.get(url, headers=self._headers)
                try:
                    r.raise_for_status()
                except httpx.HTTPStatusError as exc:
                    # Only retry server-side errors; client errors won't fix themselves.
                    if r.status_code < 500 or attempt == retries - 1:
                        raise
                    last_exc = exc
                    delay = 0.5 * (2 ** attempt)
                    logger.warning(
                        "list_participants %s returned %s (attempt %d/%d); retrying in %.1fs",
                        chat_id, r.status_code, attempt + 1, retries, delay,
                    )
                    await asyncio.sleep(delay)
                    continue
                return r.json().get("data", [])
        # Unreachable: the final attempt either returns or raises above.
        raise last_exc  # type: ignore[misc]

    async def remove_participant(self, chat_id: str, participant_id: str) -> dict[str, Any]:
        """Remove a participant from a chat room. Caller must own/admin the room.

        Band routes by @mention, so an agent only re-processes a message if it is
        still a participant AND mentioned. Removing an agent once its phase is done
        is the Band-native way to take it out of the active flow — a stray mention
        can no longer re-trigger it. Returns the removed participant record.
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.delete(
                f"{self.base}/api/v1/agent/chats/{chat_id}/participants/{participant_id}",
                headers=self._headers,
            )
            r.raise_for_status()
            return r.json().get("data", {})

    async def send_message(
        self,
        chat_id: str,
        content: str,
        mentions: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        message: dict[str, Any] = {"content": content}
        if mentions:
            message["mentions"] = mentions
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{self.base}/api/v1/agent/chats/{chat_id}/messages",
                headers=self._headers,
                json={"message": message},
            )
            r.raise_for_status()
            return r.json()["data"]

    async def send_event(
        self,
        chat_id: str,
        content: str,
        *,
        message_type: str = "task",
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        event: dict[str, Any] = {"content": content, "message_type": message_type}
        if metadata is not None:
            event["metadata"] = metadata
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{self.base}/api/v1/agent/chats/{chat_id}/events",
                headers=self._headers,
                json={"event": event},
            )
            r.raise_for_status()
            return r.json()["data"]

    async def get_context(self, chat_id: str, *, limit: int = 100) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []
        cursor: str | None = None
        async with httpx.AsyncClient(timeout=30.0) as client:
            while True:
                params: dict[str, Any] = {"limit": limit}
                if cursor:
                    params["cursor"] = cursor
                r = await client.get(
                    f"{self.base}/api/v1/agent/chats/{chat_id}/context",
                    headers=self._headers,
                    params=params,
                )
                r.raise_for_status()
                payload = r.json()
                messages.extend(payload.get("data", []))
                meta = payload.get("metadata", {})
                if not meta.get("has_more"):
                    break
                cursor = meta.get("next_cursor")
                if not cursor:
                    break
        return messages


class UserBandClient:
    """Optional user-scoped client for human reviewer approve/deny actions."""

    def __init__(self, api_key: str, *, urls: BandUrls | None = None) -> None:
        self.api_key = api_key
        self.urls = urls or get_band_urls()
        self._headers = {"X-API-Key": api_key, "Content-Type": "application/json"}

    @property
    def base(self) -> str:
        return self.urls.rest_url

    async def send_message(self, chat_id: str, content: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{self.base}/api/v1/me/chats/{chat_id}/messages",
                headers=self._headers,
                json={"message": {"content": content}},
            )
            r.raise_for_status()
            return r.json()["data"]
