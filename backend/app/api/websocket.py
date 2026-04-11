import json
import logging

from fastapi import WebSocket
from starlette.websockets import WebSocketState

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages WebSocket connections for real-time progress updates."""

    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, file_id: str):
        await websocket.accept()
        if file_id not in self.active_connections:
            self.active_connections[file_id] = []
        self.active_connections[file_id].append(websocket)
        logger.info(f"WebSocket connected for file_id: {file_id}")

    def disconnect(self, websocket: WebSocket, file_id: str):
        if file_id in self.active_connections:
            self.active_connections[file_id] = [
                ws for ws in self.active_connections[file_id] if ws != websocket
            ]
            if not self.active_connections[file_id]:
                del self.active_connections[file_id]
        logger.debug(f"WebSocket disconnected for file_id: {file_id}")

    async def send_progress(self, file_id: str, data: dict):
        if file_id not in self.active_connections:
            return
        message = json.dumps(data, ensure_ascii=False)
        disconnected = []
        for ws in self.active_connections[file_id]:
            try:
                if ws.client_state == WebSocketState.CONNECTED:
                    await ws.send_text(message)
            except (RuntimeError, ConnectionError, OSError) as e:
                logger.warning(f"WebSocket send failed for {file_id}: {e}")
                disconnected.append(ws)
        for ws in disconnected:
            self.disconnect(ws, file_id)


manager = ConnectionManager()
