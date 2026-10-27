# Kế hoạch triển khai dự án EDM-Task-Management

**Hệ thống quản lý ticket kỹ thuật**

---

## 1. Mục tiêu

- Xây dựng nền tảng tập trung quản lý ticket kỹ thuật end-to-end: tiếp nhận, phân công, xử lý hiện trường, xác nhận, đóng ticket.
- Quản lý nhân lực hiện trường (vị trí, phân công, hiệu suất), quản lý vật tư theo ticket, thông báo khách hàng và báo cáo KPI.
- Hệ thống vận hành lâu dài, dễ bảo trì, phục vụ khoảng 30 triệu khách hàng và vài nghìn ticket mỗi ngày.

## 2. Phạm vi

**Trong phạm vi:**

- Các module lõi: tạo, giám sát, phân công, cập nhật trạng thái và đóng ticket.
- Quản lý kho, quản lý tài khoản, theo dõi vị trí nhân viên, báo cáo.
- App mobile cho nhân viên hiện trường, web cho điều phối và quản lý.
- Tích hợp với Call Center, Sales, NMS, NOC, BO forces và Team Manager.

**Ngoài phạm vi:**

- Xây dựng hệ thống Call Center (chỉ tích hợp qua API).



## 3. Công nghệ đã chốt


| Hạng mục          | Lựa chọn                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| Backend           | Node.js + TypeScript, NestJS (nền Express), Drizzle ORM                                              |
| Frontend          | React + TypeScript                                                                                   |
| Mobile            | React Native + TypeScript, hỗ trợ offline                                                            |
| Cơ sở dữ liệu     | PostgreSQL + PostGIS, phân vùng bảng sự kiện và GPS                                                  |
| Thành phần hỗ trợ | Redis, BullMQ (job nền), Keycloak (SSO, phân quyền), MinIO (lưu tệp), Call Center (tích hợp qua API) |
| Bổ sung khi cần   | Temporal (workflow, SLA), NATS hoặc Kafka (sự kiện), OpenSearch (tìm kiếm)                           |
| Vận hành          | Docker, CI/CD, GitHub, GitHub Actions, k6 kiểm thử tải                                               |




## 4. Các giai đoạn triển khai



### Giai đoạn 1. Nền tảng kỹ thuật

- Dựng môi trường dev, staging, production bằng Docker Compose.
- Thiết lập GitHub repository, quy trình branch và review code, CI/CD bằng GitHub Actions (build, test, lint, đóng gói Docker image, triển khai).
- Dựng khung dự án Node.js + TypeScript (NestJS) theo quy ước: cấu trúc module theo domain, xử lý lỗi, log, transaction, linter và định dạng code (ESLint, Prettier), kiểm thử (Vitest).
- Dựng khung web React + TypeScript và khung app mobile.
- Thiết kế lược đồ cơ sở dữ liệu ban đầu, migration bằng Drizzle Kit, phân vùng bảng sự kiện và GPS.
- Cài đặt PostgreSQL + PostGIS, Redis, BullMQ, MinIO, Keycloak. Tích hợp đăng nhập SSO và phân quyền theo vai trò.
- Viết quy ước code và hướng dẫn cho đội phát triển.
- **Đầu ra:** nền tảng chạy được từ đầu đến cuối với một luồng mẫu, pipeline CI/CD hoạt động.



### Giai đoạn 2. Ticket lõi

- Module ticket: tạo, giám sát, cập nhật trạng thái, đóng và mở lại ticket, lịch sử sự kiện của ticket.
- Máy trạng thái ticket.
- Phân công ticket: thủ công và tự động cơ bản.
- Quản lý tài khoản và phân quyền chi tiết (vai trò, khu vực, đội).
- App nhân viên: nhận việc, cập nhật trạng thái, chụp ảnh, đóng ticket, hoạt động offline.
- Thông báo SMS và push cơ bản qua hàng đợi BullMQ.
- **Đầu ra:** luồng khiếu nại khách hàng chạy hoàn chỉnh từ tạo ticket đến đóng ticket.



### Giai đoạn 3. Sự cố mạng và quản lý nhân lực

- Tích hợp NMS: nhận cảnh báo, tự tạo ticket, gộp các cảnh báo cùng nguyên nhân thành một sự cố.
- Tích hợp NOC: NOC xác nhận ticket sự cố mạng.
- Theo dõi vị trí GPS thời gian thực của nhân viên, lưu vị trí mới nhất trên Redis.
- Phân công theo khu vực, đội và khoảng cách (PostGIS).
- SLA và leo thang (escalation) tự động.
- Theo dõi hiệu suất nhân viên: tỷ lệ hoàn thành, thời gian phản hồi, thời gian xử lý.
- **Đầu ra:** luồng sự cố mạng chạy hoàn chỉnh, bản đồ theo dõi nhân viên, cơ chế SLA hoạt động.



### Giai đoạn 4. Kho và triển khai khách hàng mới

- Quản lý kho kiểu sổ cái: nhập, xuất, cấp phát vật tư theo ticket, tự trừ kho, theo dõi tiêu hao.
- Tích hợp Sales: tiếp nhận yêu cầu khảo sát kỹ thuật, báo cáo khả thi.
- Luồng triển khai dịch vụ: tạo ticket triển khai, lắp đặt, bàn giao, xác nhận của khách hàng, kích hoạt dịch vụ.
- Tích hợp BO forces và Team Manager (quản lý vận chuyển, kho của đội).
- **Đầu ra:** luồng kho và luồng triển khai khách hàng mới chạy hoàn chỉnh.



### Giai đoạn 5. Báo cáo, KPI và hoàn thiện

- Dashboard điều hành: ticket mở, ticket đóng, tỷ lệ đạt SLA, hiệu suất kỹ thuật viên.
- Báo cáo vận hành: trạng thái ticket, sự cố, triển khai, sử dụng vật tư.
- KPI quản lý: MTTR, First Time Fix Rate, tỷ lệ xử lý ticket, hiệu suất nhân lực.
- Tối ưu hiệu năng: truy vấn, chỉ mục, cache.
- Kiểm thử tải bằng k6 với kịch bản sự cố diện rộng, kiểm thử bảo mật, kiểm thử sao lưu và khôi phục.
- Sửa lỗi và hoàn thiện toàn hệ thống.
- **Đầu ra:** hệ thống hoàn chỉnh đủ các module, đạt yêu cầu về tải và bảo mật.



### Giai đoạn 6. Tài liệu dự án

**Tài liệu vận hành:**

- Hướng dẫn triển khai và cài đặt hệ thống.
- Runbook xử lý sự cố thường gặp.
- Quy trình sao lưu và khôi phục dữ liệu.
- Hướng dẫn giám sát và cảnh báo.

**Kịch bản test:**

- Tổng hợp kịch bản test theo từng module và từng luồng nghiệp vụ (khiếu nại khách hàng, sự cố mạng, triển khai khách hàng mới, kho).
- Kịch bản kiểm thử tải, kiểm thử bảo mật, kiểm thử khôi phục sau thảm họa.

**Tài liệu test:**

- Kế hoạch kiểm thử (test plan).
- Bộ test case và kết quả thực hiện.
- Báo cáo kiểm thử từng giai đoạn và báo cáo kiểm thử tổng thể.

**Slide:**

- Slide giới thiệu tổng quan hệ thống và kiến trúc.
- Slide đào tạo cho từng nhóm người dùng.
- Slide báo cáo kết quả dự án cho ban lãnh đạo.
- **Đầu ra:** bộ tài liệu vận hành, kịch bản test, tài liệu test và bộ slide của dự án.

