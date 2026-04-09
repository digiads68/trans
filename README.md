# SubTranslator - Dịch Phụ Đề Thông Minh

Ứng dụng dịch phụ đề từ tiếng nước ngoài (Trung, Anh, Hàn, Nhật...) sang tiếng Việt, sử dụng AI và Google Translate.

## Tính năng

- **Upload file**: Hỗ trợ SRT và Excel (.xlsx, .xls)
- **Tự động nhận diện ngôn ngữ**: Phát hiện ngôn ngữ nguồn tự động
- **Nhiều phương thức dịch**:
  - **AI (LLM)**: Sử dụng các model AI qua OpenAI-compatible API (cliproxyapi)
  - **Google Translate**: Dịch nhanh, miễn phí
  - **Hybrid**: Kết hợp Google dịch thô + AI tinh chỉnh cho chất lượng tối ưu
- **Nhiều model AI**: GPT-4o, GPT-4o-mini, Claude, Gemini, DeepSeek, Qwen...
- **Chế độ dịch**:
  - Tiêu chuẩn: Dịch từng dòng
  - Theo ngữ cảnh: AI hiểu ngữ cảnh trước sau
  - Bảng thuật ngữ: Sử dụng thuật ngữ tùy chỉnh
- **Chỉnh sửa realtime**: Sửa bản dịch trực tiếp, dịch lại từng dòng
- **Xuất file**: SRT hoặc Excel song ngữ
- **WebSocket**: Theo dõi tiến trình dịch realtime

## Kiến trúc

```
trans/
├── backend/           # FastAPI Python backend
│   ├── app/
│   │   ├── api/       # REST API & WebSocket
│   │   ├── models/    # Pydantic schemas
│   │   ├── services/
│   │   │   ├── parser/      # SRT & Excel parsers
│   │   │   ├── translator/  # LLM, Google, Hybrid engines
│   │   │   └── exporter/    # SRT & Excel exporters
│   │   └── utils/     # Language detection
│   └── Dockerfile
├── frontend/          # React + Vite + Tailwind CSS
│   ├── src/
│   │   ├── components/  # UI components
│   │   ├── services/    # API client
│   │   └── hooks/       # React hooks
│   └── Dockerfile
└── docker-compose.yml
```

## Cài đặt & Chạy

### Development

**Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Linux/Mac
pip install -r requirements.txt
cp .env.example .env      # Chỉnh sửa API key
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

Truy cập: http://localhost:5173

### Docker

```bash
cp backend/.env.example backend/.env
# Chỉnh sửa backend/.env với API key của bạn

docker compose up --build
```

Truy cập: http://localhost

## Cấu hình

Tạo file `backend/.env`:

```env
CLIPROXY_API_BASE=https://api.cliproxyapi.com/v1
CLIPROXY_API_KEY=your-api-key-here
```

## API Endpoints

| Method | Endpoint | Mô tả |
|--------|----------|--------|
| GET | `/api/health` | Health check |
| GET | `/api/models` | Danh sách models & providers |
| POST | `/api/upload` | Upload file SRT/Excel |
| GET | `/api/file/{id}/entries` | Lấy danh sách subtitle |
| POST | `/api/translate` | Bắt đầu dịch |
| POST | `/api/translate/{id}/entry/{idx}` | Dịch lại 1 dòng |
| PUT | `/api/file/{id}/entry/{idx}` | Sửa bản dịch |
| GET | `/api/export/{id}?format=srt` | Xuất file |
| WS | `/api/ws/{id}` | WebSocket progress |

## Mở rộng

Kiến trúc plugin-based, dễ mở rộng:

- **Thêm translator mới**: Kế thừa `BaseTranslator` trong `services/translator/`
- **Thêm parser mới**: Kế thừa `BaseParser` trong `services/parser/`
- **Thêm exporter mới**: Kế thừa `BaseExporter` trong `services/exporter/`
- **Tích hợp video**: Sẵn sàng cho plugins liên kết phần mềm dựng video (Premiere, DaVinci Resolve...)
