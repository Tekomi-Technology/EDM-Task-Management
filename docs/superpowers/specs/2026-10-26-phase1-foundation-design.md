# Thiết kế: Giai đoạn 1 (nền tảng kỹ thuật) + luồng mẫu

Ngày: 26/10/2026 · Nguồn: `Task Management System.pdf` (sơ đồ trang 1, mô tả trang 2–4), `Ke_hoach_trien_khai_EDM-Task-Management.md`.

## 1. Mục đích

Dựng nền tảng kỹ thuật để các giai đoạn sau chỉ việc thêm nghiệp vụ, và chứng minh nền tảng chạy được từ đầu đến cuối bằng một luồng mẫu: khiếu nại khách hàng do hệ thống Call Center gửi sang, được giao việc, xử lý ngoài hiện trường, kiểm tra và đóng.

Thành công khi: một lập trình viên mới clone repo, chạy vài lệnh là có đủ hệ thống trên máy (cơ sở dữ liệu, Keycloak, API, web, app), chạy hết luồng mẫu bằng tài khoản mẫu và công cụ giả lập Call Center; CI trên GitHub chạy lint, kiểm tra kiểu, test và build.

## 2. Đã chốt

- Backend: Node.js + TypeScript, NestJS (nền Express), Drizzle ORM, migration bằng Drizzle Kit.
- Web: React + TypeScript + Vite (SPA).
- App nhân viên hiện trường: React Native + TypeScript.
- Đăng nhập và phân quyền: Keycloak ngay từ đầu.
- Hạ tầng: PostgreSQL + PostGIS, Redis, BullMQ, MinIO, Keycloak; Docker Compose; GitHub Actions.
- Call Center là **hệ thống ngoài, chỉ tích hợp qua API** (kế hoạch mục 2 "Ngoài phạm vi"; sơ đồ: mũi tên vàng Call Center → Task management system).
- Phạm vi đợt này: Giai đoạn 1 + luồng mẫu.

## 3. Ai dùng hệ thống, theo sơ đồ PDF trang 1

| Bên | Cách nối với hệ thống | Căn cứ |
|---|---|---|
| Khách hàng | Không dùng hệ thống, chỉ nhận SMS | Mô tả module "Customer update" |
| Call Center | Hệ thống ngoài, gọi API: gửi ticket, xem trạng thái, xác nhận đóng/mở lại | Mũi tên vàng + xanh đậm 2 chiều; mục Integration |
| Sales system | Hệ thống ngoài, gọi API (Giai đoạn 4) | Mũi tên vàng; mục Integration |
| Network management forces (đội mạng) | Người dùng web, tạo ticket bảo trì/thay đổi (Giai đoạn 3) | Mũi tên vàng; mục Input requirements |
| NOC | Người dùng web: theo dõi, kiểm tra và đóng ticket sự cố lưới | Mũi tên xanh đậm 2 chiều; mục Ticket closing |
| BO forces | Người dùng web: hỗ trợ nhân viên | Mũi tên xanh đậm 2 chiều, nét đứt hỗ trợ |
| Team Manager | Người dùng web: nhận thông báo giao việc, theo dõi và giao lại cho đội | Mũi tên đen "Task assign" tới Team Manager |
| Staff (nhân viên hiện trường) | Người dùng app React Native | Mũi tên đen nhận việc, xanh mảnh gửi yêu cầu đóng |

Không có vai trò "Dispatcher" (sơ đồ không có). Mockup hiện dùng nhân vật dispatcher; sẽ chỉnh ở giai đoạn sau.

## 4. Trong phạm vi

### 4.1 Cấu trúc repo (monorepo, pnpm workspaces)

```
apps/api        NestJS API + worker BullMQ
apps/web        React (Vite) cho Team Manager, NOC, BO, đội mạng, quản trị
apps/mobile     React Native (Expo) cho nhân viên hiện trường
packages/shared Kiểu dữ liệu và schema dùng chung (trạng thái ticket, vai trò, DTO)
tools/callcenter-sim  Công cụ dòng lệnh giả lập hệ thống Call Center
infra/          Docker Compose, cấu hình Keycloak (realm), script khởi tạo
docs/           Quy ước code, hướng dẫn chạy, thiết kế
```

