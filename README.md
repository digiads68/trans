# SubTranslator - Dịch phụ đề thông minh bằng AI

Ứng dụng web dịch phụ đề từ tiếng nước ngoài (Trung, Anh, Hàn, Nhật,...) sang tiếng Việt. Hỗ trợ nhiều nguồn dịch (LLM AI, Google Translate, Hybrid) và nhiều format phụ đề.

## Tính năng

- **6 format đầu vào**: SRT, Excel (xlsx/xls), ASS/SSA, VTT
- **6 format xuất**: SRT, Excel, VTT, ASS, Premiere Pro XML, DaVinci Resolve SRT
- **3 nguồn dịch**: AI (LLM via cliproxyapi), Google Translate, Hybrid (Google + AI tinh chỉnh)
- **3 chế độ dịch**: Tiêu chuẩn, Theo ngữ cảnh, Bảng thuật ngữ
- **Batch processing**: Upload và dịch nhiều file cùng lúc
- **Translation cache**: SQLite cache giảm API calls cho các cụm từ đã dịch
- **WebSocket**: Hiển thị tiến trình dịch real-time
- **Plugin system**: Mở rộng với hooks lifecycle cho video editor integration
- **WebHook**: Gửi thông báo khi dịch xong
- **Dynamic model config**: Thêm/xóa model AI runtime qua API

## Cài đặt nhanh (Docker)

### Yêu cầu
- Docker & Docker Compose

### Bước 1: Clone repo
```bash
git clone https://github.com/digiads68/trans.git
cd trans
```

### Bước 2: Cấu hình API key
```bash
cp backend/.env.example backend/.env
```

Mở `backend/.env` và cập nhật:
```env
CLIPROXY_API_KEY=your-actual-api-key-here
```

### Bước 3: Chạy
```bash
docker compose up --build -d
```

### Bước 4: Truy cập
- **Frontend**: http://localhost
- **Backend API docs**: http://localhost:8000/docs
- **Health check**: http://localhost:8000/api/health

## Cài đặt Development (không Docker)

### Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Cấu hình
cp .env.example .env
# Sửa .env với API key thật

# Chạy
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Frontend dev server chạy tại http://localhost:5173 và proxy API tới backend port 8000.

## Chạy Tests
```bash
cd backend
pip install -r requirements-dev.txt
pytest -v
```

## Cấu trúc dự án

```
trans/
├── backend/
│   ├── app/
│   │   ├── api/           # REST + WebSocket endpoints
│   │   ├── models/        # Pydantic schemas
│   │   ├── services/
│   │   │   ├── parser/    # SRT, Excel, ASS, VTT parsers
│   │   │   ├── translator/# LLM, Google, Hybrid translators
│   │   │   ├── exporter/  # SRT, Excel, VTT, ASS, Premiere, DaVinci exporters
│   │   │   └── cache.py   # SQLite translation memory
│   │   ├── plugins/       # Plugin system (BasePlugin, PluginManager)
│   │   ├── utils/         # Language detection
│   │   ├── config.py      # Settings (Pydantic BaseSettings)
│   │   └── main.py        # FastAPI app
│   ├── tests/             # pytest test suite (54+ tests)
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/    # React UI components
│   │   ├── hooks/         # useTranslation hook (WebSocket)
│   │   └── services/      # API client (axios)
│   ├── Dockerfile
│   └── nginx.conf
├── docker-compose.yml
└── README.md
```

## API Endpoints

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/health` | Health check |
| GET | `/api/models` | Danh sách models khả dụng |
| PUT | `/api/models` | Cập nhật danh sách models |
| POST | `/api/models/add` | Thêm model |
| DELETE | `/api/models/{name}` | Xóa model |
| POST | `/api/upload` | Upload 1 file phụ đề |
| POST | `/api/upload/batch` | Upload nhiều file |
| GET | `/api/file/{id}/entries` | Xem entries (phân trang) |
| POST | `/api/translate` | Dịch file |
| POST | `/api/translate/batch` | Dịch nhiều file |
| POST | `/api/translate/{id}/entry/{idx}` | Dịch lại 1 dòng |
| PUT | `/api/file/{id}/entry/{idx}` | Sửa bản dịch thủ công |
| GET | `/api/export/{id}` | Xuất file (format=srt/xlsx/vtt/ass/premiere/davinci) |
| GET | `/api/cache/stats` | Thống kê cache |
| WS | `/api/ws/{id}` | WebSocket tiến trình dịch |

## Cấu hình (.env)

| Biến | Mặc định | Mô tả |
|------|----------|-------|
| `CLIPROXY_API_BASE` | `https://api.cliproxyapi.com/v1` | API endpoint |
| `CLIPROXY_API_KEY` | *(bắt buộc)* | API key cho LLM |
| `BATCH_SIZE` | `20` | Số dòng gửi mỗi batch cho LLM |
| `MAX_CONCURRENT_REQUESTS` | `5` | Số request LLM song song |
| `MAX_UPLOAD_SIZE` | `50000000` | Giới hạn upload (50MB) |
| `FILE_STORE_TTL` | `7200` | TTL file trong memory (2 giờ) |
| `AVAILABLE_LLM_MODELS` | *xem config.py* | Danh sách model mặc định |

## Plugin Development

Tạo file `.py` trong thư mục `plugins/` ở root project:

```python
from app.plugins.base import BasePlugin

class MyPlugin(BasePlugin):
    name = "my_plugin"
    version = "1.0.0"

    async def on_translation_complete(self, file_id, entries, metadata):
        print(f"Done: {len(entries)} entries in {metadata['duration_seconds']}s")
```

Plugin tự động được phát hiện khi khởi động app.

## Mở rộng

Kiến trúc plugin-based, dễ mở rộng:

- **Thêm translator mới**: Kế thừa `BaseTranslator` trong `services/translator/`
- **Thêm parser mới**: Kế thừa `BaseParser` trong `services/parser/`
- **Thêm exporter mới**: Kế thừa `BaseExporter` trong `services/exporter/`
- **Tích hợp video**: Dùng Plugin hooks (`on_export`, `get_timeline_data`) cho Premiere, DaVinci Resolve, etc.