### 4.2 Hạ tầng chạy trên máy (Docker Compose)

- PostgreSQL 16 + PostGIS 3; Redis 7; MinIO (tạo sẵn bucket); Keycloak 26 tự import realm `edm`.
- API và web chạy ngoài Docker khi dev (hot reload). Có file Compose cho staging/production chạy API và web dạng image.

### 4.3 Keycloak

- Vai trò người dùng: `admin`, `team_manager`, `noc`, `network_team`, `bo_support`, `field_staff`. Mỗi vai trò có tài khoản mẫu (mật khẩu dev ghi trong `docs/`).
- Tài khoản hệ thống (client credentials) cho tích hợp: `call-center-system` (vai trò `integration_call_center`), `sales-system` (vai trò `integration_sales`, chưa dùng đợt này).
- Client đăng nhập cho web và cho app (OIDC, PKCE).

### 4.4 Backend (apps/api)

- Module NestJS: `auth`, `users`, `customers`, `tickets`, `intake` (API cho hệ thống ngoài), `assignment`, `attachments`, `notifications`, `health`.
- Xác thực JWT do Keycloak cấp (JWKS), đọc vai trò từ token, phân quyền bằng `@Roles(...)` trên từng API. Người dùng tự được tạo trong DB ở lần gọi đầu, liên kết bằng `sub`.
- **API tiếp nhận từ Call Center** (`intake`):
  - Gửi khiếu nại kỹ thuật → tạo ticket. Có mã tham chiếu của Call Center để gửi trùng không tạo ticket hai lần.
  - Xem trạng thái ticket theo mã tham chiếu.
  - Gửi kết quả kiểm tra với khách: xác nhận đã xong → đóng ticket; chưa xong → mở lại.
- Kiểm tra dữ liệu bằng zod (schema trong `packages/shared`). Lỗi trả về một định dạng thống nhất; log JSON (pino) có mã request.
- Transaction Drizzle cho thao tác ghi nhiều bảng (đổi trạng thái + ghi sự kiện + xếp hàng thông báo).
- Swagger tự sinh tại `/api/docs` (để đội Call Center tích hợp).
- Ảnh hiện trường: URL tải lên trực tiếp MinIO (presigned).
- Thông báo: mỗi sự kiện đẩy job BullMQ; worker gửi qua cổng SMS giả (ghi bảng outbox và log).
- `/health` kiểm tra DB, Redis, MinIO.

### 4.5 Cơ sở dữ liệu (lược đồ ban đầu)

| Bảng | Nội dung chính |
|---|---|
| `areas` | khu vực, ranh giới (PostGIS polygon) |
| `teams` | đội, thuộc khu vực, có team manager |
| `users` | `keycloak_sub`, họ tên, điện thoại, đội |
| `customers` | số hợp đồng, tên, điện thoại, địa chỉ, vị trí (point) |
| `tickets` | mã `TK-YY-NNNNN`, loại, nguồn, mã tham chiếu bên ngoài, trạng thái, ưu tiên, mô tả, khách hàng, vị trí, khu vực, đội, người được giao, hạn xử lý |
| `ticket_events` | lịch sử sự kiện; **phân vùng theo tháng** |
| `staff_locations` | vị trí GPS; **phân vùng theo tháng** (chưa dùng trong luồng mẫu) |
| `attachments` | ảnh và tệp (khóa đối tượng MinIO) |
| `notification_outbox` | thông báo SMS/push |

Bảng phân vùng tạo bằng migration SQL viết tay; có job tạo trước phân vùng các tháng tới. Script nạp dữ liệu mẫu (khu vực Maputo, đội, khách hàng).

### 4.6 Trạng thái ticket (bản tối thiểu)

```
new → assigned → accepted → in_progress → resolved (chờ kiểm tra) → closed
                                              ↘ reopened → assigned
```

Mỗi chuyển trạng thái kiểm tra vai trò và ghi một `ticket_event`. Máy trạng thái đầy đủ (hủy, leo thang, SLA) ở Giai đoạn 2.

### 4.7 Luồng mẫu

1. **Hệ thống Call Center** (giả lập bằng `tools/callcenter-sim`) gửi khiếu nại kỹ thuật vào API → hệ thống tạo ticket, xác định khu vực/đội theo vị trí khách hàng, gửi SMS (giả) cho khách. *(PDF: Customer complain, Ticket creation)*
2. **Giao việc:** hệ thống chọn đội theo khu vực; **Team Manager** của đội chọn nhân viên trên web (giao tay). Nhân viên và Team Manager nhận SMS (giả). *(PDF: Ticket assignment "by team, working area"; phân công tự động là Giai đoạn 2)*
3. **Nhân viên hiện trường** (app): nhận việc → bắt đầu → báo xong kèm ghi chú và ảnh → ticket chuyển sang chờ kiểm tra. *(PDF: Work flows, Customer problem)*
4. **Hệ thống Call Center** (giả lập) hỏi trạng thái, gọi lại khách, rồi gửi kết quả: đóng hoặc mở lại. Mở lại thì ticket về Team Manager để giao lại. *(PDF: Ticket closing)*
5. Web hiển thị toàn bộ lịch sử ticket cho Team Manager, NOC, BO.

### 4.8 Web (apps/web)

React + Vite + TypeScript, React Router, TanStack Query, đăng nhập Keycloak. Màn hình đợt này: danh sách ticket, chi tiết ticket (giao/giao lại nhân viên, lịch sử, ảnh). Giao diện theo mockup đã chốt (logo EDM, cam, Roboto). Không có màn hình tạo ticket cho Call Center.

### 4.9 App (apps/mobile)

Expo + React Native + TypeScript, đăng nhập Keycloak. Màn hình: đăng nhập, việc của tôi, chi tiết việc (nhận, bắt đầu, báo xong kèm ảnh). Chạy bằng Expo Go trên điện thoại cùng mạng LAN. Offline ở Giai đoạn 2.

### 4.10 Chất lượng và CI

- ESLint + Prettier, TypeScript strict.
- Vitest: test đơn vị (máy trạng thái, phân quyền), test tích hợp API trên Postgres thật.
- GitHub Actions: cài đặt → lint → kiểm tra kiểu → test → build → đóng gói Docker image API và web. Chưa tự triển khai lên máy chủ (chưa có máy chủ).
- `docs/conventions.md`: cấu trúc module, đặt tên, xử lý lỗi, migration, quy trình branch và review.

## 5. Ngoài phạm vi đợt này

Tích hợp thật với Call Center, Sales, NMS, kho; phân công tự động; SLA và leo thang; GPS trên bản đồ; module kho; báo cáo; offline; cổng SMS thật và push; triển khai lên máy chủ; Temporal, Kafka/NATS, OpenSearch.

## 6. Ràng buộc

- Máy dev Linux có Node 24, pnpm 10, Docker.
- Không đưa mật khẩu thật vào repo; cấu hình qua biến môi trường, có `.env.example`.
- Giao diện tiếng Anh như mockup, viết sẵn để thêm tiếng Bồ Đào Nha sau.

## 7. Giả định chưa được chủ dự án xác nhận

| # | Câu hỏi | Giả định đợt này | Lý do |
|---|---|---|---|
| 1 | Đóng/mở lại ticket khách hàng làm ở đâu? | Phần mềm Call Center gọi API của mình | Call Center ngoài phạm vi; mũi tên xanh 2 chiều theo dõi/báo cáo |
| 2 | NMS gửi thẳng hay qua người? | Để Giai đoạn 3 quyết | Không thuộc đợt này |
| 3 | Kho tích hợp hay tự làm? | Để Giai đoạn 4 quyết | Không thuộc đợt này |
| 4 | Giao việc tay do ai? | Team Manager | Sơ đồ không có dispatcher; Team Manager nhận "Task assign" |

Đổi giả định 1 hoặc 4 chỉ ảnh hưởng module `intake`/`assignment` và quyền trên vài API.

## 8. Quyết định kỹ thuật do Claude đưa ra

Monorepo pnpm; zod dùng chung API và web; Expo cho React Native; cổng SMS giả; mã ticket `TK-YY-NNNNN`; công cụ giả lập Call Center dạng dòng lệnh.
